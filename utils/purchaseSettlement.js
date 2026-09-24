const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

// Keep the original bill and payments intact; returns are separate supplier credits.
function settleInvoice(invoice) {
  const net = money(Number(invoice.grandTotal || 0) - Number(invoice.returnCredit || 0));
  const paid = Number(invoice.paidAmount || 0);
  invoice.remainingAmount = Math.max(0, money(net - paid));
  invoice.supplierCredit = Math.max(0, money(paid - net));
  invoice.paymentStatus = invoice.remainingAmount === 0 ? 'paid' : paid > 0 || invoice.returnCredit > 0 ? 'partial' : 'pending';
  invoice.status = invoice.paymentStatus === 'paid' ? 'paid' : 'generated';
  return invoice;
}
module.exports = { money, settleInvoice };
