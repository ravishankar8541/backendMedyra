const math = require('./accountingMath');
const id = value => String(value?._id || value || '');
const num = value => Number(value || 0);

function productProfitability(invoices, purchases, returns, filters = {}) {
  math.range(filters.startDate, filters.endDate);
  const sources = purchases.flatMap(p => (p.items || []).map(i => ({ ...i, invoice: p })));
  const rows = [];
  const push = (invoice, item, event) => {
    const date = math.date(event.date);
    if (filters.startDate && date < math.date(filters.startDate)) return;
    if (filters.endDate && date > math.date(filters.endDate, true)) return;
    const productId = id(item.productId || item.product);
    const batch = item.batch || item.batchNumber || '';
    const matches = sources.filter(s => productId && id(s.productId) === productId &&
      (item.stockBatchId ? id(s.stockBatchId) === id(item.stockBatchId) : batch && s.batchNumber === batch) &&
      math.date(s.invoice.invoiceDate) <= date);
    const costKnown = Number.isFinite(Number(item.costPrice)) && Number(item.costPrice) > 0;
    const rate = math.exchangeRate(invoice);
    const revenue = math.round(event.revenue * rate);
    const cost = event.noCost ? 0 : costKnown ? math.round(event.costQty * Number(item.costPrice)) : null;
    rows.push({ id: `${id(invoice)}-${event.key}`, date: date.toISOString().slice(0, 10), kind: event.kind,
      invoiceNumber: invoice.invoiceNumber, reference: event.reference || invoice.invoiceNumber,
      customer: invoice.customer?.name || 'Unknown customer', productId,
      product: item.description || item.productName || 'Unknown product', batch: batch || 'No batch', unit: item.unit || '',
      quantity: event.quantity, sellingRate: math.round(num(item.rate ?? item.unitPrice) * rate),
      costRate: costKnown ? Number(item.costPrice) : null, revenue, cost,
      profit: cost === null ? null : math.round(revenue - cost),
      purchaseSources: matches.map(s => ({ vendor: s.invoice.supplierName, invoice: s.invoice.invoiceNumber,
        date: s.invoice.invoiceDate, quantity: s.acceptedQty, rate: math.round(num(s.unitPrice) * math.exchangeRate(s.invoice)) })),
      status: cost === null ? 'Cost needs review' : matches.length === 1 ? 'Matched' : matches.length ? 'Multiple purchase sources' : 'Purchase source unavailable'
    });
  };
  const invoiceMap = new Map(invoices.map(i => [id(i), i]));
  for (const invoice of invoices) for (const item of invoice.items || []) {
    if (item.freight || /^(freight|insurance)(\s|\/|$)/i.test(item.description || '')) continue;
    push(invoice, item, { key: id(item), date: invoice.date, kind: 'Sale', quantity: num(item.quantity),
      revenue: item.amount == null ? num(item.rate) * num(item.quantity) : num(item.amount), costQty: num(item.quantity) });
  }
  for (const note of returns) {
    const invoice = invoiceMap.get(id(note.invoice));
    if (!invoice) continue;
    for (const item of note.items || []) {
      push(invoice, item, { key: `${id(note)}-${id(item)}`, date: note.returnDate, kind: 'Return', reference: note.returnNumber,
        quantity: -num(item.quantity), revenue: -num(item.subtotal), costQty: -num(item.quantity), noCost: item.restock === false });
    }
    for (const [index, shipment] of (note.replacementHistory || []).entries()) for (const item of shipment.items || []) {
      const original = note.items.find(i => id(i) === id(item.returnItemId));
      if (!original) throw new Error('Replacement source item missing. Please review return records.');
      push(invoice, { ...item, unitPrice: original.unitPrice }, { key: `${id(note)}-replacement-${index}-${id(item)}`, date: shipment.sentDate,
        kind: 'Replacement', reference: note.returnNumber, quantity: num(item.quantity), revenue: num(original.unitPrice) * num(item.quantity), costQty: num(item.quantity) });
    }
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.invoiceNumber.localeCompare(b.invoiceNumber));
}
module.exports = { productProfitability };
