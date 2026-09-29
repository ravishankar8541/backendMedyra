const { jsPDF } = require('jspdf');
require('jspdf-autotable');
const logo = require('./documentLogo');

// All delivery paths use this renderer; document values remain the saved credit note's values.
module.exports = note => {
  const pdf = new jsPDF({ compress: true });
  const money = value => `${note.currency || 'INR'} ${Number(value || 0).toFixed(2)}`;
  const grey = [155, 155, 155];
  const table = options => pdf.autoTable({
    theme: 'grid', margin: { left: 14, right: 14, top: 18, bottom: 18 },
    styles: { fontSize: 8.5, cellPadding: 2, textColor: 20, lineColor: grey, lineWidth: 0.2, overflow: 'linebreak' },
    headStyles: { fillColor: [243, 243, 243], textColor: 15, fontStyle: 'bold' },
    ...options,
  });
  pdf.setFillColor(0); pdf.rect(16, 20, 38, 38, 'F');
  pdf.addImage(logo, 'PNG', 17, 21, 36, 36);
  pdf.setTextColor(20); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12);
  const name = pdf.splitTextToSize(note.company?.name || 'Medyra Pharmaceutical', 78);
  pdf.text(name, 59, 25);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5);
  const address = pdf.splitTextToSize(note.company?.address || '', 78);
  const addressY = 26 + name.length * 5;
  pdf.text(address, 59, addressY);
  const top = Math.max(62, addressY + address.length * 3.5 + 5);
  pdf.setFontSize(16); pdf.text('Credit Note', 193, 25, { align: 'right' });
  table({ startY: top, rowPageBreak: 'avoid', body: [
    [`Credit Note: ${note.returnNumber}\nDate: ${note.returnDate}`, `Original Sales Invoice: ${note.invoiceNumber}\nStatus: ${note.status.toUpperCase()}`],
    [`Customer\n${note.customer?.name || ''}\n${note.customer?.address || ''}\nGST: ${note.customer?.gst || 'N/A'}`, `Company GST: ${note.company?.gstin || 'N/A'}`]
  ], columnStyles: { 0: { cellWidth: 91 }, 1: { cellWidth: 91 } } });
  table({ startY: pdf.lastAutoTable.finalY, rowPageBreak: 'avoid',
    head: [['Product / HSN', 'Batch', 'Return qty', 'Rate', 'GST %', 'Credit']],
    body: note.items.map(i => [`${i.productName}\nHSN: ${i.hsn || '-'}${i.restock ? '' : '\nNot added to saleable stock'}`, i.batchNumber || '-', `${i.quantity} ${i.unit}`, Number(i.unitPrice).toFixed(2), `${i.taxRate}%`, Number(i.total).toFixed(2)]),
    columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: 25 }, 2: { cellWidth: 24 }, 3: { cellWidth: 25, halign: 'right' }, 4: { cellWidth: 18 }, 5: { cellWidth: 28, halign: 'right' } },
  });
  const totals = [['Subtotal', money(note.subtotal)], ['GST reversal', money(note.totalTax)], ['Round off', money(note.roundOff)], ['TOTAL CREDIT', money(note.total)]];
  const reason = `Return reason\n${note.reason}${note.status === 'cancelled' ? '\n\nCancellation reason\n' + (note.cancellationReason || '') : ''}`;
  // Flow long reasons independently so totals are never drawn over a split row.
  pdf.setFontSize(8.5);
  const longReason = pdf.splitTextToSize(reason, 94).length > 40;
  if (longReason) table({ startY: pdf.lastAutoTable.finalY, body: [[reason]] });
  const totalRows = totals.map(([label, value]) => ({ label, values: pdf.splitTextToSize(value, 38) }));
  const totalsHeight = totalRows.reduce((height, row) => height + row.values.length * 3.7 + 3, 6);
  table({ startY: pdf.lastAutoTable.finalY, rowPageBreak: 'avoid', body: [[longReason ? '' : reason, '']],
    columnStyles: { 0: { cellWidth: 100, cellPadding: 3 }, 1: { cellWidth: 82, minCellHeight: totalsHeight } },
    didDrawCell: data => {
      if (data.section !== 'body' || data.column.index !== 1) return;
      const { x, y, width } = data.cell;
      let cursor = y + 5;
      totalRows.forEach((row, index) => {
        pdf.setTextColor(20); pdf.setFontSize(8.5); pdf.setFont('helvetica', index === 3 ? 'bold' : 'normal');
        pdf.text(row.label, x + 3, cursor);
        pdf.text(row.values, x + width - 3, cursor, { align: 'right' });
        cursor += row.values.length * 3.7 + 3;
      });
    },
  });
  pdf.setProperties({ title: `Credit Note ${note.returnNumber}`, author: note.company?.name || 'Medyra Pharmaceutical' });
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i); pdf.setDrawColor(...grey); pdf.setLineWidth(0.2); pdf.rect(14, 18, 182, 261);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(100);
    pdf.text('Credit adjusts the customer account. This document is not a cash refund receipt.', 14, 284);
    pdf.text(`${note.returnNumber} | Page ${i} of ${pages}`, 14, 289);
  }
  return Buffer.from(pdf.output('arraybuffer'));
};
