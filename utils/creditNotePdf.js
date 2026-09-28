const { jsPDF } = require('jspdf');
require('jspdf-autotable');
const logo = require('./documentLogo');
module.exports = note => {
  const pdf = new jsPDF();
  const money = value => `${note.currency || 'INR'} ${Number(value || 0).toFixed(2)}`;
  pdf.setFillColor(1, 42, 64);
  pdf.roundedRect(11, 9, 46, 30, 2, 2, 'F');
  pdf.addImage(logo, 'PNG', 14, 12, 40, 25);
  pdf.setTextColor(1, 58, 89); pdf.setFontSize(22);
  pdf.text('CREDIT NOTE', 196, 21, { align: 'right' });
  pdf.setFontSize(10); pdf.text(note.returnNumber, 196, 28, { align: 'right' });
  pdf.text(`Date: ${note.returnDate}`, 196, 34, { align: 'right' });
  pdf.setFontSize(12); pdf.text(note.company?.name || 'Medyra Pharmaceutical', 14, 44);
  pdf.setFontSize(9); pdf.setTextColor(65, 80, 95);
  const companyAddress = pdf.splitTextToSize(note.company?.address || '', 180);
  pdf.text(companyAddress, 14, 50);
  const top = Math.max(59, 54 + companyAddress.length * 4);
  pdf.autoTable({ startY: top, theme: 'plain', body: [
    ['CUSTOMER', 'ORIGINAL SALES INVOICE'],
    [note.customer?.name || '', note.invoiceNumber],
    [note.customer?.address || '', `Status: ${note.status.toUpperCase()}`],
    [`GST: ${note.customer?.gst || 'N/A'}`, `Company GST: ${note.company?.gstin || 'N/A'}`]
  ], styles: { fontSize: 9, cellPadding: 2 }, columnStyles: { 0: { cellWidth: 100 } } });
  pdf.autoTable({ startY: pdf.lastAutoTable.finalY + 6,
    head: [['Product / HSN', 'Batch', 'Return qty', 'Rate', 'GST %', 'Credit']],
    body: note.items.map(i => [`${i.productName}\nHSN: ${i.hsn || '-'}${i.restock ? '' : '\nNot added to saleable stock'}`, i.batchNumber || '-', `${i.quantity} ${i.unit}`, Number(i.unitPrice).toFixed(2), `${i.taxRate}%`, Number(i.total).toFixed(2)]),
    theme: 'grid', styles: { fontSize: 9, cellPadding: 3, lineColor: [221, 230, 235] },
    headStyles: { fillColor: [1, 58, 89] }, columnStyles: { 0: { cellWidth: 62 }, 3: { halign: 'right' }, 5: { halign: 'right' } }, margin: { bottom: 20 }
  });
  pdf.autoTable({ startY: pdf.lastAutoTable.finalY + 5, theme: 'plain', body: [
    ['Subtotal', money(note.subtotal)], ['GST reversal', money(note.totalTax)],
    ['Round off', money(note.roundOff)], ['TOTAL CREDIT', money(note.total)],
    ['Return reason', note.reason], ...(note.status === 'cancelled' ? [['Cancellation reason', note.cancellationReason || '']] : [])
  ], styles: { fontSize: 10, cellPadding: 3 }, columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold' } }, margin: { bottom: 23 } });
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(100);
    pdf.text('Credit adjusts the customer account. This document is not a cash refund receipt.', 14, 282);
    pdf.text(`${note.returnNumber} | Page ${i} of ${pages}`, 14, 288);
  }
  return Buffer.from(pdf.output('arraybuffer'));
};
