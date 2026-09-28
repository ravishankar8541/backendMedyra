const Product = require('../models/Product');
const PurchaseOrder = require('../models/PurchaseOrder');
const PurchaseReturn = require('../models/PurchaseReturn');
const JournalEntry = require('../models/JournalEntry');
const { ConsolidatedInvoice, GoodsReceipt } = require('../models/GoodsReceipt');
const { idOf, fail, quantityOf } = require('./grnStock');

// Legacy records may outlive their invoice/return documents. Recover only from
// explicitly receipt-owned movements; never infer reversal from an empty batch.
module.exports = async function deleteOrphanReceipt(grn, actor) {
  const invoiceIds = [...new Set([grn.invoiceId, grn.consolidatedInvoiceId].filter(Boolean).map(idOf))];
  if (!invoiceIds.length) return false;
  if (await ConsolidatedInvoice.exists({ _id: { $in: invoiceIds } })) fail('Delete the linked purchase invoice first.');
  if (await PurchaseOrder.exists({ _id: grn.purchaseOrder })) fail(`Delete linked Purchase Order ${grn.poNumber} first.`);
  const receipts = await GoodsReceipt.find({ $or: [{ _id: grn._id }, { invoiceId: { $in: invoiceIds } }, { consolidatedInvoiceId: { $in: invoiceIds } }] });
  if (await PurchaseReturn.exists({ $or: [{ invoice: { $in: invoiceIds } }, { 'items.grnId': { $in: receipts.map(row => row._id) } }] })) {
    if (invoiceIds.length !== 1) fail('Receipt invoice links are inconsistent. Reconcile them first.');
    await require('./deletePurchaseInvoice')({ _id: grn.invoiceId || grn.consolidatedInvoiceId, grnIds: receipts.map(row => row._id), deleteOne: async () => {} }, actor);
    return true;
  }
  const returnNumbers = new Set();
  for (const receipt of receipts) {
    if (await PurchaseOrder.exists({ _id: receipt.purchaseOrder })) fail(`Delete linked Purchase Order ${receipt.poNumber} first.`);
    if (await ConsolidatedInvoice.exists({ $or: [{ grnIds: receipt._id }, { grnId: receipt._id }, { _id: { $in: [receipt.invoiceId, receipt.consolidatedInvoiceId].filter(Boolean) } }] }))
      fail('A receipt still belongs to an existing invoice. Delete that invoice first.');
    for (const productId of [...new Set(receipt.items.map(row => idOf(row.productId)))]) {
      const product = await Product.findById(productId);
      if (!product) fail('A receipt product is missing. Reconcile its stock first.');
      const items = receipt.items.filter(row => idOf(row.productId) === productId);
      const movements = product.stockMovements.filter(row => idOf(row.sourceGRN) === idOf(receipt._id));
      const net = new Map();
      const receiptNet = new Map();
      for (const movement of movements) {
        const original = movement.reason === `GRN ${receipt.grnNumber} / ${receipt.poNumber}`;
        const returned = /^(Purchase return |Restocked\/Cancelled return )PR-/.test(movement.reason || '');
        const replacement = /^Replacement stock received .* for PR-/.test(movement.reason || '');
        if (returned || replacement) {
          const number = movement.reason.match(/(PR-\S+)$/)?.[1];
          if (!number) fail('Return movement has an invalid reference. Reconcile it first.');
          returnNumbers.add(number);
        }
        if ((!original && !returned && !replacement) || !['add', 'remove'].includes(movement.type))
          fail(`Unrecognized stock history for ${receipt.grnNumber}. Reconcile it before deletion.`);
        const delta = Number(movement.quantity) * (movement.type === 'add' ? 1 : -1);
        if (!Number.isFinite(delta)) fail('Invalid stock history quantity.');
        const item = items.find(row => idOf(row._id) === idOf(movement.sourceGRNItem));
        if (original) {
          if (!item) fail('Receipt movement is missing its item link. Reconcile stock first.');
          receiptNet.set(idOf(item._id), (receiptNet.get(idOf(item._id)) || 0) + delta);
        }
        let key = 'non-batch';
        if (product.productType !== 'non-batch') {
          const lots = product.batches.filter(lot => !replacement && item?.stockBatchId
            ? idOf(lot._id) === idOf(item.stockBatchId)
            : lot.batchNumber === movement.batchNumber && (!replacement || Number(lot.mrp) === Number(movement.mrp)));
          if (lots.length !== 1) fail(`Cannot identify stock batch ${movement.batchNumber} safely. Reconcile it first.`);
          key = idOf(lots[0]._id);
        }
        net.set(key, (net.get(key) || 0) + delta);
      }
      for (const item of items) {
        const value = receiptNet.get(idOf(item._id));
        if (quantityOf(item) > 0 && (value === undefined || (Math.abs(value - quantityOf(item)) > 1e-6 && Math.abs(value) > 1e-6)))
          fail(`Incomplete stock history for ${receipt.grnNumber}. Reconcile it before deletion.`);
      }
      for (const [key, quantity] of net) {
        if (quantity < -1e-6) fail('Stock history indicates an excess reversal. Reconcile it first.');
        const lot = key === 'non-batch' ? null : product.batches.id(key);
        const available = Number(lot ? lot.quantity : product.stock);
        const reserved = Number(lot ? lot.reservedQuantity || 0 : product.reservedStock || 0);
        if (available - quantity < reserved - 1e-6) fail(`Cannot delete ${receipt.grnNumber}: ${product.name} has sold or reserved stock. Reverse those dependent transactions first.`);
        if (lot) lot.quantity = Math.max(0, available - quantity);
        else product.stock = Math.max(0, available - quantity);
      }
      product.batches = product.batches.filter(lot => !(net.has(idOf(lot._id)) && !Number(lot.quantity) && !Number(lot.reservedQuantity)));
      product.stockMovements = product.stockMovements.filter(row => idOf(row.sourceGRN) !== idOf(receipt._id));
      if (product.productType !== 'non-batch') product.stock = product.batches.reduce((sum, lot) => sum + Number(lot.quantity), 0);
      await product.save();
    }
  }
  if (returnNumbers.size) {
    if (await PurchaseReturn.exists({ returnNumber: { $in: [...returnNumbers] } })) fail('A return still exists with inconsistent receipt links. Reconcile it before deletion.');
    await JournalEntry.deleteMany({ sourceModule: 'purchase_return', referenceNumber: { $in: [...returnNumbers] } });
  }
  await JournalEntry.deleteMany({ sourceModule: { $in: ['purchase_invoice', 'payment_disbursement'] }, sourceId: { $in: [...invoiceIds, ...receipts.map(row => row._id)] } });
  await GoodsReceipt.deleteMany({ _id: { $in: receipts.map(row => row._id) } });
  return true;
};
