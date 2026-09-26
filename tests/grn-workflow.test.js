// Run: node --test tests/grn-workflow.test.js
// Test-only dependency: npm install --no-save --package-lock=false mongodb-memory-server
// Always uses a disposable local replica set, never the application's database URL.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Product = require('../models/Product');
const PurchaseOrder = require('../models/PurchaseOrder');
const Supplier = require('../models/Supplier');
const VendorPriceList = require('../models/VendorPriceList');
const { GoodsReceipt, ConsolidatedInvoice } = require('../models/GoodsReceipt');
const JournalEntry = require('../models/JournalEntry');
const PurchaseReturn = require('../models/PurchaseReturn');
const returns = require('../controllers/purchaseReturnController');
const purchase = require('../controllers/purchaseOrderController');
const vendor = require('../controllers/vendorPriceListController');
const receipt = require('../controllers/goodsReceiptController');
const { syncAllAutomatedJournals } = require('../controllers/accountingController');

let mongo, supplier, serial = 0;
const user = { _id: new mongoose.Types.ObjectId(), name: 'Workflow test' };
async function call(handler, body = {}, params = {}) {
  let status = 200, data;
  await handler({ body, params, query: {}, user }, {
    status(code) { status = code; return this; },
    json(value) { data = value; return this; }
  });
  return { status, ...data };
}
async function ok(handler, body, params) {
  const result = await call(handler, body, params);
  assert.equal(result.success, true, JSON.stringify(result));
  return result.data;
}
async function setup(quantity = 150, type = 'batch') {
  const product = await Product.create({ name: `Product ${++serial}`, sku: `TEST-${serial}`, category: 'Test', productType: type });
  const po = await ok(purchase.createPurchaseOrder, {
    supplierId: supplier._id, supplierName: supplier.companyName,
    date: '2026-09-24', expectedDate: '2026-09-25',
    currency: 'INR', exchangeRate: 1, subtotal: quantity * 50, total: quantity * 56,
    items: [{ product: String(product._id), productId: product._id, productName: product.name,
      quantity, unitPrice: 50, taxRate: 12, total: quantity * 50, batchNumber: 'IGNORE-PO-BATCH' }]
  });
  return { product, po };
}
function input(po, quantity, batch, alreadyReceived = 0, extra = {}) {
  return {
    purchaseOrderId: po._id, receivedDate: '2026-09-24', receiptRequestId: `receipt-${++serial}`,
    items: [{ productId: po.items[0].productId, purchaseOrderItemId: po.items[0]._id,
      productName: po.items[0].productName, receivedQty: quantity, alreadyReceived,
      batchNumber: batch, unitPrice: 50, taxRate: 12, mrp: 80, sellingPrice: 70 }], ...extra
  };
}
async function checkBalance(invoiceId) {
  const journals = await JournalEntry.find({ sourceId: invoiceId });
  assert.ok(journals.length > 0, 'Purchase journal exists');
  for (const journal of journals) {
    const debit = journal.lines.reduce((sum, line) => sum + line.debit, 0);
    const credit = journal.lines.reduce((sum, line) => sum + line.credit, 0);
    assert.ok(Math.abs(debit - credit) < 0.01, 'Journal balances');
  }
  return journals.length;
}
before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ ip: '127.0.0.1' }] });
  await mongoose.connect(mongo.getUri(), { dbName: 'grn_workflow_test' });
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  supplier = await Supplier.create({ companyName: 'Test vendor', contactPerson: 'Test', email: 'test@example.invalid', phone: '0000000000' });
}, { timeout: 240000 });
after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test('vendor price list and purchase do not register or require batches', async () => {
  const { product, po } = await setup();
  await ok(vendor.upsertPriceList, { supplierId: supplier._id, items: [{ productId: product._id, costPrice: 50, batchNumber: 'IGNORE-PRICE-LIST' }] });
  await ok(vendor.upsertItem, { productId: product._id, costPrice: 55, batchNumber: 'ANOTHER-IGNORED-BATCH' }, { supplierId: supplier._id });
  const saved = await Product.findById(product._id);
  assert.equal(saved.stock, 0);
  assert.equal(saved.batches.length, 0);
  const list = await VendorPriceList.findOne({ supplierId: supplier._id });
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].batchNumber, undefined);
  assert.equal(po.items[0].batchNumber, 'N/A');
});

test('100 + 50 receipts retain separate batches, quantities, payments and journals', async () => {
  const { product, po } = await setup();
  const first = input(po, 100, 'BATCH-001', 0, { initialPayment: { amount: 5600, method: 'bank' } });
  let grn = await ok(receipt.createGRN, first);
  let order = await PurchaseOrder.findById(po._id);
  assert.equal(order.items[0].remainingQty, 50);
  assert.equal(order.status, 'partially_received');
  await ok(receipt.createGRN, first); // Network retry must not add the same receipt again.
  assert.equal((await Product.findById(product._id)).stock, 100);
  grn = await ok(receipt.createGRN, input(po, 50, 'BATCH-002', 100));
  const stock = await Product.findById(product._id);
  assert.equal(stock.stock, 150);
  assert.deepEqual(stock.batches.map(b => [b.batchNumber, b.quantity]), [['BATCH-001', 100], ['BATCH-002', 50]]);
  assert.equal(grn.items.length, 2);
  assert.ok(stock.batches.every(b => String(b.sourceGRN) === String(grn._id) && String(b.purchaseOrder) === String(po._id)));
  order = await PurchaseOrder.findById(po._id);
  assert.equal(order.items[0].receivedQty, 150);
  assert.equal(order.items[0].remainingQty, 0);
  assert.equal(order.status, 'delivered');
  const invoice = await ConsolidatedInvoice.findOne({ purchaseOrder: po._id });
  assert.equal(await ConsolidatedInvoice.countDocuments({ purchaseOrder: po._id }), 1, 'Paid first receipt must reuse its invoice');
  assert.equal(invoice.items.length, 2);
  assert.equal(invoice.grandTotal, 8400);
  assert.equal(invoice.paidAmount, 5600);
  const count = await checkBalance(invoice._id);
  await syncAllAutomatedJournals();
  assert.equal(await checkBalance(invoice._id), count, 'Journal sync is idempotent');
});

test('batch-only edits and repeated edits affect only the linked stock lot', async () => {
  const { product, po } = await setup();
  let grn = await ok(receipt.createGRN, input(po, 100, 'SAME-BATCH'));
  grn = await ok(receipt.createGRN, input(po, 50, 'SAME-BATCH', 100));
  const edit = { items: [{ _id: grn.items[0]._id, receivedQty: 80, batchNumber: 'CORRECTED' }] };
  grn = await ok(receipt.updateGRN, edit, { id: grn._id });
  await ok(receipt.updateGRN, edit, { id: grn._id });
  let stock = await Product.findById(product._id);
  assert.equal(stock.stock, 130);
  assert.equal(stock.batches.filter(b => b.batchNumber === 'SAME-BATCH').reduce((sum, b) => sum + b.quantity, 0), 50);
  assert.equal(stock.batches.find(b => b.batchNumber === 'CORRECTED').quantity, 80);
  const order = await PurchaseOrder.findById(po._id);
  assert.equal(order.items[0].remainingQty, 20);
  await ok(receipt.updateGRN, { items: [{ _id: grn.items[0]._id, batchNumber: 'RENAMED', mfgDate: '2026-09-01' }] }, { id: grn._id });
  stock = await Product.findById(product._id);
  assert.equal(stock.batches.find(b => b.batchNumber === 'RENAMED').quantity, 80);
  assert.equal(stock.batches.find(b => b.batchNumber === 'RENAMED').mfgDate, '2026-09-01');
});

test('invalid batch, over-receipt, stale form and failed payment roll back all stock changes', async () => {
  const { product, po } = await setup(100);
  for (const data of [input(po, 100, ''), input(po, 101, 'B1'), input(po, 100, 'B1', 0, { initialPayment: { amount: 1, method: 'invalid' } })]) {
    const result = await call(receipt.createGRN, data);
    assert.equal(result.success, false);
    assert.equal((await Product.findById(product._id)).stock, 0);
    assert.equal(await GoodsReceipt.countDocuments({ purchaseOrder: po._id }), 0);
  }
  await ok(receipt.createGRN, input(po, 50, 'B1'));
  assert.equal((await call(receipt.createGRN, input(po, 10, 'B2', 0))).status, 400);
  assert.equal((await Product.findById(product._id)).stock, 50);
});

test('receipt reductions protect stock already sold or reserved', async () => {
  const { product, po } = await setup(100);
  const grn = await ok(receipt.createGRN, input(po, 100, 'B1'));
  const stock = await Product.findById(product._id);
  stock.batches[0].quantity = 30;
  stock.batches[0].reservedQuantity = 20;
  await stock.save();
  const edit = await call(receipt.updateGRN, { items: [{ _id: grn.items[0]._id, receivedQty: 50 }] }, { id: grn._id });
  assert.equal(edit.status, 400);
  assert.equal((await Product.findById(product._id)).stock, 30);
  assert.equal((await GoodsReceipt.findById(grn._id)).items[0].receivedQty, 100);
});

test('non-batch receiving, zero quantity correction and deletion stay consistent', async () => {
  const { product, po } = await setup(100, 'non-batch');
  let grn = await ok(receipt.createGRN, input(po, 100, ''));
  assert.equal((await Product.findById(product._id)).stock, 100);
  grn = await ok(receipt.updateGRN, { items: [{ _id: grn.items[0]._id, receivedQty: 0 }] }, { id: grn._id });
  assert.equal((await Product.findById(product._id)).stock, 0);
  assert.equal((await PurchaseOrder.findById(po._id)).status, 'pending');
  assert.equal(await JournalEntry.countDocuments({ sourceId: grn.consolidatedInvoiceId, sourceModule: 'purchase_invoice' }), 0);
  await ok(receipt.deleteGRN, {}, { id: grn._id });
  assert.equal(await ConsolidatedInvoice.countDocuments({ purchaseOrder: po._id }), 0);
});

test('invoice reversal cannot subtract stock twice and allows a fresh receipt', async () => {
  const { product, po } = await setup(100);
  const first = await ok(receipt.createGRN, input(po, 100, 'B1'));
  await ok(receipt.deleteConsolidatedInvoice, {}, { invoiceId: first.consolidatedInvoiceId });
  assert.equal((await Product.findById(product._id)).stock, 0);
  assert.equal((await GoodsReceipt.findById(first._id)).status, 'cancelled');
  await ok(receipt.deleteGRN, {}, { id: first._id });
  await ok(receipt.createGRN, input(po, 100, 'B2'));
  assert.equal((await Product.findById(product._id)).stock, 100);
});

test('invoice corrections preserve stock identity and update receipt stock', async () => {
  const { product, po } = await setup(100);
  const grn = await ok(receipt.createGRN, input(po, 100, 'B1'));
  let invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  invoice = await ok(receipt.updateConsolidatedInvoice, { items: invoice.items.map(item => ({ ...item.toObject(), quantity: 80, acceptedQty: 80, batchNumber: 'B2', unit: 'Boxes', hsn: '300490', mfgDate: '2026-01-01', expDate: '2028-01-01', mrp: 150, sellingPrice: 140 })) }, { invoiceId: invoice._id });
  assert.equal((await Product.findById(product._id)).stock, 80);
  assert.equal(invoice.items[0].batchNumber, 'B2');
  assert.equal(invoice.items[0].unit, 'Boxes');
  assert.equal(invoice.items[0].hsn, '300490');
  assert.equal(invoice.items[0].expDate, '2028-01-01');
  const updatedGRN = await GoodsReceipt.findById(grn._id);
  assert.equal(updatedGRN.items[0].unit, 'Boxes');
  const stock = await Product.findById(product._id);
  const lot = stock.batches.find(batch => String(batch._id) === String(invoice.items[0].stockBatchId));
  assert.equal(lot.mrp, 150);
  assert.equal(lot.sellingPrice, 140);
  assert.ok(invoice.items[0].stockBatchId);
  assert.equal((await PurchaseOrder.findById(po._id)).items[0].remainingQty, 20);
});

test('purchase editing preserves line IDs and received quantities', async () => {
  const { po } = await setup(100);
  await ok(receipt.createGRN, input(po, 50, 'B1'));
  const order = await ok(purchase.updatePurchaseOrder, { items: po.items.map(item => ({ ...item.toObject(), quantity: 120, receivedQty: 0 })) }, { id: po._id });
  assert.equal(String(order.items[0]._id), String(po.items[0]._id));
  assert.equal(order.items[0].receivedQty, 50);
  assert.equal(order.items[0].remainingQty, 70);
  const result = await call(purchase.deletePurchaseOrder, {}, { id: po._id });
  assert.equal(result.status, 400);
});

test('concurrent retry of the same receipt adds stock only once', async () => {
  const { product, po } = await setup(100);
  const body = input(po, 50, 'CONCURRENT');
  const results = await Promise.all([call(receipt.createGRN, body), call(receipt.createGRN, body)]);
  assert.ok(results.every(result => result.success), JSON.stringify(results));
  assert.equal((await Product.findById(product._id)).stock, 50);
  assert.equal(await GoodsReceipt.countDocuments({ purchaseOrder: po._id }), 1);
});

test('different products and duplicate product lines retain their own receipt quantities', async () => {
  const { product, po } = await setup(100);
  const other = await Product.create({ name: `Product ${++serial}`, sku: `TEST-${serial}`, category: 'Test' });
  const order = await ok(purchase.updatePurchaseOrder, { items: [
    ...po.items.map(item => item.toObject()),
    { product: String(product._id), productId: product._id, productName: product.name, quantity: 20, unitPrice: 60, taxRate: 5, total: 1200 },
    { product: String(other._id), productId: other._id, productName: other.name, quantity: 10, unitPrice: 20, taxRate: 0, total: 200 }
  ] }, { id: po._id });
  const grn = await ok(receipt.createGRN, { purchaseOrderId: po._id, receivedDate: '2026-09-24',
    items: order.items.map((item, index) => ({ productId: item.productId, purchaseOrderItemId: item._id,
      receivedQty: index === 0 ? 50 : item.quantity, batchNumber: `LINE-${index}`, unitPrice: item.unitPrice, taxRate: item.taxRate })) });
  const saved = await PurchaseOrder.findById(po._id);
  assert.deepEqual(saved.items.map(item => item.receivedQty), [50, 20, 10]);
  assert.deepEqual(saved.items.map(item => item.remainingQty), [50, 0, 0]);
  assert.equal(grn.items.length, 3);
  assert.equal((await Product.findById(product._id)).stock, 70);
  assert.equal((await Product.findById(other._id)).stock, 10);
});

test('foreign currency prices and charges remain stable through repeated edits', async () => {
  const { product, po } = await setup(100);
  await PurchaseOrder.updateOne({ _id: po._id }, { currency: 'USD', exchangeRate: 80 });
  let grn = await ok(receipt.createGRN, input(po, 100, 'USD-BATCH', 0, { freight: { amount: 10, taxRate: 18 } }));
  assert.equal(grn.grandTotal, 5611.8);
  let stock = await Product.findById(product._id);
  assert.equal(stock.batches[0].costPrice, 4000);
  assert.equal(stock.batches[0].mrp, 6400);
  for (let index = 0; index < 2; index++) {
    grn = await ok(receipt.updateGRN, { notes: 'Only notes changed' }, { id: grn._id });
    assert.equal(grn.grandTotal, 5611.8);
    assert.equal(grn.totalTax, 601.8);
  }
  grn = await ok(receipt.updateGRN, { items: [{ _id: grn.items[0]._id, receivedQty: 90, mrp: 90 }] }, { id: grn._id });
  stock = await Product.findById(product._id);
  assert.equal(stock.batches[0].mrp, 7200);
  assert.equal(stock.stock, 90);
  await checkBalance(grn.consolidatedInvoiceId);
});

test('legacy ambiguous batch corrections fail safely without altering existing inventory', async () => {
  const { product, po } = await setup(100);
  let grn = await ok(receipt.createGRN, input(po, 50, 'LEGACY'));
  grn = await ok(receipt.createGRN, input(po, 50, 'LEGACY', 50));
  await GoodsReceipt.updateOne({ _id: grn._id }, { $unset: { 'items.0.stockBatchId': '' } });
  const result = await call(receipt.updateGRN, { items: [{ _id: grn.items[0]._id, receivedQty: 30 }] }, { id: grn._id });
  assert.equal(result.status, 400);
  assert.match(result.message, /legacy batch/);
  assert.equal((await Product.findById(product._id)).stock, 100);
});

test('later vendor payments remain linked and balanced', async () => {
  const { po } = await setup(100);
  const grn = await ok(receipt.createGRN, input(po, 100, 'PAYMENT'));
  const result = await call(receipt.addConsolidatedPayment, { amount: 1000, method: 'cash', date: '2026-09-24' }, { invoiceId: grn.consolidatedInvoiceId });
  assert.equal(result.success, true, JSON.stringify(result));
  const invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  assert.equal(invoice.paidAmount, 1000);
  assert.equal(invoice.remainingAmount, 4600);
  await checkBalance(invoice._id);
});

test('GRN quantity controls purchase status and cannot exceed ordered quantity on edit', async () => {
  const { product, po } = await setup(100);
  assert.equal((await call(purchase.updatePurchaseOrderStatus, { status: 'delivered' }, { id: po._id })).status, 400);
  const grn = await ok(receipt.createGRN, input(po, 50, 'B1'));
  const result = await call(receipt.updateGRN, { items: [{ _id: grn.items[0]._id, receivedQty: 101 }] }, { id: grn._id });
  assert.equal(result.status, 400);
  assert.equal((await Product.findById(product._id)).stock, 50);
  assert.equal((await PurchaseOrder.findById(po._id)).items[0].receivedQty, 50);
});

test('GST changes propagate to the invoice and journal without changing stock', async () => {
  const { product, po } = await setup(100);
  const grn = await ok(receipt.createGRN, input(po, 100, 'GST'));
  await ok(receipt.updateGRN, { gstType: 'cgst_sgst' }, { id: grn._id });
  const invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  assert.equal(invoice.gstType, 'cgst_sgst');
  const journal = await JournalEntry.findOne({ sourceId: invoice._id, sourceModule: 'purchase_invoice' });
  assert.equal(journal.lines.find(line => line.accountCode === '1040').debit, 300);
  assert.equal(journal.lines.find(line => line.accountCode === '1041').debit, 300);
  assert.equal((await Product.findById(product._id)).stock, 100);
});


function returnInput(invoice, quantity, extra = {}) {
  return { invoiceId: String(invoice._id), requestId: `return-test-${++serial}`, returnDate: '2026-09-24', returnReason: 'Damaged goods',
    items: [{ invoiceItemId: String(invoice.items[0]._id), quantity }], ...extra };
}
test('purchase return reduces exact stock lot and dues, retries once, and cancellation restores both', async () => {
  const { product, po } = await setup(100);
  const grn = await ok(receipt.createGRN, input(po, 100, 'RET-1'));
  let invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  const body = returnInput(invoice, 20);
  const posted = await ok(returns.createPurchaseReturn, body);
  assert.equal(posted.total, 1120);
  assert.equal((await Product.findById(product._id)).stock, 80);
  invoice = await ConsolidatedInvoice.findById(invoice._id);
  assert.equal(invoice.grandTotal, 5600);
  assert.equal(invoice.returnCredit, 1120);
  assert.equal(invoice.remainingAmount, 4480);
  assert.equal(invoice.paidAmount, 0);
  const retry = await ok(returns.createPurchaseReturn, body);
  assert.equal(String(retry._id), String(posted._id));
  assert.equal((await Product.findById(product._id)).stock, 80);
  const journal = await JournalEntry.findOne({ sourceModule: 'purchase_return', sourceId: posted._id });
  assert.equal(journal.totalDebit, journal.totalCredit);
  assert.equal(journal.totalDebit, 1120);
  const accounting = require('../controllers/accountingController');
  assert.equal((await call(accounting.deleteJournalEntry, {}, { id: journal._id })).success, false);
  assert.equal((await call(accounting.updateJournalEntry, { lines: [] }, { id: journal._id })).success, false);
  assert.equal((await call(receipt.deleteConsolidatedInvoice, {}, { invoiceId: invoice._id })).success, false);
  await syncAllAutomatedJournals();
  assert.equal(await JournalEntry.countDocuments({ sourceModule: 'purchase_return', sourceId: posted._id }), 1);
  assert.equal((await call(receipt.updateConsolidatedInvoice, { items: invoice.items.map(i => i.toObject()) }, { invoiceId: invoice._id })).success, false);
  assert.equal((await call(receipt.deleteGRN, {}, { id: grn._id })).success, false);
  const src = await ok(returns.getReturnSource, {}, { invoiceId: invoice._id });
  assert.equal(src.items[0].returnedQty, 20);
  assert.equal(src.items[0].returnableQty, 80);
  await ok(returns.cancelPurchaseReturn, { reason: 'Goods retained' }, { id: posted._id });
  await ok(returns.cancelPurchaseReturn, { reason: 'Retry' }, { id: posted._id });
  assert.equal((await Product.findById(product._id)).stock, 100);
  invoice = await ConsolidatedInvoice.findById(invoice._id);
  assert.equal(invoice.returnCredit, 0);
  assert.equal(invoice.remainingAmount, 5600);
  assert.equal((await JournalEntry.findById(journal._id)).status, 'void');
  assert.equal((await PurchaseReturn.findById(posted._id)).status, 'cancelled');
});
test('paid purchase returns retain actual payment and create supplier credit; no fictitious payment journal', async () => {
  const { po } = await setup(100);
  const grn = await ok(receipt.createGRN, input(po, 100, 'RET-PAID'));
  await ok(receipt.addConsolidatedPayment, { amount: 5600, method: 'bank' }, { invoiceId: grn.consolidatedInvoiceId });
  let invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  await ok(returns.createPurchaseReturn, returnInput(invoice, 20));
  invoice = await ConsolidatedInvoice.findById(invoice._id);
  assert.equal(invoice.paidAmount, 5600);
  assert.equal(invoice.supplierCredit, 1120);
  assert.equal(invoice.remainingAmount, 0);
  const unpaid = await setup(10);
  const unpaidGRN = await ok(receipt.createGRN, input(unpaid.po, 10, 'RET-FULL'));
  const unpaidInvoice = await ConsolidatedInvoice.findById(unpaidGRN.consolidatedInvoiceId);
  await ok(returns.createPurchaseReturn, returnInput(unpaidInvoice, 10));
  await syncAllAutomatedJournals();
  assert.equal(await JournalEntry.countDocuments({ sourceModule: 'payment_disbursement', sourceId: unpaidInvoice._id }), 0);
});
test('purchase returns reject over-return, duplicate lines, reserved stock, invalid IDs and changed retry payload', async () => {
  const { product, po } = await setup(100);
  const grn = await ok(receipt.createGRN, input(po, 100, 'RET-LIMIT'));
  const invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  const stock = await Product.findById(product._id);
  stock.batches[0].reservedQuantity = 30; await stock.save();
  for (const body of [returnInput(invoice, 101), returnInput(invoice, 71), returnInput(invoice, -2), returnInput(invoice, 0), returnInput(invoice, 1, { invoiceId: 'bad' }), returnInput(invoice, 1, { items: [{invoiceItemId: invoice.items[0]._id, quantity: 1}, {invoiceItemId: invoice.items[0]._id, quantity: 1}] })]) {
    assert.equal((await call(returns.createPurchaseReturn, body)).success, false);
    assert.equal((await Product.findById(product._id)).stock, 100);
  }
  const body = returnInput(invoice, 10);
  await ok(returns.createPurchaseReturn, body);
  assert.equal((await call(returns.createPurchaseReturn, { ...body, returnReason: 'Different reason' })).success, false);
  assert.equal((await Product.findById(product._id)).stock, 90);
});
test('concurrent purchase returns cannot exceed the receipt or available stock', async () => {
  const { product, po } = await setup(100);
  const grn = await ok(receipt.createGRN, input(po, 100, 'RET-RACE'));
  const invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  const responses = await Promise.all([call(returns.createPurchaseReturn, returnInput(invoice, 70)), call(returns.createPurchaseReturn, returnInput(invoice, 70))]);
  assert.equal(responses.filter(r => r.success).length, 1);
  assert.equal((await Product.findById(product._id)).stock, 30);
  assert.equal((await ConsolidatedInvoice.findById(invoice._id)).returnCredit, 3920);
});
test('returning non-batch goods and later receiving or paying preserves return credit', async () => {
  const { product, po } = await setup(100, 'non-batch');
  const grn = await ok(receipt.createGRN, input(po, 50, 'N/A'));
  let invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  await ok(returns.createPurchaseReturn, returnInput(invoice, 10));
  assert.equal((await Product.findById(product._id)).stock, 40);
  await ok(receipt.createGRN, input(po, 50, 'N/A', 50));
  await ok(receipt.addConsolidatedPayment, { amount: 1000, method: 'bank' }, { invoiceId: invoice._id });
  invoice = await ConsolidatedInvoice.findById(invoice._id);
  assert.equal(invoice.returnCredit, 560);
  assert.equal(invoice.remainingAmount, 4040);
  assert.equal((await Product.findById(product._id)).stock, 90);
});
test('same batch number on different receipts keeps purchase return lots separate', async () => {
  const { product, po } = await setup(100);
  const grn = await ok(receipt.createGRN, input(po, 50, 'SAME-RET'));
  await ok(receipt.createGRN, input(po, 50, 'SAME-RET', 50));
  const invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  await ok(returns.createPurchaseReturn, returnInput(invoice, 20));
  const stock = await Product.findById(product._id);
  assert.equal(stock.batches.id(invoice.items[0].stockBatchId).quantity, 30);
  assert.equal(stock.batches.id(invoice.items[1].stockBatchId).quantity, 50);
});

test('return rolls back earlier stock deductions when another line lacks shared non-batch stock', async () => {
  const { product, po } = await setup(150, 'non-batch');
  const grn = await ok(receipt.createGRN, input(po, 100, 'N/A'));
  await ok(receipt.createGRN, input(po, 50, 'N/A', 100));
  const invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  const stock = await Product.findById(product._id); stock.stock = 80; await stock.save();
  const body = returnInput(invoice, 60, { items: [{ invoiceItemId: invoice.items[0]._id, quantity: 60 }, { invoiceItemId: invoice.items[1]._id, quantity: 40 }] });
  assert.equal((await call(returns.createPurchaseReturn, body)).success, false);
  assert.equal((await Product.findById(product._id)).stock, 80);
  assert.equal(await PurchaseReturn.countDocuments({ invoice: invoice._id }), 0);
  assert.equal((await ConsolidatedInvoice.findById(invoice._id)).returnCredit, 0);
});
test('full return reverses invoice rounding while retaining freight and handling', async () => {
  const { po } = await setup(1);
  const grn = await ok(receipt.createGRN, input(po, 1, 'RET-ROUND'));
  let invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  invoice = await ok(receipt.updateConsolidatedInvoice, { items: invoice.items.map(i => ({ ...i.toObject(), unitPrice: 50.6, taxRate: 0 })), freight: { amount: 10, taxRate: 0 } }, { invoiceId: invoice._id });
  const doc = await ok(returns.createPurchaseReturn, returnInput(invoice, 1));
  assert.equal(doc.total, 51);
  assert.equal(doc.roundOff, 0.4);
  invoice = await ConsolidatedInvoice.findById(invoice._id);
  assert.equal(invoice.remainingAmount, 10);
  const jv = await JournalEntry.findOne({ sourceId: doc._id });
  assert.equal(jv.totalDebit, jv.totalCredit);
});

test('foreign-currency fractional returns preserve rates, GST split and stock precision', async () => {
  const { product, po } = await setup(1);
  await PurchaseOrder.updateOne({ _id: po._id }, { currency: 'USD', exchangeRate: 80 });
  const grn = await ok(receipt.createGRN, input(po, 1, 'RET-USD', 0, { gstType: 'cgst_sgst' }));
  const invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  const doc = await ok(returns.createPurchaseReturn, returnInput(invoice, 0.1));
  await ok(returns.createPurchaseReturn, returnInput(invoice, 0.2));
  assert.equal((await Product.findById(product._id)).stock, 0.7);
  assert.equal(doc.currency, 'USD');
  assert.equal(doc.total, 5.6);
  const journal = await JournalEntry.findOne({ sourceId: doc._id });
  assert.equal(journal.currency, 'USD');
  assert.equal(journal.totalDebit, journal.totalCredit);
  await ok(returns.cancelPurchaseReturn, { reason: 'Goods retained' }, { id: doc._id });
  assert.equal((await Product.findById(product._id)).stock, 0.8);
});

test('replacement receipts preserve MRP across partial rounds and separate changed MRP', async () => {
  const { product, po } = await setup(100);
  const grn = await ok(receipt.createGRN, input(po, 100, 'MRP-ORIGINAL'));
  const invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  const doc = await ok(returns.createPurchaseReturn, returnInput(invoice, 20));
  assert.equal(doc.items[0].mrp, 80);
  const item = { itemId: String(doc.items[0]._id), productId: String(product._id), quantity: 5, batchNumber: 'MRP-NEW' };
  for (const mrp of ['', 100, 0]) {
    await ok(returns.receiveReplacement, { items: [{ ...item, mrp }], receivedDate: '2026-09-26' }, { id: doc._id });
  }
  const stock = await Product.findById(product._id);
  assert.equal(stock.stock, 95);
  assert.deepEqual(stock.batches.filter(b => b.batchNumber === 'MRP-NEW').map(b => b.mrp), [80, 100, 0]);
  assert.deepEqual(stock.stockMovements.slice(-3).map(m => m.mrp), [80, 100, 0]);
  const updated = await PurchaseReturn.findById(doc._id);
  assert.equal(updated.replacementStatus, 'partial');
  assert.deepEqual(updated.replacementHistory.map(h => h.items[0].mrp), [80, 100, 0]);
  await ok(returns.receiveReplacement, { items: [item] }, { id: doc._id });
  assert.equal((await PurchaseReturn.findById(doc._id)).replacementStatus, 'received');
});

test('legacy pending replacement resolves MRP from original GRN when lot is missing', async () => {
  const { product, po } = await setup(100);
  const grn = await ok(receipt.createGRN, input(po, 100, 'LEGACY-MRP'));
  const invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  const doc = await ok(returns.createPurchaseReturn, returnInput(invoice, 100));
  await PurchaseReturn.updateOne({ _id: doc._id }, { $unset: { 'items.0.mrp': '' } });
  await Product.updateOne({ _id: product._id }, { $set: { batches: [] } });
  await ok(returns.receiveReplacement, { items: [{ itemId: doc.items[0]._id, quantity: 100, batchNumber: 'LEGACY-NEW' }] }, { id: doc._id });
  assert.equal((await Product.findById(product._id)).batches[0].mrp, 80);
});

test('invalid replacement MRP rolls back stock and return counters', async () => {
  const { product, po } = await setup(10);
  const grn = await ok(receipt.createGRN, input(po, 10, 'INVALID-MRP'));
  const invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  const doc = await ok(returns.createPurchaseReturn, returnInput(invoice, 5));
  for (const mrp of [-1, 'abc', 'Infinity', ' ', false]) {
    const response = await call(returns.receiveReplacement, { items: [{ itemId: doc.items[0]._id, quantity: 1, mrp }] }, { id: doc._id });
    assert.equal(response.success, false);
    assert.equal((await Product.findById(product._id)).stock, 5);
    assert.equal((await PurchaseReturn.findById(doc._id)).items[0].replacedQty, 0);
  }
});

test('non-batch replacement records MRP in stock movement', async () => {
  const { product, po } = await setup(10, 'non-batch');
  const grn = await ok(receipt.createGRN, input(po, 10, 'N/A'));
  const invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
  const doc = await ok(returns.createPurchaseReturn, returnInput(invoice, 5));
  await ok(returns.receiveReplacement, { items: [{ itemId: doc.items[0]._id, quantity: 5 }] }, { id: doc._id });
  const stock = await Product.findById(product._id);
  assert.equal(stock.stock, 10);
  assert.equal(stock.stockMovements.at(-1).mrp, 80);
});
