const { jsPDF } = require('jspdf');
const { DOMParser } = require('linkedom');
require('jspdf-autotable');
const { purchasePdfLayout } = require('./purchasePdfLayout');

// Reuse the print document's displayed values so invoice/payment calculations
// remain identical. Parse it inertly; never mount its scripts or CSS in the app.
function buildPurchaseInvoicePdf(html, { currency, symbol, logo, items = [] } = {}) {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const root = source.querySelector('.invoice-container');
  if (!root?.querySelector('.items-table')) throw new Error('Invoice document could not be prepared.');
  const clean = text => {
    let value = String(text || '').trim();
    if (symbol && symbol !== currency) value = value.split(symbol).join(currency + ' ');
    return value.replace(/[—–]/g, '-');
  };
  const text = node => clean(node?.textContent);
  const lines = node => [...(node?.querySelectorAll('p, h4') || [])].map(text).join('\n');
  const doc = new jsPDF({ compress: true });
  const { table, header: drawHeader, summary, footer } = purchasePdfLayout(doc);
  const header = root.querySelectorAll('.header-table td');
  const headerEnd = drawHeader('Purchase Invoice', lines(header[0]), logo);
  const vendor = root.querySelector('.section-title')?.parentElement;
  table({ startY: headerEnd, body: [[`VENDOR DETAILS\n${lines(vendor)}`, lines(header[1])]], rowPageBreak: 'avoid',
    columnStyles: { 0: { cellWidth: 91 }, 1: { cellWidth: 91 } },
  });
  const cells = row => [...row.children].map(cell => cell.querySelector('p') ? lines(cell) : text(cell));
  const groups = [];
  const byProduct = new Map();
  const date = value => {
    if (!value) return '-';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString('en-GB', { timeZone: 'UTC' });
  };
  [...root.querySelectorAll('.items-table tbody tr')].forEach((row, index) => {
    const values = cells(row);
    const item = items[index];
    const identity = item?.productId?._id || item?.productId || item?.sku || values[1];
    // Group product batches across PO lines and rates; keep units and descriptions distinct.
    const isProduct = item || (values[2] && !['-', 'N/A'].includes(values[2]));
    const key = isProduct ? JSON.stringify([String(identity), values[1], values[4]]) : `charge-${index}`;
    let group = byProduct.get(key);
    if (!group) {
      group = { values, quantity: 0, amount: 0, batches: [], isProduct };
      byProduct.set(key, group); groups.push(group);
    }
    group.quantity += Number(values[3]);
    group.amount += Number(values[7]);
    group.batches.push([values[2], isProduct ? values[3] : '-', date(item?.mfgDate), date(item?.expDate), values[5], values[6]]);
  });
  const body = groups.map((group, index) => {
    // Pad each batch's wrapped text equally across its four columns, so quantities
    // and dates stay aligned even for long batch numbers or page continuations.
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    const batchColumns = [[], [], [], [], [], []];
    group.batches.forEach(batch => {
      const wrapped = batch.map((value, i) => doc.splitTextToSize(String(value), [19, 9, 14, 14, 13, 6][i]));
      const height = Math.max(...wrapped.map(lines => lines.length));
      wrapped.forEach((lines, i) => batchColumns[i].push(...lines, ...Array(height - lines.length).fill('')));
    });
    const taxRates = new Set(group.batches.map(batch => batch[5]));
    const taxDisplay = taxRates.size === 1 ? group.batches[0][5] : batchColumns[5].join('\n');
    return [index + 1, group.values[1], ...batchColumns.slice(0, 4).map(lines => lines.join('\n')), String(group.quantity), group.values[4], batchColumns[4].join('\n'), taxDisplay, group.amount.toFixed(2)];
  });
  table({ startY: doc.lastAutoTable.finalY, theme: 'grid', rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2, textColor: 20, lineColor: [155, 155, 155], lineWidth: 0.2, overflow: 'linebreak' },
    head: [['#', 'Item & Description', 'Batch', 'Batch Qty', 'Mfg Date', 'Exp Date', 'Qty', 'Unit', `Rate (${currency || 'INR'})`, 'Tax', `Total (${currency || 'INR'})`]],
    body,
    columnStyles: Object.fromEntries([7, 34, 23, 13, 18, 18, 12, 12, 17, 10, 18].map((cellWidth, i) => [i, { cellWidth, ...([3, 6, 8, 9, 10].includes(i) ? { halign: 'right' } : {}) }])),
  });
  summary(lines(root.querySelector('.bottom-grid > div')),
    [...root.querySelectorAll('.total-row')].map(row => [...row.children].map(text)));
  doc.setProperties({ title: text(source.querySelector('title')) || 'Purchase Invoice', author: 'Medyra Pharmaceutical' });
  footer('Purchase Invoice');
  return doc;
}

module.exports = { buildPurchaseInvoicePdf };
