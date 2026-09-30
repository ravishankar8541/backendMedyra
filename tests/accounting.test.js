const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const sift = require('sift').default;
const math = require('../utils/accountingMath');
const Account = require('../models/Account');
const Journal = require('../models/JournalEntry');
const Invoice = require('../models/Invoice');
const { ConsolidatedInvoice: Purchase } = require('../models/GoodsReceipt');
const controller = require('../controllers/accountingController');
const oid = () => new mongoose.Types.ObjectId();

test('journal validation rejects malformed, unbalanced and imprecise money', () => {
  for (const lines of [[null, {}], [{ debit: -1 }, { credit: -1 }], [{ debit: 10 }, { credit: 9.99 }], [{ debit: 1.001 }, { credit: 1.001 }], [{ debit: 1, credit: 1 }, {}]]) {
    assert.throws(() => math.amounts(lines), { status: 400 });
  }
  assert.equal(math.amounts([{ debit: 0.1 }, { debit: 0.2 }, { credit: 0.3 }]).totalDebit, 0.3);
  assert.throws(() => math.classification('asset', 'tax_payable'), { status: 400 });
  assert.throws(() => math.range('2026-02-30', ''), { status: 400 });
  assert.throws(() => math.range('2026-10-01', '2026-09-30'), { status: 400 });
  assert.equal(math.date('30/09/2026', true).toISOString(), '2026-09-30T23:59:59.999Z');
});

test('statements include manual income, costs and retained earnings', () => {
  const bank = { _id: 'bank', type: 'asset', subType: 'bank' };
  const sales = { _id: 'sales', code: '4000', type: 'revenue' };
  const cost = { _id: 'cost', type: 'expense', subType: 'cost_of_goods_sold' };
  const entries = [{ lines: [{ account: bank, debit: 100 }, { account: sales, credit: 100 }] }, { lines: [{ account: cost, debit: 30 }, { account: bank, credit: 30 }] }];
  assert.equal(math.pnl(entries).netProfit, 70);
  const bs = math.balanceSheet(entries);
  assert.equal(bs.assets.totalAssets, 70);
  assert.equal(bs.equity.retainedEarnings, 70);
  assert.equal(bs.isBalanced, true);
});

test('currency conversion balances rounding and rejects missing rates', () => {
  const entry = { totalDebit: 0.03, totalCredit: 0.03, lines: [{ debit: 0.03 }, { credit: 0.01 }, { credit: 0.02 }] };
  const result = math.inRupees(entry, { currency: 'USD', exchangeRate: 83.33 });
  assert.equal(result.currency, 'INR');
  assert.equal(result.totalDebit, 2.5);
  assert.equal(result.totalCredit, 2.5);
  assert.equal(entry.lines[0].debit, 0.03);
  assert.throws(() => math.inRupees(entry, { currency: 'USD' }), { status: 400 });
});

test('sync reconciles edits, removed payments, duplicate document numbers and concurrent reads', async () => {
  let accounts = [], journals = [], sales = [], purchases = [];
  const saved = [];
  const mock = (model, method, fn) => { saved.push([model, method, model[method]]); model[method] = fn; };
  const query = rows => ({ sort() { return Promise.resolve(rows); } });
  mock(Account, 'find', async () => accounts);
  mock(Account, 'findOneAndUpdate', async (filter, update) => {
    let account = accounts.find(sift(filter));
    if (!account) { account = { _id: oid(), ...update.$setOnInsert }; accounts.push(account); }
    return account;
  });
  mock(Invoice, 'find', filter => query(sales.filter(sift(filter))));
  mock(Purchase, 'find', () => query(purchases));
  mock(Journal, 'find', async filter => journals.filter(sift(filter)));
  mock(Journal, 'findByIdAndDelete', async id => { journals = journals.filter(j => String(j._id) !== String(id)); });
  mock(Journal, 'deleteMany', async filter => { journals = journals.filter(j => !sift(filter)(j)); });
  mock(Journal, 'findOneAndUpdate', async (filter, payload) => {
    let entry = journals.find(sift(filter));
    if (!entry) { entry = { _id: oid() }; journals.push(entry); }
    Object.assign(entry, payload);
    return entry;
  });
  try {
    sales = [{ _id: oid(), invoiceNumber: 'INV/1', date: '2026-09-01', subtotal: 100, total: 100, totalCost: 40, payments: [{ amount: 20 }, { amount: 30 }] }, { _id: oid(), invoiceNumber: 'INV-1', date: '2026-09-01', subtotal: 10, total: 10 }];
    purchases = [{ _id: oid(), invoiceNumber: 'SAME', invoiceDate: '2026-09-01', subtotal: 50, grandTotal: 50, payments: [{ amount: 10 }, { amount: 20 }] }, { _id: oid(), invoiceNumber: 'SAME', invoiceDate: '2026-09-01', subtotal: 25, grandTotal: 25 }];
    await Promise.all([controller.syncAllAutomatedJournals(), controller.syncAllAutomatedJournals()]);
    assert.equal(new Set(journals.map(j => j.entryNumber)).size, journals.length);
    assert.equal(journals.filter(j => j.sourceModule === 'payment_receipt').length, 2);
    sales[0].payments = [{ amount: 15 }]; purchases[0].payments = [];
    sales[0].totalCost = 0;
    await controller.syncAllAutomatedJournals();
    assert.equal(journals.filter(j => j.sourceModule === 'payment_receipt').length, 1);
    assert.equal(journals.find(j => j.sourceModule === 'payment_receipt').totalDebit, 15);
    assert.equal(journals.filter(j => j.sourceModule === 'payment_disbursement').length, 0);
    assert.equal(journals.filter(j => j.sourceModule === 'inventory_adjustment').length, 0);
    sales[0].total = 0;
    await controller.syncAllAutomatedJournals();
    assert.equal(journals.filter(j => j.sourceModule === 'sales_invoice').length, 1);
    sales[1].status = 'cancelled';
    await controller.syncAllAutomatedJournals();
    assert.equal(journals.filter(j => j.sourceModule === 'sales_invoice').length, 0);
    sales[1].status = 'sent'; sales[1].currency = 'USD'; sales[1].exchangeRate = 80;
    await controller.syncAllAutomatedJournals();
    assert.equal(journals.find(j => j.sourceModule === 'sales_invoice').totalDebit, 800);
    sales[1].status = 'draft';
    await controller.syncAllAutomatedJournals();
    assert.equal(journals.filter(j => j.sourceModule === 'sales_invoice').length, 0);
    for (const j of journals) assert.equal(j.totalDebit, j.totalCredit);
  } finally { saved.forEach(([model, method, fn]) => { model[method] = fn; }); }
});
