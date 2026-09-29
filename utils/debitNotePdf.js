const { jsPDF } = require('jspdf');
const { DOMParser } = require('linkedom');
require('jspdf-autotable');
const logo = require('./documentLogo');
const { purchasePdfLayout } = require('./purchasePdfLayout');

// Read the same displayed values as the print view; do not recalculate credits.
function buildDebitNotePdf(html, { currency = 'INR', symbol = 'Rs.', items = [] } = {}) {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const root = source.querySelector('.page-container');
  if (!root?.querySelector('.items-table')) throw new Error('Debit note could not be prepared.');
  const text = node => (node?.textContent || '').trim().replaceAll(symbol, currency + ' ').replace(/[—–]/g, '-');
  const lines = node => [...(node?.querySelectorAll('p, h4') || [])].map(text).join('\n');
  const doc = new jsPDF({ compress: true });
  const { table, header: drawHeader, summary, footer } = purchasePdfLayout(doc);
  const header = root.querySelectorAll('.header-table td');
  const headerEnd = drawHeader('Debit Note', lines(header[0]), logo);
  table({ startY: headerEnd, rowPageBreak: 'avoid',
    body: [[lines(root.querySelector('.header-table').nextElementSibling), lines(header[1])]],
    columnStyles: { 0: { cellWidth: 91 }, 1: { cellWidth: 91 } },
  });
  const cells = row => [...row.children].map(cell => text(cell).replace(/\s+/g, ' '));
  const groups = [], byProduct = new Map();
  [...root.querySelectorAll('.items-table tbody tr')].forEach((row, index) => {
    const values = cells(row), item = items[index];
    const quantityText = values[4].match(/^([\d.]+)\s*(.*)$/);
    const quantity = Number(quantityText?.[1]);
    const unit = quantityText?.[2] || item?.unit || '';
    const amount = Number(values[6].replace(/,/g, ''));
    const identity = item?.product?._id || item?.product || item?.productId || item?.sku || values[1];
    // Keep different descriptions/reasons, HSN, units, rates and GST separate.
    const key = Number.isFinite(quantity) && Number.isFinite(amount)
      ? JSON.stringify([String(identity), values[1], values[3], unit, values[5], item?.taxRate ?? '']) : `line-${index}`;
    let group = byProduct.get(key);
    if (!group) {
      group = { values, quantity: 0, amount: 0, unit, batches: [], valid: Number.isFinite(quantity) && Number.isFinite(amount) };
      byProduct.set(key, group); groups.push(group);
    }
    group.quantity += quantity; group.amount += amount;
    group.batches.push([values[2], quantityText?.[1] || values[4]]);
  });
  const body = groups.map((group, index) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    const batchNumbers = [], batchQuantities = [];
    group.batches.forEach(([batch, qty]) => {
      const left = doc.splitTextToSize(batch, 24), right = doc.splitTextToSize(qty, 12);
      const count = Math.max(left.length, right.length);
      batchNumbers.push(...left, ...Array(count - left.length).fill(''));
      batchQuantities.push(...right, ...Array(count - right.length).fill(''));
    });
    return [index + 1, group.values[1], batchNumbers.join('\n'), batchQuantities.join('\n'), group.values[3],
      group.valid ? `${Number(group.quantity.toPrecision(12))}\n${group.unit}` : group.values[4], group.values[5], group.valid ? group.amount.toFixed(2) : group.values[6]];
  });
  table({ startY: doc.lastAutoTable.finalY, theme: 'grid', rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, overflow: 'linebreak', textColor: 20, lineColor: [155, 155, 155], lineWidth: 0.2 },
    head: [['#', 'Item & Description', 'Batch No.', 'Batch Qty', 'HSN/SAC', 'Qty', `Rate (${currency})`, `Amount (${currency})`]], body,
    columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 43 }, 2: { cellWidth: 28 }, 3: { cellWidth: 16, halign: 'right' }, 4: { cellWidth: 22 }, 5: { cellWidth: 17 }, 6: { cellWidth: 23, halign: 'right' }, 7: { cellWidth: 25, halign: 'right' } },
  });
  summary(lines(root.querySelector('.bottom-section > div')),
    [...root.querySelectorAll('.tot-row')].map(row => [...row.children].map(text)));
  footer('Debit Note');
  doc.setProperties({ title: text(source.querySelector('title')), author: 'Medyra Pharmaceutical' });
  return doc;
}

module.exports = { buildDebitNotePdf };
