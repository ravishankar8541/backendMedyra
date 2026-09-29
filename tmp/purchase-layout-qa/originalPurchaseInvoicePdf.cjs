const { jsPDF } = require('jspdf');
const { DOMParser } = require('linkedom');
require('jspdf-autotable');

// Reuse the print document's displayed values so invoice/payment calculations
// remain identical. Parse it inertly; never mount its scripts or CSS in the app.
function buildPurchaseInvoicePdf(html, { currency, symbol, logo } = {}) {
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
  const table = options => doc.autoTable({
    margin: { left: 14, right: 14, top: 16, bottom: 16 },
    styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak', textColor: [20, 30, 40] },
    headStyles: { fillColor: [1, 58, 89], textColor: 255 },
    theme: 'plain', ...options,
  });
  const header = root.querySelectorAll('.header-table td');
  if (logo) {
    doc.setFillColor(0);
    doc.rect(14, 12, 40, 40, 'F');
    doc.addImage(logo, 'PNG', 15, 13, 38, 38);
  }
  table({ startY: 12, tableWidth: 86, margin: { left: 110, right: 14, top: 16, bottom: 16 },
    head: [['PURCHASE INVOICE']], body: [[lines(header[1])]],
    headStyles: { fillColor: false, textColor: 0, fontSize: 15, halign: 'right' },
    columnStyles: { 0: { halign: 'right', fontStyle: 'bold' } },
  });
  table({ startY: Math.max(logo ? 56 : 15, doc.lastAutoTable.finalY + 4), tableWidth: 105, body: [[lines(header[0])]] });
  const vendor = root.querySelector('.section-title')?.parentElement;
  table({ startY: doc.lastAutoTable.finalY + 4, head: [['VENDOR DETAILS']], body: [[lines(vendor)]] });
  const cells = row => [...row.children].map(cell => cell.querySelector('p') ? lines(cell) : text(cell));
  table({ startY: doc.lastAutoTable.finalY + 5, theme: 'grid', rowPageBreak: 'avoid',
    head: [...root.querySelectorAll('.items-table thead tr')].map(cells),
    body: [...root.querySelectorAll('.items-table tbody tr')].map(cells),
    columnStyles: { 0: { cellWidth: 9 }, 1: { cellWidth: 48 }, 2: { cellWidth: 23 }, 3: { cellWidth: 13, halign: 'right' }, 4: { cellWidth: 17 }, 5: { cellWidth: 24, halign: 'right' }, 6: { cellWidth: 16, halign: 'right' }, 7: { cellWidth: 32, halign: 'right' } },
  });
  table({ startY: doc.lastAutoTable.finalY + 4,
    body: [...root.querySelectorAll('.total-row')].map(row => [...row.children].map(text)),
    columnStyles: { 0: { cellWidth: 125, halign: 'right' }, 1: { cellWidth: 57, halign: 'right', fontStyle: 'bold' } },
  });
  table({ startY: doc.lastAutoTable.finalY + 4, body: [[lines(root.querySelector('.bottom-grid > div'))]] });
  doc.setProperties({ title: text(source.querySelector('title')) || 'Purchase Invoice', author: 'Medyra Pharmaceutical' });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.text(`Purchase Invoice | ${page} / ${pages}`, 196, 289, { align: 'right' });
  }
  return doc;
}

module.exports = { buildPurchaseInvoicePdf };
