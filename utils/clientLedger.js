const id = value => String(value?._id || value || '');
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = value => Math.round((num(value) + Number.EPSILON) * 100) / 100;
const date = value => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString().slice(0, 10) : '';

function buildClientLedger({ client, invoices = [], returns = [] }) {
  const entries = [], paymentRecords = [], materialItems = [], warnings = [];
  const active = invoices.filter(invoice => !['draft', 'cancelled'].includes(invoice.status));
  const currencyOf = invoice => invoice.currency || client.currency || 'INR';
  const add = entry => entries.push({ debit: 0, credit: 0, notes: '', ...entry });
  for (const invoice of active) {
    const currency = currencyOf(invoice), refDoc = invoice.invoiceNumber || id(invoice._id);
    add({ id: `invoice-${id(invoice._id)}`, type: 'Sales invoice', date: date(invoice.date || invoice.createdAt), refDoc, currency, debit: money(invoice.total) });
    const seen = new Set(); let paid = 0;
    for (const [index, payment] of (invoice.payments || []).entries()) {
      const key = id(payment._id);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      const amount = money(payment.amount);
      if (!amount) continue;
      const entry = { id: `payment-${id(invoice._id)}-${key || index}`, type: 'Payment received', date: date(payment.date), refDoc, currency, credit: amount,
        amount, method: payment.method || 'Not recorded', reference: payment.reference || '', notes: payment.notes || '' };
      add(entry); paymentRecords.push(entry); paid = money(paid + amount);
    }
    if (money(invoice.paidAmount) > paid) {
      const amount = money(invoice.paidAmount - paid);
      const entry = { id: `legacy-paid-${id(invoice._id)}`, type: 'Legacy payment', date: '', refDoc, currency, credit: amount, amount,
        method: 'Not recorded', reference: '', notes: 'Recorded paid balance without a detailed payment record.' };
      add(entry); paymentRecords.push(entry); warnings.push(`${refDoc}: ${currency} ${amount.toFixed(2)} paid has no dated payment history.`);
    } else if (money(invoice.paidAmount) !== paid) warnings.push(`${refDoc}: payment history differs from the saved paid total; the ledger uses payment history.`);
    const linked = returns.filter(note => id(note.invoice) === id(invoice._id));
    const posted = linked.filter(note => note.status === 'posted');
    if (!linked.length && num(invoice.returnCredit) > 0) {
      add({ id: `legacy-credit-${id(invoice._id)}`, type: 'Legacy return credit', date: '', refDoc, currency, credit: money(invoice.returnCredit), notes: 'Saved net return credit without linked credit note details.' });
      warnings.push(`${refDoc}: saved return credit has no linked credit note.`);
    }
    for (const note of posted) {
      add({ id: `credit-${id(note._id)}`, type: 'Credit note', date: date(note.returnDate || note.createdAt), refDoc: note.returnNumber, invoiceNumber: refDoc, currency, credit: money(note.total), notes: note.reason || '' });
      let applied = 0;
      for (const [index, shipment] of (note.replacementHistory || []).entries()) {
        const debit = money(shipment.creditUsed); applied = money(applied + debit);
        add({ id: `replacement-${id(note._id)}-${index}`, type: 'Replacement sent', date: date(shipment.sentDate), refDoc: `${note.returnNumber} / REP-${index + 1}`, invoiceNumber: refDoc, currency, debit, notes: shipment.notes || '' });
      }
      if (money(note.replacementCredit) > applied) {
        add({ id: `legacy-replacement-${id(note._id)}`, type: 'Legacy replacement', date: '', refDoc: note.returnNumber, invoiceNumber: refDoc, currency, debit: money(note.replacementCredit - applied), notes: 'Saved replacement credit without shipment details.' });
        warnings.push(`${note.returnNumber}: some replacement credit has no shipment history.`);
      } else if (money(note.replacementCredit) !== applied) warnings.push(`${note.returnNumber}: replacement history differs from saved credit; the ledger uses shipment history.`);
    }
    (invoice.items || []).filter(item => !item.freight && !/^(freight|insurance)(\s|\/|$)/i.test(item.description || '')).forEach((item, index) => {
      const returned = posted.flatMap(note => note.items || []).filter(line => id(item._id) && id(line.invoiceItemId) === id(item._id));
      materialItems.push({ id: `${id(invoice._id)}-${index}`, currency, invoiceNumber: refDoc, date: date(invoice.date), productName: item.description,
        batch: item.batch || '', unit: item.unit || 'Units', quantity: num(item.quantity), returned: returned.reduce((sum, line) => sum + num(line.quantity), 0),
        replaced: returned.reduce((sum, line) => sum + num(line.replacedQty), 0), rate: money(item.rate) });
    });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || Number(b.type === 'Sales invoice') - Number(a.type === 'Sales invoice') || a.id.localeCompare(b.id));
  const currencies = [...new Set([client.currency || 'INR', ...entries.map(entry => entry.currency)])].sort();
  const summaries = currencies.map(currency => {
    let balance = 0;
    const rows = entries.filter(entry => entry.currency === currency);
    rows.forEach(entry => { balance = money(balance + entry.debit - entry.credit); entry.balance = balance; });
    const sum = (types, field) => money(rows.filter(row => types.includes(row.type)).reduce((total, row) => total + row[field], 0));
    return { currency, invoiceCount: active.filter(invoice => currencyOf(invoice) === currency).length,
      totalSales: sum(['Sales invoice'], 'debit'), totalPaid: sum(['Payment received', 'Legacy payment'], 'credit'),
      totalCredits: sum(['Credit note', 'Legacy return credit'], 'credit'), replacementApplied: sum(['Replacement sent', 'Legacy replacement'], 'debit'),
      closingBalance: balance, balanceDue: Math.max(0, balance), customerCredit: Math.max(0, -balance) };
  });
  return { client: { _id: client._id, name: client.name, companyName: client.companyName, gst: client.gst, email: client.email, phone: client.phone, address: client.address, currency: client.currency },
    generatedAt: new Date().toISOString(), currencies, summaries, entries, paymentRecords, materialItems, warnings };
}
module.exports = { buildClientLedger };
