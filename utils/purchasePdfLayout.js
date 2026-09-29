const { readFileSync } = require('node:fs');
const path = require('node:path');
let signatureData;
const getSignature = () => signatureData || (signatureData = 'data:image/png;base64,' + readFileSync(path.join(__dirname, '../assets/medyraSignature.png')).toString('base64'));

// Presentation only. Callers supply the original document's displayed values.
const grey = [155, 155, 155];
function purchasePdfLayout(doc) {
  const table = options => doc.autoTable({
    theme: 'grid', margin: { left: 14, right: 14, top: 18, bottom: 18 },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2, textColor: 20, lineColor: grey, lineWidth: 0.2, overflow: 'linebreak' },
    headStyles: { fillColor: [243, 243, 243], textColor: 15, fontStyle: 'bold' },
    ...options,
  });
  const header = (title, company, logo) => {
    if (logo) {
      doc.setFillColor(0); doc.rect(16, 20, 38, 38, 'F');
      doc.addImage(logo, 'PNG', 17, 21, 36, 36, 'company-logo', 'FAST');
    }
    const companyLines = String(company).split('\n');
    table({ startY: 20, tableWidth: 84, margin: { left: 57, right: 69, top: 18, bottom: 18 }, theme: 'plain',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2, textColor: 20, lineWidth: 0, overflow: 'linebreak' },
      body: [[{ content: companyLines[0], styles: { fontStyle: 'bold', fontSize: 11 } }], [companyLines.slice(1).join('\n')]],
    });
    const end = Math.max(62, doc.lastAutoTable.finalY + 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(15); doc.setTextColor(20);
    doc.text(doc.splitTextToSize(title, 49), 193, 26, { align: 'right' });
    return end;
  };
  const summary = (details, values) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const rows = values.map(([label, value]) => {
      const labelLines = doc.splitTextToSize(String(label), 43);
      const valueLines = doc.splitTextToSize(String(value), 30);
      return { labelLines, valueLines, bold: /^(total\b|dues\b|balance\b)/i.test(label), height: Math.max(labelLines.length, valueLines.length) * 3.7 + 2.2 };
    });
    const signature = getSignature();
    const signatureHeight = 43;
    const height = rows.reduce((sum, row) => sum + row.height, 0) + 6 + signatureHeight;
    if (doc.splitTextToSize(details, 94).length > 40) {
      table({ startY: doc.lastAutoTable.finalY, body: [[details]] });
      details = '';
    }
    table({ startY: doc.lastAutoTable.finalY, rowPageBreak: 'avoid', body: [[details, '']],
      columnStyles: { 0: { cellWidth: 100, cellPadding: 3, fontSize: 8 }, 1: { cellWidth: 82, minCellHeight: height } },
      didDrawCell: data => {
        if (data.section !== 'body' || data.column.index !== 1) return;
        const { x, y, width } = data.cell;
        let cursor = y + 5;
        rows.forEach(row => {
          doc.setTextColor(20); doc.setFontSize(8.5); doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
          doc.text(row.labelLines, x + 3, cursor);
          doc.text(row.valueLines, x + width - 3, cursor, { align: 'right' });
          cursor += row.height;
        });
        const signatureTop = y + data.cell.height - signatureHeight;
        doc.setDrawColor(...grey); doc.line(x, signatureTop, x + width, signatureTop);
        const image = doc.getImageProperties(signature);
        const scale = Math.min(60 / image.width, 31 / image.height);
        const w = image.width * scale, h = image.height * scale;
        doc.addImage(signature, 'PNG', x + (width - w) / 2, signatureTop + 3 + (31 - h) / 2, w, h, 'authorised-signature', 'FAST');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(20);
        doc.text('Authorized Signature', x + width / 2, y + data.cell.height - 3, { align: 'center' });
      },
    });
  };
  const footer = (title, reference = title) => {
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      doc.setPage(page); doc.setDrawColor(...grey); doc.setLineWidth(0.2); doc.rect(14, 18, 182, 261);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100);
      doc.text(`${reference} | Page ${page} of ${pages}`, 14, 286);
      doc.text(title, 196, 286, { align: 'right' });
    }
  };
  return { table, header, summary, footer };
}
module.exports = { purchasePdfLayout };
