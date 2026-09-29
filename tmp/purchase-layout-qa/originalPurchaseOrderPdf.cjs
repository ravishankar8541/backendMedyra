const { jsPDF } = require('jspdf');
require('jspdf-autotable');

// Native PDF text and tables: no full-page screenshots or browser rendering delay.
function buildPurchaseOrderPdf(order, company, { formatDate, numberToWords, logo } = {}) {
  const doc = new jsPDF({ compress: true });
  const date = formatDate || (value => value ? new Date(value).toLocaleDateString('en-GB') : 'N/A');
  const currency = order.currency || 'INR';
  const num = value => Number(value) || 0;
  const money = value => num(value).toFixed(2);
  const items = order.items || [];
  const charges = [
    ['Freight / Shipping', order.freight],
    ['Insurance', order.insurance],
    ['Inventory / Handling', order.inventoryCharges],
  ].filter(([, charge]) => num(charge?.amount) > 0);
  const itemsBase = items.reduce((sum, item) => sum + num(item.quantity) * num(item.unitPrice || item.rate), 0);
  const subtotal = itemsBase > 0 ? itemsBase : num(order.subtotal);
  const beforeRound = subtotal + charges.reduce((sum, [, charge]) => sum + num(charge.amount), 0) + num(order.totalTax);
  const storedTotal = Number(order.total);
  const amount = Number.isFinite(storedTotal) && storedTotal > 0 ? storedTotal : beforeRound;
  const total = currency === 'INR' ? Math.round(amount) : Number(amount.toFixed(2));
  const roundOff = currency === 'INR' ? total - beforeRound : 0;
  doc.setProperties({ title: `Purchase Order ${order.poNumber || ''}`, author: company.name, subject: 'Purchase order' });

  if (logo) {
    doc.setFillColor(0, 0, 0);
    doc.rect(14, 12, 40, 40, 'F');
    doc.addImage(logo, 'PNG', 15, 13, 38, 38);
  }
  const table = options => doc.autoTable({
    margin: { left: 14, right: 14, top: 16, bottom: 16 },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.5, overflow: 'linebreak', textColor: [20, 30, 40] },
    headStyles: { fillColor: [1, 58, 89], textColor: 255 },
    theme: 'plain', ...options,
  });
  table({ startY: 12, margin: { left: 110, right: 14, top: 16, bottom: 16 }, tableWidth: 86,
    head: [['PURCHASE ORDER']],
    headStyles: { fillColor: false, textColor: [0, 0, 0], fontSize: 16, fontStyle: 'bold', halign: 'right' },
    body: [[`PO Number: ${order.poNumber || ''}\nDate: ${date(order.createdAt || order.date)}\nCurrency: ${currency}\nPurchaser: ${(order.purchaserName || company.contactPerson || '').trim()}`]],
    columnStyles: { 0: { halign: 'right', fontStyle: 'bold', fontSize: 10 } },
  });
  const companyTop = Math.max(logo ? 56 : 15, doc.lastAutoTable.finalY + 4);
  table({ startY: companyTop, body: [[
    `${company.name}\n${company.address}\nGSTIN: ${company.gstin}\nMobile: ${company.phone}\nEmail: ${company.email}`,
  ]], tableWidth: 105 });
  table({ startY: doc.lastAutoTable.finalY + 4, head: [['VENDOR DETAILS']], body: [[
    `${order.supplierName || order.supplier || ''}\n${order.supplierAddress || 'N/A'}\nGSTIN: ${order.supplierGST || 'N/A'}\nContact: ${order.supplierContact || 'N/A'}\nEmail: ${order.supplierEmail || 'N/A'}`,
  ]] });
  const rows = items.map((item, index) => [
    index + 1, `${item.productName || item.name || 'Product'}\nHSN: ${item.hsn || '3004.90.99'}`,
    num(item.quantity), item.unit || 'Strips', money(item.unitPrice || item.rate),
    `${num(item.taxRate)}%`, money(num(item.quantity) * num(item.unitPrice || item.rate)),
  ]);
  charges.forEach(([label, charge]) => rows.push([
    rows.length + 1, label, 1, '-', money(charge.amount), `${num(charge.taxRate ?? 18)}%`, money(charge.amount),
  ]));
  table({ startY: doc.lastAutoTable.finalY + 5, theme: 'grid',
    head: [['#', 'Item & description', 'Qty', 'Unit', `Rate (${currency})`, 'Tax', `Amount (${currency})`]],
    body: rows, rowPageBreak: 'avoid',
    columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 62 }, 2: { cellWidth: 15, halign: 'right' }, 3: { cellWidth: 18 }, 4: { cellWidth: 27, halign: 'right' }, 5: { cellWidth: 17, halign: 'right' }, 6: { cellWidth: 33, halign: 'right' } },
  });
  const totals = [['Sub total', money(subtotal)], ...charges.map(([label, charge]) => [label, money(charge.amount)]),
    [`Tax (${order.gstType === 'cgst_sgst' ? 'CGST + SGST' : 'IGST'})`, money(order.totalTax)],
    ...(currency === 'INR' ? [['Round off', money(roundOff)]] : []), [`TOTAL (${currency})`, money(total)]];
  table({ startY: doc.lastAutoTable.finalY + 5, body: totals,
    columnStyles: { 0: { cellWidth: 132, halign: 'right' }, 1: { cellWidth: 50, halign: 'right', fontStyle: 'bold' } },
  });
  table({ startY: doc.lastAutoTable.finalY + 4, body: [
    ...(numberToWords ? [[`Total in words: ${currency} ${numberToWords(currency === 'INR' ? Math.round(total) : Math.floor(total))} Only`]] : []),
    [`Expected delivery: ${date(order.expectedDate)}`],
    ...(order.notes && order.notes !== 'No notes' ? [[`Notes: ${order.notes}`]] : []),
  ] });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`${order.poNumber || 'Purchase order'} | ${page} / ${pages}`, 196, 289, { align: 'right' });
  }
  return doc;
}

module.exports = { buildPurchaseOrderPdf };
