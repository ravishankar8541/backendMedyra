const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildClientLedger } = require('../utils/clientLedger');
const client = { _id: '507f1f77bcf86cd799439011', name: 'QA Client', currency: 'INR', assignedTo: 'owner' };
const invoice = { _id: 'inv', leadId: client._id, invoiceNumber: 'INV-001', date: '2026-09-01', status: 'sent', currency: 'INR', total: 1180, paidAmount: 600,
  payments: [{ _id: 'p1', date: '2026-09-02', amount: 300 }, { _id: 'p2', date: '2026-09-02', amount: 300 }],
  items: [{ _id: 'item', description: 'Medicine', quantity: 10, unit: 'Box', rate: 100, batch: 'B1' }] };
const note = { _id: 'cn', invoice: 'inv', returnNumber: 'CN-001', returnDate: '2026-09-03', status: 'posted', total: 236, replacementCredit: 118,
  items: [{ invoiceItemId: 'item', quantity: 2, replacedQty: 1 }], replacementHistory: [{ sentDate: '2026-09-04', creditUsed: 118 }] };
test('client ledger reconciles invoices, distinct equal payments, credits and replacements', () => {
  const ledger = buildClientLedger({ client, invoices: [invoice], returns: [note] });
  assert.equal(ledger.summaries[0].closingBalance, 462);
  assert.equal(ledger.entries.at(-1).balance, 462);
  assert.equal(ledger.summaries[0].totalPaid, 600);
  assert.equal(ledger.summaries[0].replacementApplied, 118);
  assert.equal(ledger.materialItems[0].returned, 2);
  assert.equal(ledger.materialItems[0].replaced, 1);
  assert.equal(ledger.paymentRecords.length, 2);
});
test('currency balances stay separate and excess payments become customer credit', () => {
  const ledger = buildClientLedger({ client, invoices: [invoice, { ...invoice, _id: 'usd', currency: 'USD', total: 100, paidAmount: 200, payments: [{ amount: 200 }] }] });
  assert.equal(ledger.summaries.find(row => row.currency === 'INR').closingBalance, 580);
  assert.equal(ledger.summaries.find(row => row.currency === 'USD').customerCredit, 100);
});
test('draft/cancelled invoices and cancelled returns do not create receivables or credit', () => {
  const ledger = buildClientLedger({ client, invoices: [invoice, { ...invoice, status: 'draft' }, { ...invoice, status: 'cancelled' }], returns: [{ ...note, status: 'cancelled' }] });
  assert.equal(ledger.summaries[0].invoiceCount, 1);
  assert.equal(ledger.summaries[0].closingBalance, 580);
  assert.equal(ledger.materialItems[0].returned, 0);
});
test('legacy paid amount and return credit are reconciled without duplicate payments', () => {
  const ledger = buildClientLedger({ client, invoices: [{ ...invoice, paidAmount: 700, returnCredit: 100, payments: [invoice.payments[0], invoice.payments[0]] }] });
  assert.equal(ledger.summaries[0].totalPaid, 700);
  assert.equal(ledger.summaries[0].closingBalance, 380);
  assert.equal(ledger.paymentRecords.length, 2);
  assert.equal(ledger.paymentRecords.find(row => row.type === 'Legacy payment').date, '');
  assert.equal(ledger.warnings.length, 2);
});
test('empty clients have a valid zero statement and proforma values are not billed', () => {
  const ledger = buildClientLedger({ client: { ...client, totalValue: 99999, payment: { amount: 99999 } } });
  assert.equal(ledger.summaries[0].closingBalance, 0);
  assert.deepEqual(ledger.entries, []);
});
const Lead = require('../models/Lead'), Invoice = require('../models/Invoice'), SalesReturn = require('../models/SalesReturn');
const controller = require('../controllers/clientLedgerController');
const originals = [Lead.findById, Invoice.find, SalesReturn.find];
let currentClient = client, invoiceQuery, returnQuery;
Lead.findById = () => ({ lean: async () => currentClient });
Invoice.find = query => { invoiceQuery = query; return { lean: async () => [invoice] }; };
SalesReturn.find = query => { returnQuery = query; return { lean: async () => [note] }; };
after(() => { [Lead.findById, Invoice.find, SalesReturn.find] = originals; });
async function call(user, clientId = client._id) {
  let status = 200, body;
  await controller.getClientLedger({ params: { id: clientId }, user }, { status(value) { status = value; return this; }, json(value) { body = value; return this; } });
  return { status, body };
}
test('endpoint enforces client ownership and explicit invoice scoping', async () => {
  assert.equal((await call({ id: 'stranger', role: 'telecaller' })).status, 403);
  const response = await call({ id: 'owner', role: 'telecaller' });
  assert.equal(response.status, 200);
  assert.deepEqual(invoiceQuery, { leadId: client._id });
  assert.deepEqual(returnQuery, { invoice: { $in: ['inv'] } });
  assert.equal((await call({ id: 'admin', role: 'admin' })).status, 200);
  assert.equal((await call({ id: 'manager', role: 'sales', permissions: ['sales:view','sales:all_records'] })).status, 200);
});
test('endpoint rejects invalid and missing clients', async () => {
  assert.equal((await call({ role: 'admin' }, 'invalid')).status, 400);
  currentClient = null;
  try { assert.equal((await call({ role: 'admin' })).status, 404); } finally { currentClient = client; }
});
