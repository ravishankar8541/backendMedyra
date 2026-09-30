const { test } = require('node:test');
const assert = require('node:assert/strict');
const { productProfitability } = require('../utils/productProfitability');
const invoice = { _id: 'inv', invoiceNumber: 'SI-1', date: '2026-09-30', currency: 'INR', customer: { name: 'Buyer' }, items: [
  { _id: 'i1', productId: 'p', stockBatchId: 'b1', description: 'Vitamin C', batch: 'B1', quantity: 10, rate: 150, amount: 1500, costPrice: 100 },
  { _id: 'i2', productId: 'p', stockBatchId: 'b2', description: 'Vitamin C', batch: 'B2', quantity: 5, rate: 155, amount: 775, costPrice: 105 },
  { _id: 'i3', productId: 'p', stockBatchId: 'b3', description: 'Vitamin C', batch: 'B3', quantity: 5, rate: 160, amount: 800, costPrice: 106 }
] };
const purchase = { invoiceNumber: 'PI-1', invoiceDate: '2026-09-28', supplierName: 'Supplier', currency: 'INR', items: invoice.items.map(i => ({ productId: 'p', stockBatchId: i.stockBatchId, batchNumber: i.batch, acceptedQty: i.quantity, unitPrice: i.costPrice })) };
test('batch costs and source matching reproduce known gross profit', () => {
  const rows = productProfitability([invoice], [purchase], []);
  assert.equal(rows.reduce((s, r) => s + r.revenue, 0), 3075);
  assert.equal(rows.reduce((s, r) => s + r.cost, 0), 2055);
  assert.equal(rows.reduce((s, r) => s + r.profit, 0), 1020);
  assert.ok(rows.every(r => r.status === 'Matched'));
});
test('unknown costs are not treated as zero and foreign sales use INR costs', () => {
  const rows = productProfitability([{ ...invoice, currency: 'USD', exchangeRate: 80, items: [{ ...invoice.items[0], amount: 20, costPrice: 0 }, { ...invoice.items[1], amount: 10 }] }], [], []);
  assert.equal(rows[0].profit, null); assert.equal(rows[1].revenue, 800); assert.equal(rows[1].cost, 525);
});
test('ambiguous purchase sources remain explicit', () => {
  assert.equal(productProfitability([invoice], [purchase, { ...purchase, invoiceNumber: 'PI-2' }], [])[0].status, 'Multiple purchase sources');
});
test('return and replacement movements use their own dates and actual replacement cost', () => {
  const note = { _id: 'ret', invoice: 'inv', returnNumber: 'SR1', returnDate: '2026-10-01', items: [{ _id: 'ri', product: 'p', stockBatchId: 'b1', productName: 'Vitamin C', batchNumber: 'B1', quantity: 2, unitPrice: 150, subtotal: 300, costPrice: 100, restock: true }], replacementHistory: [{ sentDate: '2026-10-02', items: [{ _id: 'rp', returnItemId: 'ri', product: 'p', productName: 'Vitamin C', stockBatchId: 'b2', batchNumber: 'B2', quantity: 2, costPrice: 105 }] }] };
  const rows = productProfitability([invoice], [purchase], [note], { startDate: '2026-10-01', endDate: '2026-10-02' });
  assert.equal(rows.length, 2); assert.equal(rows[0].cost, 210); assert.equal(rows[1].cost, -200);
  assert.equal(rows.reduce((s, r) => s + r.profit, 0), -10);
  note.items[0].restock = false;
  assert.equal(productProfitability([invoice], [], [note], { endDate: '2026-10-01' }).find(r => r.kind === 'Return').cost, 0);
});
test('invalid periods rejected and future purchases are not linked', () => {
  assert.throws(() => productProfitability([], [], [], { startDate: '2026-10-01', endDate: '2026-09-30' }));
  assert.equal(productProfitability([invoice], [{ ...purchase, invoiceDate: '2026-10-01' }], [])[0].purchaseSources.length, 0);
});
