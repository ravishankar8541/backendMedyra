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
const qtyRound = value => Math.round(value * 1000000) / 1000000;

function objectId(id) {
  if (!mongoose.isValidObjectId(id)) fail('Invalid record ID.');
  return id;
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('Enter a valid return date.');
  return value;
}
async function getSource(invoiceId) {
  const invoice = await ConsolidatedInvoice.findById(objectId(invoiceId));
  if (!invoice) fail('Purchase invoice not found.');
  const grns = await GoodsReceipt.find({ consolidatedInvoiceId: invoice._id, status: 'completed' });
  const posted = await PurchaseReturn.find({ invoice: invoice._id, status: 'completed' });
  const returned = new Map();
  for (const doc of posted) for (const row of doc.items) returned.set(idOf(row.invoiceItemId), (returned.get(idOf(row.invoiceItemId)) || 0) + row.quantity);
  const items = [];
  for (const row of invoice.items) {
    const grn = grns.find(g => g.items.some(i => idOf(i._id) === idOf(row._id)));
    const source = grn?.items.id(row._id);
    const product = await Product.findById(row.productId);
    const lot = source?.stockBatchId && product?.batches.id(source.stockBatchId);
    const nonBatch = product?.productType === 'non-batch';
    const received = Number(source?.acceptedQty ?? 0);
    const returnedQty = returned.get(idOf(row._id)) || 0;
    const availableStock = !product || !source ? 0 : nonBatch ? Number(product.stock || 0) - Number(product.reservedStock || 0) : lot ? Number(lot.quantity) - Number(lot.reservedQuantity || 0) : 0;
    items.push({ ...row.toObject(), invoiceItemId: row._id, grnId: grn?._id, stockBatchId: source?.stockBatchId,
      receivedQty: received, returnedQty, availableStock: Math.max(0, availableStock),
      returnableQty: Math.max(0, qtyRound(Math.min(received - returnedQty, availableStock))),
      unavailableReason: !source ? 'No linked completed receipt' : !product ? 'Product missing' : !nonBatch && !lot ? 'Receipt stock lot requires reconciliation' : '',
    });
  }
  return { invoice, items };
}
async function refreshCredit(invoice) {
  const docs = await PurchaseReturn.find({ invoice: invoice._id, status: 'completed' });
  invoice.returnCredit = money(docs.reduce((s, d) => s + d.total, 0));
  invoice.returnSubtotal = money(docs.reduce((s, d) => s + d.subtotal, 0));
  invoice.returnTax = money(docs.reduce((s, d) => s + d.totalTax, 0));
  settleInvoice(invoice);
  await invoice.save(); // serializes competing returns and invoice/payment writes
}
async function moveStock(row, direction, doc, actor) {
  const product = await Product.findById(row.product);
  if (!product) fail(`Product missing: ${row.productName}`);
  if (product.productType !== 'non-batch') {
    const lot = product.batches.id(row.stockBatchId);
    if (!lot) fail(`Stock lot missing for ${row.productName}; reconcile before continuing.`);
    if (direction < 0 && Number(lot.quantity) - Number(lot.reservedQuantity || 0) + 1e-9 < row.quantity) fail(`Available stock is insufficient for ${row.productName}.`);
    lot.quantity = qtyRound(lot.quantity + direction * row.quantity);
    product.markModified('batches');
  } else {
    if (direction < 0 && Number(product.stock) - Number(product.reservedStock || 0) + 1e-9 < row.quantity) fail(`Available stock is insufficient for ${row.productName}.`);
    product.stock = qtyRound(product.stock + direction * row.quantity);
  }
  product.stockMovements.push({ type: direction < 0 ? 'remove' : 'add', quantity: row.quantity,
    batchNumber: row.batchNumber, sourceGRN: row.grnId, sourceGRNItem: row.invoiceItemId,
    purchaseOrder: doc.purchaseOrder, supplierName: doc.supplierName, addedBy: actor,
    costPrice: row.unitPrice * (doc.currency === 'INR' ? 1 : doc.exchangeRate),
    reason: `${direction < 0 ? 'Purchase return' : 'Cancelled return'} ${doc.returnNumber}`, date: new Date() });
  await product.save();
}

exports.getReturnSource = async (req, res) => {
  try { res.json({ success: true, data: await getSource(req.params.invoiceId) }); }
  catch (error) { res.status(error.status || 500).json({ success: false, message: error.message }); }
};

const create = async (req, res) => {
  const { invoiceId, requestId, items, returnReason, notes = '', returnDate } = req.body;
  if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 100) fail('A return request ID is required. Reload the form.');
  if (!Array.isArray(items) || !items.length) fail('Select at least one item to return.');
  if (!String(returnReason || '').trim()) fail('Return reason is required.');
  validDate(returnDate);
  const requestHash = crypto.createHash('sha256').update(JSON.stringify({ invoiceId, items, returnReason, notes, returnDate })).digest('hex');
  const existing = await PurchaseReturn.findOne({ requestId });
  if (existing) {
    if (existing.requestHash !== requestHash) fail('This request was already used. Reload before submitting different details.');
    return res.json({ success: true, data: existing, message: 'Return already recorded.' });
  }
  const { invoice, items: sourceItems } = await getSource(invoiceId);
  if (returnDate < invoice.invoiceDate.slice(0, 10)) fail('Return date cannot be before the invoice date.');
  const seen = new Set(), rows = [];
  for (const input of items) {
    const key = idOf(input.invoiceItemId);
    const source = sourceItems.find(row => idOf(row.invoiceItemId) === key);
    const quantity = Number(input.quantity);
    if (!source || seen.has(key)) fail('Invalid or duplicate invoice item.');
    seen.add(key);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > source.returnableQty + 1e-9 || Math.abs(quantity - Math.round(quantity * 1000) / 1000) > 1e-9) fail(`Return quantity exceeds received/available stock for ${source.productName}.`);
    const total = money(quantity * Number(source.unitPrice));
    const tax = money(total * Number(source.taxRate) / 100);
    rows.push({ invoiceItemId: source.invoiceItemId, grnId: source.grnId, stockBatchId: source.stockBatchId,
      product: source.productId, productName: source.productName, sku: source.sku, hsn: source.hsn,
      batchNumber: source.batchNumber, unit: source.unit, quantity, unitPrice: source.unitPrice,
      taxRate: source.taxRate, total, totalWithTax: money(total + tax), reason: String(input.reason || returnReason).trim() });
  }
  const subtotal = money(rows.reduce((s, r) => s + r.total, 0));
  const totalTax = money(rows.reduce((s, r) => s + r.totalWithTax - r.total, 0));
  // Do not credit more than the remaining original bill, including its round-off.
  const fullyReturned = sourceItems.every(source => Number(source.returnedQty) + Number(rows.find(row => idOf(row.invoiceItemId) === idOf(source.invoiceItemId))?.quantity || 0) >= Number(source.acceptedQty));
  const creditBeforeCap = fullyReturned
    ? money(invoice.grandTotal - Number(invoice.chargesSubtotal || 0) - Number(invoice.chargesTax || 0) - Number(invoice.returnCredit || 0))
    : money(subtotal + totalTax);
  const total = money(Math.min(Math.max(0, creditBeforeCap), Math.max(0, invoice.grandTotal - Number(invoice.returnCredit || 0))));
  const _id = new mongoose.Types.ObjectId();
  const doc = new PurchaseReturn({ _id, returnNumber: `PR-${returnDate.slice(0, 4)}/${_id.toString().slice(-12).toUpperCase()}`,
    requestId, requestHash, invoice: invoice._id, invoiceNumber: invoice.invoiceNumber,
    poNumber: invoice.poNumber, purchaseOrder: invoice.purchaseOrder, supplier: invoice.supplierName,
    supplierId: invoice.supplierId, supplierName: invoice.supplierName, supplierGST: invoice.supplierGST,
    supplierAddress: invoice.supplierAddress, supplierContact: invoice.supplierContact, supplierEmail: invoice.supplierEmail,
    returnDate, items: rows, currency: invoice.currency, exchangeRate: invoice.exchangeRate,
    subtotal, totalTax, total, roundOff: money(total - subtotal - totalTax), gstType: invoice.gstType,
    igst: invoice.gstType === 'igst' ? totalTax : 0,
    cgst: invoice.gstType === 'cgst_sgst' ? money(totalTax / 2) : 0,
    sgst: invoice.gstType === 'cgst_sgst' ? money(totalTax - money(totalTax / 2)) : 0,
    returnReason: String(returnReason).trim(), notes, status: 'completed', createdBy: req.user?._id || req.user?.id });
  for (const row of doc.items) await moveStock(row, -1, doc, req.user?.name || 'System');
  await doc.save();
  await refreshCredit(invoice);
  await postReturnJournal(doc);
  res.status(201).json({ success: true, data: doc, message: 'Purchase return posted. Stock and supplier credit updated.' });
};
exports.createPurchaseReturn = transaction(create);

exports.cancelPurchaseReturn = transaction(async (req, res) => {
  const doc = await PurchaseReturn.findById(objectId(req.params.id));
  if (!doc) fail('Purchase return not found.');
  if (doc.status === 'cancelled') return res.json({ success: true, data: doc });
  if (!doc.invoice || doc.items.some(row => !row.invoiceItemId || !row.grnId)) fail('Legacy return requires reconciliation before cancellation.');
  if (!String(req.body.reason || '').trim()) fail('Cancellation reason is required.');
  const invoice = await ConsolidatedInvoice.findById(doc.invoice);
  if (!invoice) fail('The linked invoice is missing.');
  for (const row of doc.items) await moveStock(row, 1, doc, req.user?.name || 'System');
  doc.status = 'cancelled'; doc.cancelledAt = new Date(); doc.cancelledBy = req.user?.name || 'System';
  doc.cancellationReason = String(req.body.reason).trim();
  await doc.save();
  await refreshCredit(invoice);
  await JournalEntry.updateOne({ sourceModule: 'purchase_return', sourceId: doc._id }, { $set: { status: 'void' } });
  res.json({ success: true, data: doc, message: 'Return cancelled. Stock restored and supplier credit reversed.' });
});
// Preserve old route safely: cancellation is audited, never a destructive delete.
exports.deletePurchaseReturn = exports.cancelPurchaseReturn;
exports.getPurchaseReturns = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1), limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const query = {};
    const search = String(req.query.search || '').slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (search) query.$or = ['returnNumber', 'invoiceNumber', 'poNumber', 'supplierName'].map(field => ({ [field]: { $regex: search, $options: 'i' } }));
    if (['completed', 'cancelled', 'pending'].includes(req.query.status)) query.status = req.query.status;
    const [data, total] = await Promise.all([PurchaseReturn.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), PurchaseReturn.countDocuments(query)]);
    res.json({ success: true, data, pagination: { page, pages: Math.ceil(total / limit), total, limit } });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
exports.getPurchaseReturn = async (req, res) => {
  try {
    const data = await PurchaseReturn.findById(objectId(req.params.id));
    if (!data) return res.status(404).json({ success: false, message: 'Return not found.' });
    res.json({ success: true, data });
  } catch (error) { res.status(error.status || 500).json({ success: false, message: error.message }); }
};
