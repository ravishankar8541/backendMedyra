const idOf = value => String(value?._id || value || '');
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
const qty = value => Math.round(number(value) * 1e6) / 1e6;
const dateOf = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};
const posted = doc => !['draft', 'cancelled', 'pending'].includes(doc.status);

function buildVendorLedger({ supplier, orders = [], receipts = [], invoices = [], returns = [], warnings = [] }) {
  warnings = [...warnings];
  const entries = [], paymentRecords = [], materialItems = [];
  const activeInvoices = invoices.filter(posted);
  const activeReceipts = receipts.filter(posted);
  const currencyOf = doc => doc.currency || supplier.currency || 'INR';
  const invoiceForReceipt = receipt => {
    const explicit = idOf(receipt.consolidatedInvoiceId || receipt.invoiceId);
    if (explicit) return invoices.find(inv => idOf(inv._id) === explicit);
    const byReceipt = invoices.find(inv => (inv.grnIds || []).some(id => idOf(id) === idOf(receipt._id)));
    if (byReceipt) return byReceipt;
    const byOrder = invoices.filter(inv => idOf(receipt.purchaseOrder)
      ? idOf(inv.purchaseOrder) === idOf(receipt.purchaseOrder)
      : receipt.poNumber && inv.poNumber === receipt.poNumber);
    return byOrder.length === 1 ? byOrder[0] : undefined;
  };
  const receiptInvoice = new Map(activeReceipts.map(receipt => [idOf(receipt._id), invoiceForReceipt(receipt)]));

  const addPayments = (doc, fallback = []) => {
    const own = doc.payments || [];
    const payments = own.length ? own : fallback;
    const seen = new Set();
    let detailedTotal = 0;
    payments.forEach((payment, index) => {
      // Identity, never amount/date/reference: two equal payments can both be real.
      const identity = idOf(payment._id);
      if (identity && seen.has(identity)) return;
      if (identity) seen.add(identity);
      const amount = money(payment.amount);
      if (!amount) return;
      const record = {
        id: `payment-${idOf(doc._id)}-${identity || index}`, type: 'Payment',
        date: dateOf(payment.date), amount, currency: currencyOf(doc),
        method: payment.method || 'Not recorded', reference: payment.reference || payment.transactionId || '',
        notes: payment.notes || '', refDoc: doc.invoiceNumber || doc.grnNumber,
        poNumber: doc.poNumber || '', debit: amount, credit: 0,
      };
      detailedTotal = money(detailedTotal + amount);
      paymentRecords.push(record);
      entries.push(record);
    });
    const recordedPaid = money(doc.paidAmount);
    if (recordedPaid > detailedTotal) {
      const amount = money(recordedPaid - detailedTotal);
      const record = { id: `legacy-payment-${idOf(doc._id)}`, type: 'Legacy payment', date: '', amount,
        currency: currencyOf(doc), method: 'Not recorded', reference: '',
        notes: 'Recorded paid balance; payment date and transaction details are unavailable.',
        refDoc: doc.invoiceNumber || doc.grnNumber, poNumber: doc.poNumber || '', debit: amount, credit: 0 };
      paymentRecords.push(record);
      entries.push(record);
      warnings.push(`${record.refDoc}: ${amount.toFixed(2)} ${record.currency} has no detailed payment history.`);
    } else if (recordedPaid !== detailedTotal) {
      warnings.push(`${doc.invoiceNumber || doc.grnNumber}: payment entries differ from the stored paid total; the ledger uses the payment entries.`);
    }
  };

  activeInvoices.forEach(inv => {
    entries.push({ id: `invoice-${idOf(inv._id)}`, type: 'Purchase invoice', date: dateOf(inv.invoiceDate || inv.createdAt),
      refDoc: inv.invoiceNumber, poNumber: inv.poNumber || '', currency: currencyOf(inv),
      debit: 0, credit: money(inv.grandTotal), notes: '' });
    const linked = activeReceipts.filter(receipt => receiptInvoice.get(idOf(receipt._id)) === inv);
    addPayments(inv, linked.flatMap(receipt => receipt.payments || []));
    // A stored credit is only a fallback for older invoices with no return records.
    const linkedReturns = returns.filter(ret => idOf(ret.invoice) === idOf(inv._id));
    if (!linkedReturns.length && number(inv.returnCredit) > 0) {
      entries.push({ id: `legacy-credit-${idOf(inv._id)}`, type: 'Legacy return credit', date: '', refDoc: inv.invoiceNumber,
        poNumber: inv.poNumber || '', currency: currencyOf(inv), debit: money(inv.returnCredit), credit: 0,
        notes: 'Recorded return credit; debit note details are unavailable.' });
      warnings.push(`${inv.invoiceNumber}: return credit has no linked debit note details.`);
    }
  });
  // Goods receipt payments are mirrors when an invoice exists, not additional cash.
  activeReceipts.filter(receipt => !receiptInvoice.get(idOf(receipt._id))).forEach(receipt => {
    addPayments(receipt);
    if (number(receipt.paidAmount) || receipt.payments?.length) warnings.push(`${receipt.grnNumber}: payment is not linked to a purchase invoice.`);
  });
  returns.filter(ret => ret.status === 'completed').forEach(ret => entries.push({
    id: `return-${idOf(ret._id)}`, type: 'Debit note', date: dateOf(ret.returnDate || ret.createdAt),
    refDoc: String(ret.returnNumber || '').replace(/^PR-/i, 'DN-'), poNumber: ret.poNumber || '',
    currency: currencyOf(ret), debit: money(ret.total), credit: 0, notes: ret.returnReason || '',
  }));

  const activeOrders = orders.filter(order => order.status !== 'cancelled');
  activeOrders.forEach(po => {
    const linked = activeReceipts.filter(receipt => idOf(receipt.purchaseOrder)
      ? idOf(receipt.purchaseOrder) === idOf(po._id) : receipt.poNumber === po.poNumber);
    const received = new Map();
    linked.forEach(receipt => (receipt.items || []).forEach(item => {
      const matches = (po.items || []).filter(line => item.purchaseOrderItemId
        ? idOf(line._id) === idOf(item.purchaseOrderItemId)
        : item.productId ? idOf(line.productId || line.product) === idOf(item.productId)
          : item.sku ? line.sku === item.sku : (line.productName || line.name) === item.productName);
      if (matches.length !== 1) {
        warnings.push(`${receipt.grnNumber}: ${item.productName} could not be matched to a unique purchase order line.`);
        return;
      }
      const key = idOf(matches[0]._id);
      received.set(key, qty((received.get(key) || 0) + number(item.acceptedQty ?? item.receivedQty)));
    }));
    (po.items || []).forEach((item, index) => {
      const ordered = qty(item.quantity), accepted = received.get(idOf(item._id)) || 0;
      materialItems.push({ id: `${idOf(po._id)}-${index}`, poNumber: po.poNumber, orderDate: po.date || po.createdAt,
        expectedDate: po.expectedDate || '', purchaserName: po.purchaserName || '', productName: item.productName || item.name || item.product,
        sku: item.sku || '', batchNumber: item.batchNumber || '', orderedQty: ordered, receivedQty: accepted,
        remainingQty: qty(Math.max(0, ordered - accepted)), unit: item.unit || 'Units', unitPrice: money(item.unitPrice),
        totalAmount: money(item.total ?? ordered * number(item.unitPrice)), currency: currencyOf(po), status: po.status });
    });
  });
  // Undated legacy amounts are opening adjustments, not fabricated dated transactions.
  entries.sort((a, b) => a.date.localeCompare(b.date) ||
    (a.type === 'Purchase invoice' ? 0 : 1) - (b.type === 'Purchase invoice' ? 0 : 1) || a.id.localeCompare(b.id));
  const currencies = [...new Set([...entries.map(entry => entry.currency), ...activeOrders.map(currencyOf)])].sort();
  if (!currencies.length) currencies.push(supplier.currency || 'INR');
  const summaries = currencies.map(currency => {
    let balance = 0;
    const rows = entries.filter(entry => entry.currency === currency);
    rows.forEach(entry => { balance = money(balance + entry.credit - entry.debit); entry.balance = balance; });
    const materials = materialItems.filter(item => item.currency === currency);
    const quantityByUnit = [...new Set(materials.map(item => item.unit))].map(unit => {
      const rows = materials.filter(item => item.unit === unit);
      return { unit, ordered: qty(rows.reduce((sum, row) => sum + row.orderedQty, 0)),
        accepted: qty(rows.reduce((sum, row) => sum + row.receivedQty, 0)),
        pending: qty(rows.reduce((sum, row) => sum + row.remainingQty, 0)) };
    });
    const totalOrderedQty = qty(materials.reduce((sum, row) => sum + row.orderedQty, 0));
    const totalReceivedQty = qty(materials.reduce((sum, row) => sum + row.receivedQty, 0));
    return { currency, totalOrdersCount: activeOrders.filter(order => currencyOf(order) === currency).length,
      quantityByUnit, totalOrderedQty, totalReceivedQty, totalRemainingQty: qty(materials.reduce((sum, row) => sum + row.remainingQty, 0)),
      fulfillmentPercent: totalOrderedQty ? Math.round(totalReceivedQty / totalOrderedQty * 100) : 0,
      totalBilledValue: money(rows.reduce((sum, row) => sum + row.credit, 0)),
      totalPaidValue: money(paymentRecords.filter(row => row.currency === currency).reduce((sum, row) => sum + row.amount, 0)),
      totalReturnCredit: money(rows.filter(row => ['Debit note', 'Legacy return credit'].includes(row.type)).reduce((sum, row) => sum + row.debit, 0)),
      closingBalance: balance, balanceDue: Math.max(0, balance), supplierCredit: Math.max(0, -balance) };
  });
  paymentRecords.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { supplier: { _id: supplier._id, companyName: supplier.companyName, gstNumber: supplier.gstNumber, currency: supplier.currency },
    generatedAt: new Date().toISOString(), currencies, summaries, entries, paymentRecords, materialItems, warnings: [...new Set(warnings)] };
}

module.exports = { buildVendorLedger, idOf };
