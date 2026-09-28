const { randomUUID, createHash } = require('node:crypto');
const mongoose = require('mongoose');
const SalesReturn = require('../models/SalesReturn');
const Invoice = require('../models/Invoice');
const Product = require('../models/Product');
const Lead = require('../models/Lead');
const JournalEntry = require('../models/JournalEntry');
const transaction = require('../utils/receiptTransaction');
const { lines, balance, round } = require('../utils/salesReturnAmounts');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const validId = id => mongoose.isValidObjectId(id);

async function source(id) {
  if (!validId(id)) fail('Invalid invoice.');
  const invoice = await Invoice.findById(id);
  if (!invoice) fail('Invoice not found.', 404);
  if (invoice.status === 'cancelled') fail('A cancelled invoice cannot be returned.');
  const previous = await SalesReturn.find({ invoice: id, status: 'posted' });
  return { invoice, previous };
}
async function resolveProduct(invoice, item) {
  if (item.product) return Product.findById(item.product);
  // Older invoices did not persist product IDs. Resolve only an unambiguous source.
  if (invoice.leadId && invoice.proformaNumber) {
    const lead = await Lead.findById(invoice.leadId);
    const pf = (lead?.proformas || []).find(p => p.number === invoice.proformaNumber) ||
      (lead?.proforma?.number === invoice.proformaNumber ? lead.proforma : null);
    const matches = (pf?.items || []).filter(p => (p.productName || p.description) === item.productName);
    const ids = [...new Set(matches.map(p => String(p.productId || '')).filter(Boolean))];
    if (ids.length === 1) return Product.findById(ids[0]);
  }
  const products = await Product.find({ name: item.productName }).limit(2);
  if (products.length === 1) return products[0];
  fail(`Cannot identify inventory for ${item.productName}. Correct the invoice product link first.`);
}
async function moveStock(invoice, note, direction, user) {
  for (const item of note.items) {
    if (!item.restock) continue;
    const product = await resolveProduct(invoice, item);
    if (!product) fail(`Product ${item.productName} no longer exists.`);
    item.product = product._id;
    if (product.productType !== 'non-batch') {
      let lot;
      if (item.stockBatchId) lot = product.batches.id(item.stockBatchId);
      else {
        const matches = product.batches.filter(b => b.batchNumber === item.batchNumber &&
          (!item.expiryDate || b.expDate === item.expiryDate) && (!item.mfgDate || b.mfgDate === item.mfgDate));
        if (matches.length === 1) lot = matches[0];
      }
      if (!lot) fail(`Cannot identify the original inventory lot for ${item.productName} (${item.batchNumber}).`);
      if (direction < 0 && Number(lot.quantity) - Number(lot.reservedQuantity || 0) < item.quantity) fail(`Cannot cancel: returned stock for ${item.productName} has been sold or reserved.`);
      lot.quantity += direction * item.quantity;
      item.stockBatchId = lot._id;
    } else {
      if (direction < 0 && Number(product.stock) - Number(product.reservedStock || 0) < item.quantity) fail(`Cannot cancel: returned stock for ${item.productName} has been sold or reserved.`);
      product.stock += direction * item.quantity;
    }
    product.stockMovements.push({ type: direction > 0 ? 'add' : 'remove', quantity: item.quantity,
      batchNumber: item.batchNumber, costPrice: item.costPrice,
      reason: `${direction > 0 ? 'Sales return' : 'Sales return cancelled'} ${note.returnNumber}`, addedBy: user?.name || 'System' });
    await product.save();
  }
}
async function postJournal(invoice, note) {
  const accounts = await require('./accountingController').getAccountMap();
  const entries = [];
  const add = (code, debit, credit) => {
    if (!debit && !credit) return;
    const account = accounts.get(code);
    entries.push({ account: account._id, accountCode: code, accountName: account.name, debit: round(debit), credit: round(credit),
      entityType: 'Customer', entityId: invoice.leadId || null, description: note.returnNumber });
  };
  add(invoice.type === 'international' ? '4010' : '4000', note.subtotal, 0);
  if (invoice.taxType === 'cgst_sgst') {
    const half = round(note.totalTax / 2);
    add('2010', half, 0); add('2011', round(note.totalTax - half), 0);
  } else add('2012', note.totalTax, 0);
  add('1020', 0, note.total);
  add('5080', Math.max(0, note.roundOff), Math.max(0, -note.roundOff));
  // Cost is recorded in INR; don't mix it into a foreign-currency credit journal.
  const base = { date: note.returnDate, referenceNumber: note.returnNumber, sourceModule: 'sales_return', sourceId: note._id,
    status: 'posted', createdBy: note.createdBy };
  await JournalEntry.create({ ...base, entryNumber: `JV-${note.returnNumber}`, memo: `Credit Note ${note.returnNumber} / ${invoice.invoiceNumber}`,
    currency: note.currency, lines: entries, totalDebit: round(entries.reduce((s, l) => s + l.debit, 0)), totalCredit: round(entries.reduce((s, l) => s + l.credit, 0)) });
  const cost = round(note.items.filter(i => i.restock).reduce((s, i) => s + i.quantity * i.costPrice, 0));
  if (cost > 0) {
    entries.length = 0; add('1030', cost, 0); add('5000', 0, cost);
    await JournalEntry.create({ ...base, entryNumber: `JV-STOCK-${note.returnNumber}`, memo: `Returned inventory ${note.returnNumber}`,
      currency: 'INR', lines: entries, totalDebit: cost, totalCredit: cost });
  }
}
async function refreshBalance(invoice) {
  const notes = await SalesReturn.find({ invoice: invoice._id, status: 'posted' });
  Object.assign(invoice, balance(invoice, notes.reduce((sum, n) => sum + n.total, 0)));
  invoice.returnTax = round(notes.reduce((sum, n) => sum + n.totalTax, 0));
  invoice.paymentStatus = invoice.dueAmount <= 0.01 ? 'paid' : invoice.paidAmount > 0 ? 'partially_paid' : 'unpaid';
  // A settled credit is not a cash payment. Keep the invoice's document status.
  await invoice.save();
}
exports.getSource = async (req, res) => {
  try {
    const { invoice, previous } = await source(req.params.id);
    const items = invoice.items.filter(i => !i.freight && !/^(freight|insurance)(\s|\/|$)/i.test(i.description)).map(i => {
      const returned = previous.flatMap(n => n.items).filter(r => String(r.invoiceItemId) === String(i._id)).reduce((s, r) => s + r.quantity, 0);
      return { ...i.toObject(), returned, remaining: Number(i.quantity) - returned };
    });
    res.json({ success: true, data: { invoice, items } });
  } catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
};
exports.list = async (req, res) => {
  try { res.json({ success: true, data: await SalesReturn.find().sort({ createdAt: -1 }).limit(1000) }); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
exports.create = transaction(async (req, res) => {
  const { invoiceId, requestId, returnDate, reason, items } = req.body;
  if (!requestId || typeof requestId !== 'string' || requestId.length > 100) fail('A return request ID is required.');
  const hash = createHash('sha256').update(JSON.stringify({ invoiceId, returnDate, reason, items })).digest('hex');
  const existing = await SalesReturn.findOne({ requestId });
  if (existing) {
    if (existing.requestHash !== hash) fail('This request was already used with different details.', 409);
    return res.json({ success: true, data: existing });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate || '') || Number.isNaN(Date.parse(returnDate))) fail('Choose a valid return date.');
  if (!String(reason || '').trim()) fail('Return reason is required.');
  const { invoice, previous } = await source(invoiceId);
  if (new Date(returnDate) < new Date(new Date(invoice.date).toISOString().slice(0, 10))) fail('Return date cannot be before the invoice date.');
  let amounts;
  try { amounts = lines(invoice, previous, items); } catch (e) { fail(e.message); }
  const note = new SalesReturn({ ...amounts, invoice: invoice._id, invoiceNumber: invoice.invoiceNumber,
    requestId, requestHash: hash, returnNumber: `CN-${new Date().getFullYear()}/${randomUUID().slice(0, 8).toUpperCase()}`,
    customerId: invoice.leadId, customer: invoice.customer.toObject(), company: invoice.company?.toObject(),
    currency: invoice.currency || 'INR', exchangeRate: invoice.exchangeRate || 1, taxType: invoice.taxType || 'igst',
    returnDate, reason: String(reason).trim(), createdBy: req.user?._id || req.user?.id });
  await moveStock(invoice, note, 1, req.user);
  await note.save();
  await postJournal(invoice, note);
  await refreshBalance(invoice);
  res.status(201).json({ success: true, data: note });
});

const pdfBuffer = require('../utils/creditNotePdf');
const sendPdf = (res, note) => res.set({ 'Content-Type': 'application/pdf',
  'Content-Disposition': `inline; filename="${note.returnNumber.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf"`,
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(pdfBuffer(note));
exports.pdf = async (req, res) => {
  try {
    if (!validId(req.params.id)) fail('Invalid credit note.');
    const note = await SalesReturn.findById(req.params.id);
    if (!note) fail('Credit note not found.', 404);
    sendPdf(res, note);
  } catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
};
exports.share = async (req, res) => {
  try {
    if (!validId(req.params.id)) fail('Invalid credit note.');
    const note = await SalesReturn.findById(req.params.id).select('+shareToken');
    if (!note || note.status !== 'posted') fail('Only posted credit notes can be shared.');
    if (!note.shareToken) { note.shareToken = randomUUID() + randomUUID(); await note.save(); }
    res.json({ success: true, token: note.shareToken });
  } catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
};
exports.sharedPdf = async (req, res) => {
  try {
    if (!/^[a-f0-9-]{72}$/.test(req.params.token)) fail('Invalid sharing link.', 404);
    const note = await SalesReturn.findOne({ shareToken: req.params.token });
    if (!note) fail('Credit note not found.', 404);
    sendPdf(res, note);
  } catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
};
exports.email = async (req, res) => {
  try {
    const { isEmail } = require('validator');
    if (typeof req.body.to !== 'string' || !isEmail(req.body.to.trim())) fail('Enter a valid email address.');
    if (!validId(req.params.id)) fail('Invalid credit note.');
    const note = await SalesReturn.findById(req.params.id);
    if (!note || note.status !== 'posted') fail('Only posted credit notes can be emailed.');
    const { transporter, user } = require('../utils/poEmail').getTransport();
    const info = await transporter.sendMail({ from: { name: 'Medyra Pharmaceutical', address: user }, to: req.body.to.trim(),
      subject: `Credit Note ${note.returnNumber} - Medyra Pharmaceutical`,
      text: `Please find attached Credit Note ${note.returnNumber} against invoice ${note.invoiceNumber}.`,
      attachments: [{ filename: note.returnNumber.replace(/[^A-Za-z0-9_-]/g, '_') + '.pdf', content: pdfBuffer(note), contentType: 'application/pdf' }] });
    if (!(info.accepted || []).some(a => String(a).toLowerCase() === req.body.to.trim().toLowerCase())) fail('Mail server did not accept the recipient.', 502);
    res.json({ success: true, message: 'Mail server accepted the credit note for delivery.' });
  } catch (e) { res.status(e.status || 502).json({ success: false, message: e.status ? e.message : require('../utils/poEmail').emailError(e, 'credit note') }); }
};
exports.cancel = transaction(async (req, res) => {
  if (!validId(req.params.id)) fail('Invalid credit note.');
  const note = await SalesReturn.findById(req.params.id);
  if (!note) fail('Credit note not found.', 404);
  if (note.status === 'cancelled') return res.json({ success: true, data: note });
  if (!String(req.body.reason || '').trim()) fail('Cancellation reason is required.');
  const invoice = await Invoice.findById(note.invoice);
  if (!invoice) fail('Original invoice not found.');
  await moveStock(invoice, note, -1, req.user);
  note.status = 'cancelled'; note.cancelledAt = new Date(); note.cancelledBy = req.user?._id || req.user?.id;
  note.cancellationReason = String(req.body.reason).trim();
  await note.save();
  await JournalEntry.updateMany({ sourceModule: 'sales_return', sourceId: note._id }, { $set: { status: 'void' } });
  await refreshBalance(invoice);
  res.json({ success: true, data: note });
});
