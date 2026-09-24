const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const { money } = require('./purchaseSettlement');

// Posted with the stock movement and credit, in the same MongoDB transaction.
module.exports = async function postReturnJournal(doc) {
  const templates = {
    '2000': ['Accounts Payable (Creditors / Suppliers)', 'liability', 'accounts_payable'],
    '1030': ['Pharma Inventory Asset', 'asset', 'inventory'],
    '1040': ['Input GST Credit (CGST)', 'asset', 'current_asset'],
    '1041': ['Input GST Credit (SGST)', 'asset', 'current_asset'],
    '1042': ['Input GST Credit (IGST)', 'asset', 'current_asset'],
    '5080': ['Round-off Expense / (Gain)', 'expense', 'operating_expense'],
  };
  const lines = [];
  async function line(code, debit, credit) {
    if (!debit && !credit) return;
    const [name, type, subType] = templates[code];
    const account = await Account.findOneAndUpdate({ code }, { $setOnInsert: { code, name, type, subType, isSystem: true, isActive: true } }, { upsert: true, new: true });
    lines.push({ account: account._id, accountCode: code, accountName: account.name, debit, credit,
      entityType: 'Supplier', entityId: doc.supplierId, description: doc.returnNumber });
  }
  await line('2000', doc.total, 0);
  await line('1030', 0, doc.subtotal);
  if (doc.gstType === 'cgst_sgst') {
    await line('1040', 0, money(doc.totalTax / 2));
    await line('1041', 0, money(doc.totalTax - money(doc.totalTax / 2)));
  } else await line('1042', 0, doc.totalTax);
  const difference = money(doc.total - doc.subtotal - doc.totalTax);
  await line('5080', difference < 0 ? -difference : 0, difference > 0 ? difference : 0);
  await JournalEntry.findOneAndUpdate({ sourceModule: 'purchase_return', sourceId: doc._id }, {
    entryNumber: `JV-PR-${doc._id}`, voucherNo: `JV-PR-${doc._id}`, date: doc.returnDate,
    referenceNumber: doc.returnNumber, sourceModule: 'purchase_return', sourceId: doc._id,
    memo: `Purchase return ${doc.returnNumber} / ${doc.invoiceNumber}`, currency: doc.currency,
    lines, totalDebit: money(lines.reduce((sum, row) => sum + row.debit, 0)),
    totalCredit: money(lines.reduce((sum, row) => sum + row.credit, 0)), status: 'posted', createdBy: doc.createdBy,
  }, { upsert: true, new: true, runValidators: true });
};
