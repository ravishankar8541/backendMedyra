// controllers/purchaseReturnController.js
const mongoose = require('mongoose');
const crypto = require('crypto');
const PurchaseReturn = require('../models/PurchaseReturn');
const Product = require('../models/Product');
const { GoodsReceipt, ConsolidatedInvoice } = require('../models/GoodsReceipt');
const JournalEntry = require('../models/JournalEntry');
const transaction = require('../utils/receiptTransaction');
const { idOf, fail } = require('../utils/grnStock');
const { money, settleInvoice } = require('../utils/purchaseSettlement');
const postReturnJournal = require('../utils/purchaseReturnJournal');

const qtyRound = (value) => Math.round(value * 1000000) / 1000000;

function objectId(id) {
  if (!mongoose.isValidObjectId(id)) fail('Invalid record ID.');
  return id;
}

function validDate(value) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value || '') ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail('Enter a valid return date (YYYY-MM-DD).');
  }
  return value;
}

async function getSource(invoiceId) {
  const invoice = await ConsolidatedInvoice.findById(objectId(invoiceId));
  if (!invoice) fail('Purchase invoice not found.');

  const grns = await GoodsReceipt.find({
    $or: [
      { consolidatedInvoiceId: invoice._id },
      { invoiceId: invoice._id },
      { _id: { $in: invoice.grnIds || [] } },
      { purchaseOrder: invoice.purchaseOrder }
    ],
    status: 'completed'
  });

  const posted = await PurchaseReturn.find({ invoice: invoice._id, status: 'completed' });
  const returned = new Map();
  for (const doc of posted) {
    for (const row of doc.items) {
      const k = idOf(row.invoiceItemId) || idOf(row.product);
      returned.set(k, (returned.get(k) || 0) + Number(row.quantity || 0));
    }
  }

  const items = [];
  for (const row of invoice.items) {
    const grn = grns.find((g) =>
      g.items.some(
        (i) =>
          idOf(i._id) === idOf(row._id) ||
          idOf(i.purchaseOrderItemId) === idOf(row.purchaseOrderItemId) ||
          idOf(i.productId) === idOf(row.productId)
      )
    );

    const source =
      grn?.items.id(row._id) ||
      grn?.items.find(
        (i) =>
          idOf(i.purchaseOrderItemId) === idOf(row.purchaseOrderItemId) ||
          idOf(i.productId) === idOf(row.productId)
      );

    const product = await Product.findById(row.productId);
    const lot = source?.stockBatchId && product?.batches.id(source.stockBatchId);
    const nonBatch = product?.productType === 'non-batch';
    const received = Number(source?.acceptedQty ?? row.acceptedQty ?? row.quantity ?? 0);
    const returnedQty = returned.get(idOf(row._id)) || returned.get(idOf(row.productId)) || 0;

    const availableStock = !product
      ? 0
      : nonBatch
      ? Number(product.stock || 0) - Number(product.reservedStock || 0)
      : lot
      ? Number(lot.quantity) - Number(lot.reservedQuantity || 0)
      : 0;

    items.push({
      ...row.toObject(),
      invoiceItemId: row._id,
      grnId: grn?._id,
      stockBatchId: source?.stockBatchId,
      receivedQty: received,
      returnedQty,
      availableStock: Math.max(0, availableStock),
      returnableQty: Math.max(0, qtyRound(Math.min(received - returnedQty, availableStock))),
      unavailableReason: !product
        ? 'Product missing from database'
        : availableStock <= 0
        ? 'Zero stock available in inventory'
        : ''
    });
  }

  return { invoice, items };
}

async function refreshCredit(invoice) {
  const docs = await PurchaseReturn.find({ invoice: invoice._id, status: 'completed' });
  invoice.returnCredit = money(docs.reduce((s, d) => s + Number(d.total || 0), 0));
  invoice.returnSubtotal = money(docs.reduce((s, d) => s + Number(d.subtotal || 0), 0));
  invoice.returnTax = money(docs.reduce((s, d) => s + Number(d.totalTax || 0), 0));
  settleInvoice(invoice);
  await invoice.save();
}

async function moveStock(row, direction, doc, actor) {
  const product = await Product.findById(row.product);
  if (!product) fail(`Product missing: ${row.productName}`);
  const qty = Number(row.quantity);

  if (product.productType !== 'non-batch') {
    let lot = product.batches.id(row.stockBatchId);
    if (!lot && row.batchNumber && row.batchNumber !== 'N/A') {
      lot = product.batches.find(
        (b) => String(b.batchNumber).trim() === String(row.batchNumber).trim()
      );
    }

    if (direction < 0) {
      if (!lot) fail(`Stock batch "${row.batchNumber}" not found for ${row.productName}.`);
      if (Number(lot.quantity) - Number(lot.reservedQuantity || 0) + 1e-9 < qty) {
        fail(`Insufficient stock in batch ${row.batchNumber} to return ${qty} units.`);
      }
      lot.quantity = qtyRound(Math.max(0, lot.quantity - qty));
    } else {
      if (lot) {
        lot.quantity = qtyRound(lot.quantity + qty);
      } else {
        product.batches.push({
          batchNumber: row.batchNumber || 'RESTOCK',
          quantity: qty,
          unitPrice: row.unitPrice,
          costPrice: row.unitPrice * (doc.currency === 'INR' ? 1 : doc.exchangeRate),
          sellingPrice: row.unitPrice * 1.2,
          addedDate: new Date().toISOString().slice(0, 10),
          addedBy: actor,
          reason: `Restocked from return ${doc.returnNumber}`,
          supplierName: doc.supplierName || doc.supplier || '', // ✅ ADDED
          supplier: doc.supplierId || null // ✅ ADDED
        });
      }
    }
    product.markModified('batches');
  } else {
    if (direction < 0) {
      if (Number(product.stock) - Number(product.reservedStock || 0) + 1e-9 < qty) {
        fail(`Insufficient physical stock for ${row.productName}.`);
      }
      product.stock = qtyRound(Math.max(0, product.stock - qty));
    } else {
      product.stock = qtyRound(product.stock + qty);
    }
  }

  if (!Array.isArray(product.stockMovements)) product.stockMovements = [];
  product.stockMovements.push({
    type: direction < 0 ? 'remove' : 'add',
    quantity: qty,
    batchNumber: row.batchNumber,
    sourceGRN: row.grnId,
    sourceGRNItem: row.invoiceItemId,
    purchaseOrder: doc.purchaseOrder,
    supplierName: doc.supplierName || doc.supplier || '', // ✅ Ensured
    addedBy: actor,
    costPrice: row.unitPrice * (doc.currency === 'INR' ? 1 : doc.exchangeRate),
    reason:
      direction < 0
        ? `Purchase return ${doc.returnNumber}`
        : `Restocked/Cancelled return ${doc.returnNumber}`,
    date: new Date()
  });

  await product.save();
}

// ============================================
// GET RETURN SOURCE
// ============================================
exports.getReturnSource = async (req, res) => {
  try {
    res.json({ success: true, data: await getSource(req.params.invoiceId) });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

// ============================================
// CREATE PURCHASE RETURN (DEBIT NOTE)
// ============================================
const create = async (req, res) => {
  const { invoiceId, requestId, items, returnReason, notes = '', returnDate } = req.body;
  if (typeof requestId !== 'string' || requestId.length < 8) fail('A valid request ID is required.');
  if (!Array.isArray(items) || !items.length) fail('Select at least one item to return.');
  if (!String(returnReason || '').trim()) fail('Return reason is required.');
  validDate(returnDate);

  const requestHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ invoiceId, items, returnReason, notes, returnDate }))
    .digest('hex');

  const existing = await PurchaseReturn.findOne({ requestId });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      fail('This request ID was already used. Reload before submitting changes.');
    }
    return res.json({ success: true, data: existing, message: 'Return already recorded.' });
  }

  const { invoice, items: sourceItems } = await getSource(invoiceId);
  if (returnDate < String(invoice.invoiceDate).slice(0, 10)) {
    fail('Return date cannot be before invoice date.');
  }

  const seen = new Set();
  const rows = [];

  for (const input of items) {
    const key = idOf(input.invoiceItemId);
    const source = sourceItems.find((row) => idOf(row.invoiceItemId) === key);
    const quantity = Number(input.quantity);

    if (!source || seen.has(key)) fail('Invalid or duplicate invoice item.');
    seen.add(key);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      fail(`Enter a valid return quantity for ${source.productName}.`);
    }
    if (quantity > source.returnableQty + 1e-9) {
      fail(
        `Return quantity (${quantity}) exceeds returnable stock (${source.returnableQty}) for ${source.productName}.`
      );
    }

    const total = money(quantity * Number(source.unitPrice));
    const tax = money((total * Number(source.taxRate)) / 100);

    rows.push({
      invoiceItemId: source.invoiceItemId,
      grnId: source.grnId,
      stockBatchId: source.stockBatchId,
      product: source.productId,
      productName: source.productName,
      sku: source.sku,
      hsn: source.hsn,
      batchNumber: source.batchNumber,
      unit: source.unit,
      quantity,
      replacedQty: 0,
      unitPrice: source.unitPrice,
      taxRate: source.taxRate,
      total,
      totalWithTax: money(total + tax),
      reason: String(input.reason || returnReason).trim()
    });
  }

  const subtotal = money(rows.reduce((s, r) => s + r.total, 0));
  const totalTax = money(rows.reduce((s, r) => s + (r.totalWithTax - r.total), 0));
  const fullyReturned = sourceItems.every((source) => {
    const matchedRow = rows.find((r) => idOf(r.invoiceItemId) === idOf(source.invoiceItemId));
    return (
      Number(source.returnedQty) + Number(matchedRow?.quantity || 0) >=
      Number(source.acceptedQty)
    );
  });

  const creditBeforeCap = fullyReturned
    ? money(
        invoice.grandTotal -
          Number(invoice.chargesSubtotal || 0) -
          Number(invoice.chargesTax || 0) -
          Number(invoice.returnCredit || 0)
      )
    : money(subtotal + totalTax);

  const total = money(
    Math.min(
      Math.max(0, creditBeforeCap),
      Math.max(0, invoice.grandTotal - Number(invoice.returnCredit || 0))
    )
  );

  const _id = new mongoose.Types.ObjectId();
  const year = returnDate.slice(0, 4);
  const doc = new PurchaseReturn({
    _id,
    returnNumber: `PR-${year}/${_id.toString().slice(-6).toUpperCase()}`,
    requestId,
    requestHash,
    invoice: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    poNumber: invoice.poNumber,
    purchaseOrder: invoice.purchaseOrder,
    supplier: invoice.supplierName,
    supplierId: invoice.supplierId,
    supplierName: invoice.supplierName,
    supplierGST: invoice.supplierGST,
    supplierAddress: invoice.supplierAddress,
    supplierContact: invoice.supplierContact,
    supplierEmail: invoice.supplierEmail,
    returnDate,
    items: rows,
    currency: invoice.currency,
    exchangeRate: invoice.exchangeRate,
    subtotal,
    totalTax,
    total,
    roundOff: money(total - subtotal - totalTax),
    gstType: invoice.gstType,
    igst: invoice.gstType === 'igst' ? totalTax : 0,
    cgst: invoice.gstType === 'cgst_sgst' ? money(totalTax / 2) : 0,
    sgst: invoice.gstType === 'cgst_sgst' ? money(totalTax - money(totalTax / 2)) : 0,
    returnReason: String(returnReason).trim(),
    notes,
    status: 'completed',
    replacementStatus: 'pending',
    createdBy: req.user?._id || req.user?.id
  });

  for (const row of doc.items) {
    await moveStock(row, -1, doc, req.user?.name || 'System');
  }

  await doc.save();
  await refreshCredit(invoice);
  await postReturnJournal(doc);

  res.status(201).json({
    success: true,
    data: doc,
    message: 'Purchase Return (Debit Note) posted. Stock deducted and vendor credit updated.'
  });
};
exports.createPurchaseReturn = transaction(create);

// ============================================
// UPDATE PURCHASE RETURN
// ============================================
exports.updatePurchaseReturn = transaction(async (req, res) => {
  const doc = await PurchaseReturn.findById(objectId(req.params.id));
  if (!doc) fail('Purchase return not found.');
  if (doc.status === 'cancelled') fail('Cannot edit a cancelled purchase return.');

  const { returnDate, returnReason, notes, items } = req.body;
  if (returnDate) validDate(returnDate);

  const invoice = await ConsolidatedInvoice.findById(doc.invoice);
  if (!invoice) fail('Linked purchase invoice not found.');

  if (Array.isArray(items) && items.length > 0) {
    const { items: sourceItems } = await getSource(invoice._id);

    for (const upd of items) {
      const existingRow = doc.items.find(
        (i) =>
          idOf(i.invoiceItemId) === idOf(upd.invoiceItemId) ||
          idOf(i.product) === idOf(upd.productId || upd.product)
      );
      if (!existingRow) continue;

      const oldQty = Number(existingRow.quantity);
      const newQty = Number(upd.quantity);
      if (!Number.isFinite(newQty) || newQty <= 0) {
        fail(`Enter a valid quantity for ${existingRow.productName}.`);
      }

      const delta = newQty - oldQty;
      if (delta > 0) {
        const sourceRow = sourceItems.find(
          (s) => idOf(s.invoiceItemId) === idOf(existingRow.invoiceItemId)
        );
        if (delta > (sourceRow?.returnableQty || 0) + 1e-9) {
          fail(
            `Cannot increase return for ${existingRow.productName} by ${delta}. Insufficient inventory.`
          );
        }
        await moveStock(
          { ...existingRow.toObject(), quantity: delta },
          -1,
          doc,
          req.user?.name || 'System'
        );
      } else if (delta < 0) {
        await moveStock(
          { ...existingRow.toObject(), quantity: Math.abs(delta) },
          1,
          doc,
          req.user?.name || 'System'
        );
      }

      existingRow.quantity = newQty;
      if (upd.reason) existingRow.reason = String(upd.reason).trim();
      const lineSub = money(newQty * existingRow.unitPrice);
      const lineTax = money((lineSub * existingRow.taxRate) / 100);
      existingRow.total = lineSub;
      existingRow.totalWithTax = money(lineSub + lineTax);
    }

    doc.subtotal = money(doc.items.reduce((s, r) => s + r.total, 0));
    doc.totalTax = money(doc.items.reduce((s, r) => s + (r.totalWithTax - r.total), 0));
    doc.total = money(doc.subtotal + doc.totalTax);
    doc.roundOff = money(doc.total - doc.subtotal - doc.totalTax);
    doc.markModified('items');
  }

  if (returnDate) doc.returnDate = returnDate;
  if (returnReason) doc.returnReason = String(returnReason).trim();
  if (notes !== undefined) doc.notes = notes;

  await doc.save();
  await refreshCredit(invoice);

  res.json({
    success: true,
    data: doc,
    message: 'Purchase Return updated. Stock delta and supplier credits recalculated.'
  });
});

// ============================================
// RECEIVE REPLACEMENT STOCK (MULTI-ROUND / PARTIAL SUPPORT)
// ============================================
exports.receiveReplacement = transaction(async (req, res) => {
  const doc = await PurchaseReturn.findById(objectId(req.params.id));
  if (!doc) fail('Purchase return record not found.');
  if (doc.status === 'cancelled') fail('Cannot receive replacement for a cancelled return.');

  const { receivedDate = new Date().toISOString().slice(0, 10), notes = '', items } = req.body;
  if (!Array.isArray(items) || !items.length) {
    fail('Provide at least one replacement item to restock.');
  }

  const replacementEntries = [];

  for (const rep of items) {
    const qty = Number(rep.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue; // Skip 0 quantity items gracefully

    const targetItem = doc.items.find(
      (i) => idOf(i._id) === idOf(rep.itemId) || idOf(i.product) === idOf(rep.productId)
    );
    if (!targetItem) fail('Unknown item on return.');

    const alreadyReplaced = Number(targetItem.replacedQty || 0);
    const maxCanReplace = Number(targetItem.quantity) - alreadyReplaced;
    if (qty > maxCanReplace + 1e-9) {
      fail(
        `Replacement quantity (${qty}) exceeds pending returned units (${maxCanReplace}) for ${targetItem.productName}.`
      );
    }

    const product = await Product.findById(targetItem.product);
    if (!product) fail(`Product not found: ${targetItem.productName}`);

    const batchNo = (
      rep.batchNumber ||
      targetItem.batchNumber ||
      `RESTOCK-${Date.now().toString().slice(-4)}`
    ).trim();

    if (product.productType !== 'non-batch') {
      let lot = product.batches.find((b) => String(b.batchNumber).trim() === batchNo);
      if (lot) {
        lot.quantity = qtyRound(lot.quantity + qty);
        if (rep.expDate) lot.expDate = rep.expDate;
        if (rep.mfgDate) lot.mfgDate = rep.mfgDate;
        // ✅ Ensure supplier info is present even on existing lot
        if (!lot.supplierName) lot.supplierName = doc.supplierName || doc.supplier || '';
        if (!lot.supplier) lot.supplier = doc.supplierId || null;
      } else {
        product.batches.push({
          batchNumber: batchNo,
          mfgDate: rep.mfgDate || '',
          expDate: rep.expDate || '',
          quantity: qty,
          unitPrice: targetItem.unitPrice,
          costPrice: targetItem.unitPrice * (doc.currency === 'INR' ? 1 : doc.exchangeRate),
          sellingPrice: targetItem.unitPrice * 1.2,
          addedDate: receivedDate,
          addedBy: req.user?.name || 'System',
          reason: `Replacement received (${alreadyReplaced + qty}/${targetItem.quantity}) for ${doc.returnNumber}`,
          supplierName: doc.supplierName || doc.supplier || '', // ✅ ADDED
          supplier: doc.supplierId || null // ✅ ADDED
        });
      }
      product.markModified('batches');
    } else {
      product.stock = qtyRound(product.stock + qty);
    }

    if (!Array.isArray(product.stockMovements)) product.stockMovements = [];
    product.stockMovements.push({
      type: 'add',
      quantity: qty,
      batchNumber: batchNo,
      sourceGRN: targetItem.grnId,
      purchaseOrder: doc.purchaseOrder,
      supplierName: doc.supplierName || doc.supplier || '', // ✅ Ensured
      addedBy: req.user?.name || 'System',
      costPrice: targetItem.unitPrice * (doc.currency === 'INR' ? 1 : doc.exchangeRate),
      reason: `Replacement stock received (${alreadyReplaced + qty}/${targetItem.quantity}) for ${doc.returnNumber}`,
      date: new Date()
    });

    await product.save();

    targetItem.replacedQty = alreadyReplaced + qty;
    replacementEntries.push({
      productId: product._id,
      productName: product.name,
      quantity: qty,
      batchNumber: batchNo,
      mfgDate: rep.mfgDate || '',
      expDate: rep.expDate || '',
      unit: targetItem.unit
    });
  }

  if (replacementEntries.length === 0) {
    fail('Enter a valid replacement quantity (> 0) for at least one item.');
  }

  // Update overall replacement status based on accumulated replacedQty vs total quantity
  const totalReturned = doc.items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
  const totalReplaced = doc.items.reduce((sum, i) => sum + Number(i.replacedQty || 0), 0);
  doc.replacementStatus =
    totalReplaced >= totalReturned ? 'received' : totalReplaced > 0 ? 'partial' : 'pending';

  if (!Array.isArray(doc.replacementHistory)) doc.replacementHistory = [];
  doc.replacementHistory.push({
    receivedDate,
    receivedBy: req.user?.name || 'System',
    notes: notes || `Received replacement batch (${totalReplaced}/${totalReturned} units replaced)`,
    items: replacementEntries
  });

  doc.markModified('items');
  doc.markModified('replacementHistory');
  await doc.save();

  res.json({
    success: true,
    data: doc,
    message: `✅ Restocked ${replacementEntries.reduce((s, i) => s + i.quantity, 0)} replacement units into inventory! (${totalReplaced}/${totalReturned} total units replaced)`
  });
});

// ============================================
// CANCEL PURCHASE RETURN
// ============================================
exports.cancelPurchaseReturn = transaction(async (req, res) => {
  const doc = await PurchaseReturn.findById(objectId(req.params.id));
  if (!doc) fail('Purchase return not found.');
  if (doc.status === 'cancelled') return res.json({ success: true, data: doc });

  const invoice = await ConsolidatedInvoice.findById(doc.invoice);
  if (!invoice) fail('The linked invoice is missing.');

  for (const row of doc.items) {
    const netRestock = Math.max(0, row.quantity - (row.replacedQty || 0));
    if (netRestock > 0) {
      await moveStock(
        { ...row.toObject(), quantity: netRestock },
        1,
        doc,
        req.user?.name || 'System'
      );
    }
  }

  doc.status = 'cancelled';
  doc.cancelledAt = new Date();
  doc.cancelledBy = req.user?.name || 'System';
  doc.cancellationReason = String(req.body.reason || 'Cancelled by user').trim();

  await doc.save();
  await refreshCredit(invoice);
  await JournalEntry.updateOne(
    { sourceModule: 'purchase_return', sourceId: doc._id },
    { $set: { status: 'void' } }
  );

  res.json({
    success: true,
    data: doc,
    message: 'Return cancelled. Stock restored and supplier credit reversed.'
  });
});

// ============================================
// DELETE PURCHASE RETURN
// ============================================
exports.deletePurchaseReturn = transaction(async (req, res) => {
  const doc = await PurchaseReturn.findById(objectId(req.params.id));
  if (!doc) fail('Purchase return not found.');

  const invoice = await ConsolidatedInvoice.findById(doc.invoice);

  if (doc.status === 'completed') {
    for (const row of doc.items) {
      const netRestock = Math.max(0, row.quantity - (row.replacedQty || 0));
      if (netRestock > 0) {
        await moveStock(
          { ...row.toObject(), quantity: netRestock },
          1,
          doc,
          req.user?.name || 'System'
        );
      }
    }
  }

  await JournalEntry.deleteMany({
    $or: [{ sourceId: doc._id }, { referenceNumber: doc.returnNumber }]
  });

  await doc.deleteOne();

  if (invoice) {
    await refreshCredit(invoice);
  }

  res.json({
    success: true,
    message: `Purchase Return ${doc.returnNumber} permanently deleted. Inventory restored and supplier credit reversed.`
  });
});

// ============================================
// GET ALL PURCHASE RETURNS
// ============================================
exports.getPurchaseReturns = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const query = {};
    const search = String(req.query.search || '')
      .slice(0, 100)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (search) {
      query.$or = ['returnNumber', 'invoiceNumber', 'poNumber', 'supplierName'].map((field) => ({
        [field]: { $regex: search, $options: 'i' }
      }));
    }
    if (['completed', 'cancelled', 'pending'].includes(req.query.status)) {
      query.status = req.query.status;
    }

    const [data, total] = await Promise.all([
      PurchaseReturn.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      PurchaseReturn.countDocuments(query)
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, pages: Math.ceil(total / limit), total, limit }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET SINGLE PURCHASE RETURN
// ============================================
exports.getPurchaseReturn = async (req, res) => {
  try {
    const data = await PurchaseReturn.findById(objectId(req.params.id));
    if (!data) return res.status(404).json({ success: false, message: 'Return not found.' });
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

// ============================================
// PUBLIC DEBIT NOTE VIEW
// ============================================
exports.getPublicDebitNoteView = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .send(
          '<h2 style="font-family:sans-serif;text-align:center;margin-top:50px;color:#ef4444;">Invalid Debit Note Link</h2>'
        );
    }

    const doc = await PurchaseReturn.findById(id);
    if (!doc) {
      return res
        .status(404)
        .send(
          '<h2 style="font-family:sans-serif;text-align:center;margin-top:50px;color:#ef4444;">Debit Note Not Found</h2>'
        );
    }

    const currency = doc.currency || 'INR';
    const sym = currency === 'INR' ? 'Rs.' : currency;
    const debitNumber = String(doc.returnNumber || '').replace(/^PR-/i, 'DN-');

    let formattedDate = 'N/A';
    if (doc.returnDate) {
      try {
        const parts = String(doc.returnDate).slice(0, 10).split('-');
        if (parts.length === 3) formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
        else formattedDate = doc.returnDate;
      } catch {
        formattedDate = doc.returnDate;
      }
    }

    const subtotal = Number(doc.subtotal || 0);
    const totalTax = Number(doc.totalTax || 0);
    const roundOff = Number(doc.roundOff || 0);
    const total = Number(doc.total || 0);
    const creditsUsed = total;
    const creditsRemaining = 0;

    let rowIndex = 0;
    const itemRows = (doc.items || [])
      .map((item) => {
        rowIndex++;
        const qty = Number(item.quantity) || 0;
        const rate = Number(item.unitPrice) || 0;
        const lineTotal = Number(item.total || qty * rate);
        const batchDisplay =
          item.batchNumber && item.batchNumber !== 'N/A' && item.batchNumber !== '-'
            ? item.batchNumber
            : '—';

        return `
        <tr>
          <td style="padding:10px 10px; border-bottom:1px solid #e2e8f0; text-align:center; font-weight:700; color:#475569;">${rowIndex}</td>
          <td style="padding:10px 10px; border-bottom:1px solid #e2e8f0; vertical-align:top;">
            <p style="font-weight:800; color:#000000; margin:0 0 2px 0; font-size:12px;">${item.productName || 'Product'}</p>
            ${item.reason ? `<p style="font-size:10px; color:#64748b; margin:0;">${item.reason}</p>` : ''}
          </td>
          <td style="padding:10px 10px; border-bottom:1px solid #e2e8f0; text-align:center; vertical-align:top;">
            <span style="display:inline-block; font-family:monospace; font-size:11px; font-weight:700; color:#0f172a; background:#f1f5f9; padding:2px 7px; border-radius:4px; border:1px solid #e2e8f0;">
              ${batchDisplay}
            </span>
          </td>
          <td style="padding:10px 10px; border-bottom:1px solid #e2e8f0; text-align:center; font-family:monospace; font-size:11px; color:#475569; vertical-align:top;">
            ${item.hsn || '30049099'}
          </td>
          <td style="padding:10px 10px; border-bottom:1px solid #e2e8f0; text-align:center; font-weight:800; vertical-align:top;">
            ${qty}<br/><span style="font-size:10px; font-weight:normal; color:#64748b;">${item.unit || 'Strips'}</span>
          </td>
          <td style="padding:10px 10px; border-bottom:1px solid #e2e8f0; text-align:right; vertical-align:top; font-weight:600;">${rate.toFixed(2)}</td>
          <td style="padding:10px 10px; border-bottom:1px solid #e2e8f0; text-align:right; font-weight:800; color:#000; vertical-align:top;">${lineTotal.toFixed(2)}</td>
        </tr>`;
      })
      .join('');

    let taxRows = '';
    if (doc.gstType === 'cgst_sgst') {
      const halfTax = totalTax / 2;
      taxRows = `
        <div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#334155;">CGST</span><span style="font-weight:700;">${halfTax.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#334155;">SGST</span><span style="font-weight:700;">${halfTax.toFixed(2)}</span></div>`;
    } else {
      taxRows = `
        <div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#334155;">IGST</span><span style="font-weight:700;">${totalTax.toFixed(2)}</span></div>`;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Debit Note - ${debitNumber}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
    body { font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:#f8fafc; padding:25px; font-size:11px; color:#0f172a; line-height:1.4; }
    .page-container { max-width:210mm; min-height:297mm; margin:0 auto; background:#ffffff; padding:36px; border:1px solid #e2e8f0; border-radius:8px; box-shadow:0 4px 15px rgba(0,0,0,0.05); display:flex; flex-direction:column; justify-content:space-between; }
    .header-table { width:100%; border-collapse:collapse; margin-bottom:16px; }
    .logo-box { width:140px; height:70px; background-color:#000000 !important; border-radius:8px; padding:6px; display:flex; align-items:center; justify-content:center; margin-bottom:10px; }
    .logo-img { width:100%; height:100%; object-fit:contain; }
    .title { font-size:26px; font-weight:900; color:#000; letter-spacing:-0.5px; }
    .subtitle { font-size:12px; font-weight:800; color:#1e293b; margin-top:3px; }
    .credit-box-top { display:inline-block; border:1px solid #cbd5e1; background:#f8fafc; padding:6px 14px; border-radius:6px; text-align:right; margin-top:8px; }
    .items-table { width:100%; border-collapse:collapse; margin:16px 0; font-size:11px; }
    .items-table th { background-color:#334155 !important; color:#ffffff !important; font-weight:800; font-size:10px; text-transform:uppercase; padding:9px 10px; text-align:left; }
    .bottom-section { display:grid; grid-template-columns:1.2fr 1fr; gap:30px; margin-top:8px; align-items:start; }
    .totals-area { border-top:1px solid #cbd5e1; padding-top:6px; font-size:11.5px; }
    .tot-row { display:flex; justify-content:space-between; padding:4px 0; }
    .tot-row.grand { border-top:1.5px solid #000; border-bottom:1.5px solid #000; padding:7px 0; font-weight:900; font-size:13px; margin:4px 0; }
    .tot-row.credit-rem { background:#f1f5f9; padding:7px 10px; border-radius:4px; font-weight:900; margin-top:4px; }
    .footer-signature-container { margin-top:50px; padding-top:16px; border-top:1px dashed #cbd5e1; display:flex; justify-content:space-between; align-items:flex-end; }
    .sig-area { padding-top:8px; border-top:1.5px solid #000000; width:220px; font-weight:800; font-size:11px; }
    .print-bar { max-width:210mm; margin:0 auto 16px auto; display:flex; justify-content:flex-end; }
    .print-btn { background:#013A59; color:#fff; border:none; padding:10px 20px; font-weight:700; border-radius:6px; cursor:pointer; font-size:12px; }
    @media print {
      body { background:#fff; padding:0; }
      .print-bar { display:none; }
      .page-container { border:none; box-shadow:none; padding:0; max-width:100%; min-height:auto; }
      .items-table th { background-color:#334155 !important; color:#fff !important; }
    }
  </style>
</head>
<body>
  <div class="print-bar">
    <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
  </div>
  <div class="page-container">
    <div>
      <table class="header-table">
        <tr>
          <td style="vertical-align:top; width:58%;">
            <div class="logo-box">
              <img src="https://medyra-frontend-new-cwlc.vercel.app/medyraWhiteLogo.png" class="logo-img" alt="Medyra"
                onerror="this.style.display='none';this.parentElement.innerHTML='<span style=\\'color:#fff;font-weight:900;font-size:16px;\\'>MEDYRA</span>'"/>
            </div>
            <div style="font-size:10px; color:#334155; line-height:1.45;">
              <p style="font-weight:800;font-size:11px;color:#000;">Medyra Pharmaceutical</p>
              <p>PLOT NO.65, POCKET-A, SECTOR-4, BAWANA INDUSTRIAL AREA, DSIIDC,</p>
              <p>Delhi 110039, India</p>
              <p>GSTIN: <strong>07BLQPR8835QZZR</strong></p>
              <p>Mobile No: +91 9310879396</p>
              <p>Email ID: Pharmaceutical@medyra.in</p>
              <p>Contact Person: Miss Ruby Rani</p>
            </div>
          </td>
          <td style="vertical-align:top; text-align:right; width:42%;">
            <div class="title">Debit Note</div>
            <p class="subtitle">DebitNote# ${debitNumber}</p>
            <p style="font-size:11px; font-weight:700; color:#0f172a; margin-top:4px;">Date : ${formattedDate}</p>
            <div class="credit-box-top">
              <p style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;">Credits Remaining</p>
              <h4 style="font-size:14px;font-weight:900;color:#000;margin:1px 0 0 0;">${sym}${creditsRemaining.toFixed(2)}</h4>
            </div>
          </td>
        </tr>
      </table>

      <div style="margin:16px 0 10px 0;">
        <p style="font-size:10px; font-weight:800; text-transform:uppercase; color:#64748b; margin-bottom:4px;">Vendor Address</p>
        <h4 style="font-size:12px; font-weight:900; color:#000;">${doc.supplierName || doc.supplier || 'Vendor'}</h4>
        <p style="color:#1e293b; max-width:440px; font-size:10.5px; margin-top:2px; line-height:1.35;">${doc.supplierAddress || 'N/A'}</p>
        <p style="font-size:10.5px; color:#000; margin-top:3px;"><strong>GSTIN:</strong> ${doc.supplierGST || 'N/A'}</p>
      </div>

      <table class="items-table">
        <thead>
          <tr>
            <th style="width:34px; text-align:center;">#</th>
            <th>Item & Description</th>
            <th style="width:105px; text-align:center;">Batch No.</th>
            <th style="width:95px; text-align:center;">HSN/SAC</th>
            <th style="width:75px; text-align:center;">Qty</th>
            <th style="width:90px; text-align:right;">Rate (${sym})</th>
            <th style="width:105px; text-align:right;">Amount (${sym})</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>

      <div class="bottom-section">
        <div>
          <p><strong>Reason:</strong> ${doc.returnReason || 'Stock return'}</p>
          ${doc.notes ? `<p style="margin-top:6px; color:#475569;"><strong>Notes:</strong> ${doc.notes}</p>` : ''}
        </div>
        <div class="totals-area">
          <div class="tot-row"><span style="color:#334155;">Sub Total</span><span style="font-weight:700;">${subtotal.toFixed(2)}</span></div>
          ${taxRows}
          ${
            roundOff !== 0
              ? `<div class="tot-row"><span style="color:#334155;">Round off</span><span>${roundOff > 0 ? '+' : ''}${roundOff.toFixed(2)}</span></div>`
              : ''
          }
          <div class="tot-row grand"><span>Total</span><span>${sym}${total.toFixed(2)}</span></div>
          <div class="tot-row" style="color:#dc2626;"><span style="font-weight:700;">Credits used</span><span style="font-weight:800;">(-) ${creditsUsed.toFixed(2)}</span></div>
          <div class="tot-row credit-rem"><span style="font-weight:800;">Credits Remaining</span><span style="font-weight:900;">${sym}${creditsRemaining.toFixed(2)}</span></div>
        </div>
      </div>
    </div>

    <div class="footer-signature-container">
      <div style="font-size:10px; color:#64748b;">
        <p>This is a computer generated Debit Note.</p>
        <p>Issued by Medyra Pharmaceutical.</p>
      </div>
      <div class="sig-area">Authorized Signature</div>
    </div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (err) {
    console.error('Public Debit Note View error:', err);
    return res
      .status(500)
      .send(
        '<h2 style="font-family:sans-serif;text-align:center;margin-top:50px;">Error loading Debit Note</h2>'
      );
  }
};