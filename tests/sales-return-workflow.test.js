const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Product = require('../models/Product');
const Invoice = require('../models/Invoice');
const SalesReturn = require('../models/SalesReturn');
const JournalEntry = require('../models/JournalEntry');
const controller = require('../controllers/salesReturnController');
const invoices = require('../controllers/invoiceController');
const transaction = require('../utils/receiptTransaction');
const pdf = require('../utils/creditNotePdf');
let mongo, serial = 0;
const user = { _id: new mongoose.Types.ObjectId(), name: 'Test operator' };
async function call(handler, body = {}, params = {}) {
  let status = 200, data;
  await handler({ body, params, user, query: {} }, { status(code) { status = code; return this; }, json(value) { data = value; return this; } });
  return { status, ...data };
}
async function setup({ paid = 0, tax = 18, nonBatch = false } = {}) {
  const product = await Product.create({ name: `Test medicine ${++serial}`, sku: `SR-${serial}`, category: 'Test', productType: nonBatch ? 'non-batch' : 'batch', stock: 2,
    batches: nonBatch ? [] : [{ batchNumber: 'LOT-1', quantity: 2, reservedQuantity: 0, mfgDate: '2026-01-01', expDate: '2028-01-01', costPrice: 50 }] });
  const invoice = await Invoice.create({ invoiceNumber: `SALE-TEST-${serial}`, date: '2026-09-01', dueDate: '2026-10-01', customer: { name: 'Test Customer', address: 'Test address', email: 'test@example.invalid' },
    company: { name: 'Medyra Pharmaceutical' }, status: 'sent', subtotal: 1000, tax: tax * 10, total: 1000 + tax * 10, paidAmount: paid, dueAmount: Math.max(0, 1000 + tax * 10 - paid),
    items: [{ productId: product._id, stockBatchId: product.batches[0]?._id, description: product.name, batch: nonBatch ? '' : 'LOT-1', quantity: 10, rate: 100, taxRate: tax, amount: 1000, costPrice: 50, unit: 'Bottle', mfgDate: '2026-01-01', expiryDate: '2028-01-01' }] });
  return { product, invoice };
}
function request(invoice, quantity = 2, restock = true) {
  return { invoiceId: String(invoice._id), requestId: randomUUID(), returnDate: '2026-09-28', reason: 'Customer return', items: [{ invoiceItemId: String(invoice.items[0]._id), quantity, restock }] };
}
before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ ip: '127.0.0.1' }] });
  await mongoose.connect(mongo.getUri(), { dbName: 'sales_return_tests' });
  await Promise.all(Object.values(mongoose.models).map(m => m.init()));
}, { timeout: 240000 });
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test('partial return restores exact lot, reverses GST and posts balanced journals', async () => {
  const { invoice, product } = await setup();
  const result = await call(controller.create, request(invoice));
  assert.equal(result.status, 201, JSON.stringify(result));
  assert.equal(result.data.total, 236);
  assert.equal((await Product.findById(product._id)).stock, 4);
  const updated = await Invoice.findById(invoice._id);
  assert.equal(updated.dueAmount, 944); assert.equal(updated.paidAmount, 0); assert.equal(updated.returnTax, 36);
  const journals = await JournalEntry.find({ sourceId: result.data._id });
  assert.equal(journals.length, 2);
  journals.forEach(j => assert.equal(j.totalDebit, j.totalCredit));
  assert.equal(pdf(result.data).subarray(0, 5).toString(), '%PDF-');
  const fs = require('node:fs');
  fs.mkdirSync('tmp/credit-note-qa', { recursive: true });
  fs.writeFileSync('tmp/credit-note-qa/credit-note.pdf', pdf(result.data));
  const many = result.data.toObject();
  many.items = Array.from({ length: 65 }, () => many.items[0]);
  fs.writeFileSync('tmp/credit-note-qa/credit-note-multipage.pdf', pdf(many));
});
test('fully paid return creates customer credit without changing cash payments', async () => {
  const { invoice } = await setup({ paid: 1180 });
  const result = await call(controller.create, request(invoice));
  assert.equal(result.status, 201, JSON.stringify(result));
  const updated = await Invoice.findById(invoice._id);
  assert.equal(updated.customerCredit, 236); assert.equal(updated.dueAmount, 0); assert.equal(updated.paidAmount, 1180);
});
test('no-GST damaged return creates credit without adding inventory', async () => {
  const { invoice, product } = await setup({ tax: 0 });
  const result = await call(controller.create, request(invoice, 3, false));
  assert.equal(result.status, 201, JSON.stringify(result));
  assert.equal(result.data.total, 300); assert.equal(result.data.totalTax, 0);
  assert.equal((await Product.findById(product._id)).stock, 2);
});
test('duplicate request is idempotent and changed retry is rejected', async () => {
  const { invoice, product } = await setup();
  const body = request(invoice);
  const first = await call(controller.create, body), second = await call(controller.create, body);
  assert.equal(first.status, 201, JSON.stringify(first)); assert.equal(String(first.data._id), String(second.data._id));
  assert.equal((await Product.findById(product._id)).stock, 4);
  assert.equal((await call(controller.create, { ...body, reason: 'Changed' })).status, 409);
});
test('over-return and duplicate line fail without stock or balance writes', async () => {
  const { invoice, product } = await setup();
  assert.equal((await call(controller.create, request(invoice, 8))).status, 201);
  const rejected = await call(controller.create, request(invoice, 3));
  assert.equal(rejected.status, 400);
  const body = request(invoice, 1); body.items.push({ ...body.items[0] });
  assert.equal((await call(controller.create, body)).status, 400);
  assert.equal((await Product.findById(product._id)).stock, 10);
  assert.equal(await SalesReturn.countDocuments({ invoice: invoice._id }), 1);
});
test('cancel reverses stock, credits and journals; repeat cancel is harmless', async () => {
  const { invoice, product } = await setup();
  const created = await call(controller.create, request(invoice));
  const params = { id: String(created.data._id) };
  const result = await call(controller.cancel, { reason: 'Incorrect return' }, params);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal((await Product.findById(product._id)).stock, 2);
  assert.equal((await Invoice.findById(invoice._id)).returnCredit, 0);
  assert.equal(await JournalEntry.countDocuments({ sourceId: created.data._id, status: 'posted' }), 0);
  await call(controller.cancel, { reason: 'Retry' }, params);
  assert.equal((await Product.findById(product._id)).stock, 2);
});
test('cancellation blocked for sold/reserved return stock leaves credit intact', async () => {
  const { invoice, product } = await setup();
  const created = await call(controller.create, request(invoice));
  await Product.updateOne({ _id: product._id }, { $set: { 'batches.0.reservedQuantity': 4 } });
  const result = await call(controller.cancel, { reason: 'Try cancel' }, { id: String(created.data._id) });
  assert.equal(result.status, 400, JSON.stringify(result));
  assert.equal((await Invoice.findById(invoice._id)).returnCredit, 236);
  assert.equal((await SalesReturn.findById(created.data._id)).status, 'posted');
});
test('later invoice save failure rolls back stock, note and journal together', async () => {
  const { invoice, product } = await setup();
  const save = Invoice.prototype.save;
  Invoice.prototype.save = async function () { throw new Error('Injected write failure'); };
  try {
    const result = await call(controller.create, request(invoice));
    assert.equal(result.status, 500);
    assert.equal((await Product.findById(product._id)).stock, 2);
    assert.equal(await SalesReturn.countDocuments({ invoice: invoice._id }), 0);
  } finally { Invoice.prototype.save = save; }
});
test('invoice edit/delete is blocked while posted credit notes exist', async () => {
  const { invoice } = await setup();
  const result = await call(controller.create, request(invoice)); assert.equal(result.status, 201);
  assert.equal((await call(transaction(invoices.deleteInvoice), {}, { id: String(invoice._id) })).status, 409);
  assert.ok(await Invoice.findById(invoice._id));
});
test('non-batch returns update stock and source excludes already returned quantities', async () => {
  const { invoice, product } = await setup({ nonBatch: true });
  const created = await call(controller.create, request(invoice, 3)); assert.equal(created.status, 201, JSON.stringify(created));
  assert.equal((await Product.findById(product._id)).stock, 5);
  const result = await call(controller.getSource, {}, { id: String(invoice._id) });
  assert.equal(result.data.items[0].remaining, 7);
});
test('payment after credit uses net due and preserves legacy paid amount', async () => {
  const { invoice } = await setup({ paid: 500 });
  await call(controller.create, request(invoice));
  const result = await call(transaction(invoices.addInvoicePayment), { amount: 444, method: 'cash' }, { id: String(invoice._id) });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.paidAmount, 944); assert.equal(result.data.dueAmount, 0); assert.equal(result.data.returnCredit, 236);
  assert.equal(result.data.payments.length, 2);
  assert.equal((await call(transaction(invoices.addInvoicePayment), { amount: 1 }, { id: String(invoice._id) })).status, 400);
});
test('concurrent returns cannot both exceed sold quantity', async () => {
  const { invoice, product } = await setup();
  const results = await Promise.all([call(controller.create, request(invoice, 7)), call(controller.create, request(invoice, 7))]);
  assert.equal(results.filter(r => r.status === 201).length, 1, JSON.stringify(results));
  assert.equal(results.filter(r => r.status === 400).length, 1, JSON.stringify(results));
  assert.equal((await Product.findById(product._id)).stock, 9);
});
test('missing original lot blocks restock rather than guessing a batch', async () => {
  const { invoice, product } = await setup();
  await Product.updateOne({ _id: product._id }, { $set: { batches: [] } });
  const result = await call(controller.create, request(invoice));
  assert.equal(result.status, 400, JSON.stringify(result));
  assert.equal(await SalesReturn.countDocuments({ invoice: invoice._id }), 0);
});
test('full credit includes positive and negative invoice rounding', () => {
  const { lines } = require('../utils/salesReturnAmounts');
  for (const rounding of [0.4, -0.4]) {
    const invoice = { total: 100 + rounding, rounding, items: [{ _id: 'i', quantity: 1, rate: 100, taxRate: 0, description: 'Item' }] };
    assert.equal(lines(invoice, [], [{ invoiceItemId: 'i', quantity: 1 }]).total, invoice.total);
  }
});
