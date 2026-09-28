const mongoose = require('mongoose');
const { fail, plain } = require('./grnStock');
const money = value => Math.round(Number(value) * 100) / 100;
module.exports = function correctInvoicePayment(invoice, input, actor) {
  if (input.paidAmount === undefined) return false;
  if (input.paidAmount === '' || input.paidAmount === null || !Number.isFinite(Number(input.paidAmount)) || Number(input.paidAmount) < 0)
    fail('Paid amount must be a valid non-negative amount.');
  const target = money(input.paidAmount), previous = money(invoice.paidAmount || 0);
  if (target === previous) return false;
  if (input.expectedPaidAmount === undefined || money(input.expectedPaidAmount) !== previous)
    fail('Payment changed since this invoice was opened. Reopen the invoice before editing.');
  const reason = String(input.paymentCorrectionReason || '').trim();
  if (!reason) fail('Enter a reason for correcting the paid amount.');
  let payments = (invoice.payments || []).map(plain);
  if (!payments.length && previous > 0) payments = [{ _id: new mongoose.Types.ObjectId(), date: invoice.invoiceDate, amount: previous, method: 'other', notes: 'Historical paid balance; original payment details unavailable.' }];
  if (money(payments.reduce((sum, row) => sum + Number(row.amount), 0)) !== previous)
    fail('Payment history does not match the paid balance. Reconcile it before editing.');
  const before = payments.map(row => ({ ...row }));
  if (target > previous) {
    if (!['cash', 'bank', 'cheque', 'online', 'bank_transfer', 'upi', 'advance', 'other'].includes(input.paymentMethod)) fail('Select a valid payment method.');
    const date = String(input.paymentDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail('Enter a valid payment date.');
    payments.push({ _id: new mongoose.Types.ObjectId(), amount: money(target - previous), date, method: input.paymentMethod, reference: String(input.paymentReference || ''), notes: `Paid amount correction: ${reason}`, receivedBy: actor });
  } else {
    let reduction = money(previous - target);
    // Preserve earlier payment details; reduce the most recently recorded entries first.
    for (let i = payments.length - 1; i >= 0 && reduction > 0; i--) {
      const delta = Math.min(Number(payments[i].amount), reduction);
      payments[i].amount = money(Number(payments[i].amount) - delta);
      reduction = money(reduction - delta);
    }
    payments = payments.filter(row => row.amount > 0);
  }
  invoice.paymentCorrections.push({ previousAmount: previous, correctedAmount: target, reason, correctedBy: actor, correctedAt: new Date(), previousPayments: before, correctedPayments: payments });
  invoice.payments = payments;
  invoice.paidAmount = target;
  return true;
};
