// Receipt-owned stock lots keep corrections separate from other receipts.
const mongoose = require('mongoose');

const idOf = value => String(value?._id || value || '');
const fail = message => { const error = new Error(message); error.status = 400; throw error; };
const quantityOf = item => Number(item.receivedQty ?? item.acceptedQty ?? 0);
const plain = value => value?.toObject ? value.toObject() : { ...value };

function purchaseLine(po, item) {
  if (item.purchaseOrderItemId) {
    const line = po.items.find(line => idOf(line._id) === idOf(item.purchaseOrderItemId));
    if (!line) fail('The received item no longer exists on this purchase order.');
    if (item.productId && idOf(item.productId) !== idOf(line.productId || line.product)) {
      fail('The received product does not match its purchase order line.');
    }
    return line;
  }
  const matches = po.items.filter(line => item.productId
    ? idOf(line.productId || line.product) === idOf(item.productId)
    : (item.sku ? line.sku === item.sku : (line.productName || line.name) === item.productName));
  if (matches.length !== 1) fail('Cannot safely identify the purchase line. Select the purchase again; legacy duplicate lines need reconciliation.');
  return matches[0];
}

function syncPurchaseQuantities(po, receipts) {
  const totals = new Map();
  for (const receipt of receipts) {
    if (receipt.status === 'cancelled' || receipt.status === 'draft') continue;
    for (const item of receipt.items) {
      const line = purchaseLine(po, item);
      item.purchaseOrderItemId = line._id;
      const key = idOf(line._id);
      totals.set(key, (totals.get(key) || 0) + quantityOf(item));
    }
  }
  let ordered = 0, received = 0;
  for (const line of po.items) {
    const qty = totals.get(idOf(line._id)) || 0;
    if (qty < 0 || qty > Number(line.quantity)) fail(`Received quantity exceeds ordered quantity for ${line.productName}.`);
    line.receivedQty = qty;
    line.remainingQty = Number(line.quantity) - qty;
    ordered += Number(line.quantity);
    received += qty;
  }
  for (const receipt of receipts) {
    for (const item of receipt.items) {
      const line = purchaseLine(po, item);
      item.orderedQty = Number(line.quantity);
      item.remainingQty = line.remainingQty;
    }
  }
  po.receivedPercentage = ordered ? Math.round(received / ordered * 100) : 0;
  po.partiallyReceived = received > 0 && received < ordered;
  if (received > 0) po.status = received >= ordered ? 'delivered' : 'partially_received';
  else if (['delivered', 'partially_received'].includes(po.status)) po.status = 'pending';
  if (po.status !== 'delivered') po.deliveryDate = '';
  po.markModified?.('items');
}

function validateItem(item, product) {
  const quantity = quantityOf(item);
  if (!Number.isFinite(quantity) || quantity < 0) fail('Received quantity must be a non-negative number.');
  for (const field of ['unitPrice', 'taxRate', 'mrp', 'sellingPrice']) {
    if (item[field] !== undefined && (!Number.isFinite(Number(item[field])) || Number(item[field]) < 0)) {
      fail(`${field} must be a non-negative number.`);
    }
  }
  if (Number(item.taxRate) > 100) fail('Tax rate cannot exceed 100%.');
  item.batchNumber = String(item.batchNumber || '').trim();
  if (product.productType !== 'non-batch' && quantity > 0 && (!item.batchNumber || item.batchNumber === 'N/A')) {
    fail(`Batch number is required for ${product.name}.`);
  }
  if (product.productType === 'non-batch') item.batchNumber = 'N/A';
}

function stockLot(product, item) {
  if (item.stockBatchId) {
    const lot = product.batches.find(batch => idOf(batch._id) === idOf(item.stockBatchId));
    if (!lot) fail(`The stock lot for ${product.name} is missing. Reconcile stock before changing this GRN.`);
    return lot;
  }
  const matches = product.batches.filter(batch => batch.batchNumber === item.batchNumber);
  if (matches.length !== 1) fail(`Cannot safely identify legacy batch ${item.batchNumber} for ${product.name}. Reconcile its stock before changing this GRN.`);
  return matches[0];
}

function applyReceiptStock(product, before, after, grn, actor = 'System') {
  if (after) validateItem(after, product);
  const oldQty = before ? quantityOf(before) : 0;
  const newQty = after ? quantityOf(after) : 0;
  const isBatch = product.productType !== 'non-batch';
  const exchange = grn.currency !== 'INR' ? Number(grn.exchangeRate) || 1 : 1;
  const prices = item => ({
    costPrice: Number((Number(item.unitPrice || 0) * exchange).toFixed(2)),
    mrp: item.mrp !== undefined ? Number((Number(item.mrp) * exchange).toFixed(2)) : Number(product.pricing?.mrp || 0),
    sellingPrice: item.sellingPrice !== undefined ? Number((Number(item.sellingPrice) * exchange).toFixed(2)) : Number(product.pricing?.sellingPrice || 0),
  });
  const metadata = item => ({
    ...prices(item), mfgDate: item.mfgDate || '', expDate: item.expDate || '',
    sourceGRN: grn._id, sourceGRNItem: item._id, purchaseOrder: grn.purchaseOrder,
    supplierName: grn.supplierName, supplier: grn.supplierId,
    addedDate: grn.receivedDate, addedBy: actor,
    reason: `GRN ${grn.grnNumber} / ${grn.poNumber}`,
  });
  const changed = oldQty !== newQty || (before?.batchNumber !== after?.batchNumber);
  if (isBatch) {
    const lot = before && oldQty > 0 ? stockLot(product, before) : null;
    // An old row without a lot id may refer to shared stock. Never relabel it.
    const sameOwnedBatch = lot && after && before.stockBatchId && before.batchNumber === after.batchNumber;
    if (sameOwnedBatch) {
      const next = Number(lot.quantity) + newQty - oldQty;
      if (next < Number(lot.reservedQuantity || 0)) fail(`Cannot reduce ${product.name}: received stock has been sold or reserved.`);
      lot.quantity = next;
      Object.assign(lot, metadata(after));
      after.stockBatchId = lot._id;
    } else if (lot && after && !changed) {
      // Preserve unlinked legacy stock on a no-op edit; do not adopt a shared lot.
    } else {
      if (lot) {
        const next = Number(lot.quantity) - oldQty;
        if (next < Number(lot.reservedQuantity || 0)) fail(`Cannot change ${product.name}: received stock has been sold or reserved.`);
        lot.quantity = next;
      }
      if (after && newQty > 0) {
        const stockBatchId = new mongoose.Types.ObjectId();
        product.batches.push({ _id: stockBatchId, batchNumber: after.batchNumber, quantity: newQty, ...metadata(after) });
        after.stockBatchId = stockBatchId;
      }
    }
    product.stock = product.batches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
    product.markModified?.('batches');
  } else {
    const next = Number(product.stock || 0) + newQty - oldQty;
    if (next < Number(product.reservedStock || 0)) fail(`Cannot reduce ${product.name}: received stock has been sold or reserved.`);
    product.stock = next;
  }
  if (changed) {
    const movement = (item, type, quantity) => ({
      type, quantity, ...prices(item), batchNumber: item.batchNumber,
      sourceGRN: grn._id, sourceGRNItem: item._id, purchaseOrder: grn.purchaseOrder,
      supplierName: grn.supplierName, addedBy: actor,
      reason: `GRN ${grn.grnNumber} / ${grn.poNumber}`, date: new Date(),
    });
    if (before && after && before.batchNumber === after.batchNumber) {
      const delta = newQty - oldQty;
      if (delta) product.stockMovements.push(movement(after, delta > 0 ? 'add' : 'remove', Math.abs(delta)));
    } else {
      if (before && oldQty) product.stockMovements.push(movement(before, 'remove', oldQty));
      if (after && newQty) product.stockMovements.push(movement(after, 'add', newQty));
    }
    product.markModified?.('stockMovements');
  }
}

function recalculateReceipt(grn) {
  grn.subtotal = 0;
  let itemTax = 0;
  for (const item of grn.items) {
    item.subtotal = quantityOf(item) * Number(item.unitPrice || 0);
    item.tax = item.subtotal * Number(item.taxRate || 0) / 100;
    item.totalWithTax = item.subtotal + item.tax;
    grn.subtotal += item.subtotal;
    itemTax += item.tax;
  }
  grn.chargesSubtotal = 0; grn.chargesTax = 0;
  for (const field of ['freight', 'insurance', 'inventoryCharges']) {
    const charge = grn[field];
    if (!charge) continue;
    charge.taxAmount = Number(charge.amount || 0) * Number(charge.taxRate || 0) / 100;
    grn.chargesSubtotal += Number(charge.amount || 0);
    grn.chargesTax += charge.taxAmount;
  }
  grn.totalTax = itemTax + grn.chargesTax;
  const exact = grn.subtotal + grn.chargesSubtotal + grn.totalTax;
  grn.grandTotal = grn.currency && grn.currency !== 'INR' ? Number(exact.toFixed(2)) : Math.round(exact);
  grn.roundOff = Number((grn.grandTotal - exact).toFixed(2));
}

module.exports = { idOf, fail, plain, quantityOf, purchaseLine, syncPurchaseQuantities, validateItem, applyReceiptStock, recalculateReceipt };
