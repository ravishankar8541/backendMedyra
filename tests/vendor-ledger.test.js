const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildVendorLedger } = require('../utils/vendorLedger');
const supplier = { _id: 'vendor-1', companyName: 'Test Vendor', currency: 'INR' };
const invoice = (overrides = {}) => ({ _id: 'inv-1', invoiceNumber: 'PI-1', poNumber: 'PO-1', purchaseOrder: 'po-1',
  status: 'generated', invoiceDate: '2026-09-01', currency: 'INR', grandTotal: 1000, paidAmount: 0, payments: [], ...overrides });
const payment = (overrides = {}) => ({ _id: 'pay-1', date: '2026-09-02', amount: 200, method: 'bank', reference: '', ...overrides });
const build = data => buildVendorLedger({ supplier, ...data });

test('bill comes from actual invoices; linked GRN payments are not counted again', () => {
  const pay = payment();
  const result = build({ orders: [{ _id: 'po-1', total: 9000, items: [] }],
    invoices: [invoice({ paidAmount: 200, payments: [pay] })],
    receipts: [{ _id: 'grn-1', status: 'completed', purchaseOrder: 'po-1', consolidatedInvoiceId: 'inv-1', paidAmount: 200, payments: [{ ...pay, _id: 'old-mirror-id' }] }] });
  assert.equal(result.summaries[0].totalBilledValue, 1000);
  assert.equal(result.summaries[0].totalPaidValue, 200);
  assert.equal(result.summaries[0].closingBalance, 800);
  assert.equal(result.paymentRecords.length, 1);
});

test('keeps two genuine payments with identical dates, amounts and blank references', () => {
  const result = build({ invoices: [invoice({ paidAmount: 400, payments: [payment(), payment({ _id: 'pay-2' })] })] });
  assert.equal(result.paymentRecords.length, 2);
  assert.equal(result.summaries[0].totalPaidValue, 400);
});

test('returns reduce payable once; supplier credit is derived rather than deducted twice', () => {
  const result = build({ invoices: [invoice({ paidAmount: 900, payments: [payment({ amount: 900 })], returnCredit: 300, supplierCredit: 200 })],
    returns: [{ _id: 'r1', invoice: 'inv-1', status: 'completed', returnNumber: 'PR-1', returnDate: '2026-09-03', total: 300, currency: 'INR' }] });
  assert.equal(result.summaries[0].totalReturnCredit, 300);
  assert.equal(result.summaries[0].balanceDue, 0);
  assert.equal(result.summaries[0].supplierCredit, 200);
  assert.equal(result.entries.at(-1).balance, -200);
});

test('cancelled returns and draft documents do not affect posted balances', () => {
  const result = build({ invoices: [invoice({ returnCredit: 300 }), invoice({ _id: 'draft', status: 'draft', grandTotal: 9999 })],
    receipts: [{ _id: 'cancelled', status: 'cancelled', payments: [payment()] }],
    returns: [{ _id: 'r1', invoice: 'inv-1', status: 'cancelled', total: 300 }] });
  assert.equal(result.summaries[0].closingBalance, 1000);
  assert.equal(result.summaries[0].totalReturnCredit, 0);
});

test('separates currencies and keeps decimal arithmetic stable', () => {
  const result = build({ invoices: [invoice({ grandTotal: 0.3, paidAmount: 0.1, payments: [payment({ amount: 0.1 })] }), invoice({ _id: 'usd', currency: 'USD', grandTotal: 50 })] });
  assert.deepEqual(result.currencies, ['INR', 'USD']);
  assert.equal(result.summaries[0].closingBalance, 0.2);
  assert.equal(result.summaries[1].closingBalance, 50);
});

test('historical paid totals produce explicit undated entries without invented methods', () => {
  const result = build({ invoices: [invoice({ paidAmount: 350, payments: [payment()] })] });
  const legacy = result.paymentRecords.find(row => row.type === 'Legacy payment');
  assert.equal(legacy.amount, 150);
  assert.equal(legacy.date, '');
  assert.equal(legacy.method, 'Not recorded');
  assert.equal(result.summaries[0].totalPaidValue, 350);
  assert.equal(result.entries.at(-1).balance, 650);
  assert.equal(result.warnings.length, 1);
});

test('uses actual payment entries when a cached paid amount is stale', () => {
  const result = build({ invoices: [invoice({ paidAmount: 0, payments: [payment()] })] });
  assert.equal(result.summaries[0].totalPaidValue, 200);
  assert.match(result.warnings[0], /stored paid total/);
});

test('receipt payment details fill missing invoice history and populated links resolve', () => {
  const result = build({ invoices: [invoice({ paidAmount: 200 })], receipts: [{ _id: 'grn-1', status: 'completed',
    consolidatedInvoiceId: { _id: 'inv-1' }, purchaseOrder: { _id: 'po-1' }, payments: [payment()], paidAmount: 200 }] });
  assert.equal(result.paymentRecords.length, 1);
  assert.equal(result.paymentRecords[0].date, '2026-09-02');
});

test('unlinked receipt payments are included once as supplier credit', () => {
  const result = build({ receipts: [{ _id: 'grn-1', status: 'completed', grnNumber: 'GRN-1', paidAmount: 200, payments: [payment()] }] });
  assert.equal(result.summaries[0].supplierCredit, 200);
  assert.equal(result.summaries[0].totalBilledValue, 0);
});

test('legacy return credit is retained when no debit note records exist', () => {
  const result = build({ invoices: [invoice({ returnCredit: 100 })] });
  assert.equal(result.summaries[0].closingBalance, 900);
  assert.equal(result.entries[0].type, 'Legacy return credit');
});

test('material quantities use accepted receipts, exclude cancellations and match order line IDs', () => {
  const result = build({ orders: [{ _id: 'po-1', items: [{ _id: 'line-1', productId: 'p1', quantity: 10, receivedQty: 99, unitPrice: 2 }, { _id: 'line-2', productId: 'p1', quantity: 4 }] },
    { _id: 'cancelled-po', status: 'cancelled', items: [{ quantity: 50 }] }],
    receipts: [{ _id: 'g1', status: 'completed', purchaseOrder: { _id: 'po-1' }, items: [{ purchaseOrderItemId: 'line-1', receivedQty: 8, acceptedQty: 6 }] },
      { _id: 'g2', status: 'cancelled', purchaseOrder: 'po-1', items: [{ purchaseOrderItemId: 'line-1', acceptedQty: 4 }] }] });
  assert.equal(result.summaries[0].totalOrdersCount, 1);
  assert.equal(result.summaries[0].totalReceivedQty, 6);
  assert.equal(result.summaries[0].totalRemainingQty, 8);
  assert.equal(result.materialItems[1].receivedQty, 0);
});

test('all historical entries are retained beyond the old 200-record limit', () => {
  const result = build({ invoices: Array.from({ length: 251 }, (_, i) => invoice({ _id: `inv-${i}`, grandTotal: 10 })) });
  assert.equal(result.entries.length, 251);
  assert.equal(result.summaries[0].totalBilledValue, 2510);
  assert.equal(result.entries.at(-1).balance, 2510);
});

test('material summary keeps boxes and strips separate', () => {
  const result = build({ orders: [{ _id: 'po-1', items: [
    { _id: 'l1', quantity: 10, unit: 'Boxes' }, { _id: 'l2', quantity: 100, unit: 'Strips' },
  ] }] });
  assert.deepEqual(result.summaries[0].quantityByUnit, [
    { unit: 'Boxes', ordered: 10, accepted: 0, pending: 10 },
    { unit: 'Strips', ordered: 100, accepted: 0, pending: 100 },
  ]);
});
