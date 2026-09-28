const { jsPDF } = require('jspdf');
const { DOMParser } = require('linkedom');
require('jspdf-autotable');
const logo = require('./documentLogo');

// Read the same displayed values as the print view; do not recalculate credits.
function buildDebitNotePdf(html, { currency = 'INR', symbol = 'Rs.' } = {}) {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const root = source.querySelector('.page-container');
  if (!root?.querySelector('.items-table')) throw new Error('Debit note could not be prepared.');
  const text = node => (node?.textContent || '').trim().replaceAll(symbol, currency + ' ').replace(/[—–]/g, '-');
  const lines = node => [...(node?.querySelectorAll('p, h4') || [])].map(text).join('\n');
  const doc = new jsPDF({ compress: true });
  const table = options => doc.autoTable({
    margin: { left: 14, right: 14, top: 16, bottom: 16 },
    styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak', textColor: [20, 30, 40] },
    headStyles: { fillColor: [1, 58, 89], textColor: 255 }, theme: 'plain', ...options,
  });
  const header = root.querySelectorAll('.header-table td');
  doc.setFillColor(0);
  doc.rect(14, 12, 40, 40, 'F');
  doc.addImage(logo, 'PNG', 15, 13, 38, 38);
  table({ startY: 12, tableWidth: 86, margin: { left: 110, right: 14, top: 16, bottom: 16 },
    head: [['DEBIT NOTE']], body: [[lines(header[1])]],
    headStyles: { fillColor: false, textColor: 0, fontSize: 15, halign: 'right' },
    columnStyles: { 0: { halign: 'right', fontStyle: 'bold' } },
  });
  table({ startY: Math.max(56, doc.lastAutoTable.finalY + 4), tableWidth: 105, body: [[lines(header[0])]] });
  table({ startY: doc.lastAutoTable.finalY + 4, body: [[lines(root.querySelector('.header-table').nextElementSibling)]] });
  const cells = row => [...row.children].map(cell => text(cell).replace(/\s+/g, ' '));
  table({ startY: doc.lastAutoTable.finalY + 4, theme: 'grid', rowPageBreak: 'avoid',
    head: [...root.querySelectorAll('.items-table thead tr')].map(cells),
    body: [...root.querySelectorAll('.items-table tbody tr')].map(cells),
    columnStyles: { 0: { cellWidth: 9 }, 1: { cellWidth: 49 }, 2: { cellWidth: 28 }, 3: { cellWidth: 24 }, 4: { cellWidth: 20 }, 5: { cellWidth: 24, halign: 'right' }, 6: { cellWidth: 28, halign: 'right' } },
  });
  table({ startY: doc.lastAutoTable.finalY + 4,
    body: [...root.querySelectorAll('.tot-row')].map(row => [...row.children].map(text)),
    columnStyles: { 0: { cellWidth: 125, halign: 'right' }, 1: { cellWidth: 57, halign: 'right', fontStyle: 'bold' } },
  });
  table({ startY: doc.lastAutoTable.finalY + 4, body: [[lines(root.querySelector('.bottom-section > div'))]] });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.text(`Debit Note | ${page} / ${pages}`, 196, 289, { align: 'right' });
  }
  doc.setProperties({ title: text(source.querySelector('title')), author: 'Medyra Pharmaceutical' });
  return doc;
}

module.exports = { buildDebitNotePdf };
