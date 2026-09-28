const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function balance(invoice, credit = Number(invoice.returnCredit || 0)) {
  const net = round(Number(invoice.total) - credit);
  const paid = Number(invoice.paidAmount || 0);
  return { returnCredit: round(credit), dueAmount: Math.max(0, round(net - paid)),
    customerCredit: Math.max(0, round(paid - net)) };
}
function lines(invoice, previous, requests) {
  if (!Array.isArray(requests) || !requests.length) throw new Error('Select at least one item to return.');
  const seen = new Set();
  const result = requests.map(request => {
    const id = String(request.invoiceItemId);
    if (seen.has(id)) throw new Error('Each invoice item can only appear once.');
    seen.add(id);
    const item = invoice.items.find(row => String(row._id) === id);
    if (!item || item.freight || /^(freight|insurance)(\s|\/|$)/i.test(item.description)) throw new Error('Select a product from this invoice.');
    const returned = previous.flatMap(note => note.items).filter(row => String(row.invoiceItemId) === id).reduce((sum, row) => sum + row.quantity, 0);
    const quantity = Number(request.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > Number(item.quantity) - returned) throw new Error(`${item.description}: return quantity exceeds the remaining quantity (${Number(item.quantity) - returned}).`);
    const unitPrice = Number(item.rate || 0), taxRate = Number(item.taxRate || 0);
    const subtotal = round(quantity * unitPrice), tax = round(subtotal * taxRate / 100);
    return { invoiceItemId: item._id, product: item.productId, stockBatchId: item.stockBatchId,
      productName: item.description, batchNumber: item.batch || '', unit: item.unit || 'Pcs', hsn: item.hsCode || '',
      mfgDate: item.mfgDate || '', expiryDate: item.expiryDate || '', quantity, unitPrice, taxRate,
      subtotal, tax, total: round(subtotal + tax), costPrice: Number(item.costPrice || 0), restock: request.restock === true };
  });
  const subtotal = round(result.reduce((sum, row) => sum + row.subtotal, 0));
  const totalTax = round(result.reduce((sum, row) => sum + row.tax, 0));
  const credited = round(previous.reduce((sum, note) => sum + note.total, 0));
  const remaining = round(Number(invoice.total) - credited);
  const raw = round(subtotal + totalTax);
  // Only the invoice's recorded rounding may reduce the final credit.
  const allReturned = invoice.items.every(item => !item.freight &&
    Number(item.quantity) === previous.flatMap(n => n.items).concat(result)
      .filter(row => String(row.invoiceItemId) === String(item._id)).reduce((sum, row) => sum + row.quantity, 0));
  const roundOff = (allReturned || raw > remaining) && Math.abs(raw - remaining) <= Math.abs(Number(invoice.rounding || 0)) + 0.02 ? round(remaining - raw) : 0;
  const total = round(raw + roundOff);
  if (total > remaining + 0.01 || total < 0) throw new Error('Credit exceeds the remaining invoice value.');
  return { items: result, subtotal, totalTax, roundOff, total };
}
module.exports = { round, balance, lines };
