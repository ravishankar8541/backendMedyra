const { jsPDF } = require('jspdf');
require('jspdf-autotable');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const logo = require('./documentLogo');
const creditNoteGroups = require('./creditNoteGroups');

// Default company block for credit notes (Sales Returns only).
const DEFAULT_COMPANY = {
  name: 'Medyra Pharmaceutical',
  address: 'Plot No 169, Pocket-O, Sec-1, DSIDC Bawana Industrial Complex, Delhi 110039 India',
  gstin: '07BLQPR8835Q22R',
  drugLicense: '20B/WLF21B2026DL000685, 21/8WLF21B2026DL000681, 20B/DL-BAS-149270, 21B/DL-BAS-149271',
  email: 'Pharmaceutical@medyra.in',
  phone: '9310879396',
};

let signatureDataUrl;
const getSignature = () => {
  if (signatureDataUrl) return signatureDataUrl;
  const file = path.join(__dirname, '../assets/medyraSignature.png');
  signatureDataUrl = 'data:image/png;base64,' + readFileSync(file).toString('base64');
  return signatureDataUrl;
};

const date = value => {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10).split('-').reverse().join('/');
};
const small = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const words = n => {
  if (n < 20) return small[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + words(n % 10) : '');
  for (const [size, label] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand'], [100, 'Hundred']]) {
    if (n >= size) return words(Math.floor(n / size)) + ' ' + label + (n % size ? ' ' + words(n % size) : '');
  }
};
const amountWords = (value, currency) => {
  const cents = Math.round(Math.abs(Number(value || 0)) * 100);
  return `${value < 0 ? 'Minus ' : ''}${currency === 'INR' ? 'Indian Rupee' : currency} ${words(Math.floor(cents / 100))}${cents % 100 ? ` and ${words(cents % 100)} ${currency === 'INR' ? 'Paise' : 'Hundredths'}` : ''} Only`;
};

// Download, print, public share and email all use the same saved credit-note values.
module.exports = note => {
  const pdf = new jsPDF({ compress: true });
  const currency = note.currency || 'INR';
  const number = value => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = value => `${currency === 'INR' ? 'Rs.' : currency + ' '}${number(value)}`;
  const grey = [155, 155, 155];
  const company = Object.fromEntries(Object.entries(DEFAULT_COMPANY).map(([key, fallback]) => [key, note.company?.[key] || fallback]));
  company.drugLicense = note.company?.drugLicenses?.filter(Boolean).join(', ') || company.drugLicense;
  const table = options => pdf.autoTable({
    theme: 'grid', margin: { left: 14, right: 14, top: 18, bottom: 18 },
    styles: { fontSize: 8.5, cellPadding: 1.5, textColor: 20, lineColor: grey, lineWidth: 0.2, overflow: 'linebreak' },
    headStyles: { fillColor: [243, 243, 243], textColor: 15, fontStyle: 'bold', valign: 'bottom' },
    ...options,
  });
  pdf.setFillColor(0); pdf.rect(16, 20, 39, 39, 'F');
  pdf.addImage(logo, 'PNG', 17, 21, 37, 37, 'company-logo', 'FAST');
  pdf.setTextColor(20); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12);
  const name = pdf.splitTextToSize(company.name, 128);
  pdf.text(name, 60, 26);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5);
  const header = pdf.splitTextToSize([
    company.address, `GSTIN: ${company.gstin}`, `Drug License: ${company.drugLicense}`,
    `Mobile No: ${company.phone}`, `Email ID: ${company.email}`,
    note.company?.contactPerson ? `Contact Person: ${note.company.contactPerson}` : '',
  ].filter(Boolean).join('\n'), 88);
  const headerY = 27 + name.length * 5;
  pdf.text(header, 60, headerY);
  const top = Math.max(61, headerY + header.length * 3.45 + 4);
  pdf.setFontSize(23); pdf.text('Credit Note', 194, top - 3, { align: 'right' });
  const customer = note.customer || {};
  const supply = note.placeOfSupply || [customer.state, customer.stateCode ? `(${customer.stateCode})` : ''].filter(Boolean).join(' ') || '-';
  table({ startY: top, rowPageBreak: 'avoid', body: [[
    `Credit Note     : ${note.returnNumber || '-'}\nCredit Date     : ${date(note.returnDate)}\nInvoice#         : ${note.invoiceNumber || '-'}\nInvoice Date   : ${date(note.invoiceDate)}`,
    `Place Of Supply : ${supply}${note.status === 'cancelled' ? '\nStatus: CANCELLED' : ''}`,
  ]], columnStyles: { 0: { cellWidth: 91 }, 1: { cellWidth: 91 } } });
  table({ startY: pdf.lastAutoTable.finalY, head: [['Bill To']], body: [[
    [customer.name, customer.address, `GSTIN: ${customer.gst || 'N/A'}`].filter(Boolean).join('\n'),
  ]], rowPageBreak: 'avoid' });
  // Match Tax Invoice: one product row with aligned batch details inside it.
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5);
  const itemRows = creditNoteGroups(note.items).map((item, index) => {
    const columns = [[], [], []];
    for (const batch of item.batches) {
      const values = [batch.batchNumber, `${batch.quantity}\n${item.unit || ''}`, date(batch.expiryDate)];
      const wrapped = values.map((value, column) => pdf.splitTextToSize(value, [21, 15, 24][column]));
      const height = Math.max(...wrapped.map(lines => lines.length));
      wrapped.forEach((lines, column) => columns[column].push(...lines, ...Array(height - lines.length).fill('')));
    }
    return [index + 1, `${item.productName || '-'}\nHSN: ${item.hsn || '-'}${item.restock === false ? '\nNot added to saleable stock' : ''}`,
      ...columns.map(lines => lines.join('\n')), `${item.quantity}\n${item.unit || ''}`, number(item.unitPrice), number(item.subtotal)];
  });
  table({ startY: pdf.lastAutoTable.finalY, rowPageBreak: 'avoid',
    head: [['S.\nno', 'Item & Description', 'Manufacturer\nBatch#', 'Batch Qty', 'Expiry Date', 'Qty', 'Rate', 'Amount']],
    body: itemRows,
    columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 46 }, 2: { cellWidth: 24 }, 3: { cellWidth: 18, halign: 'right' }, 4: { cellWidth: 27 }, 5: { cellWidth: 17, halign: 'right' }, 6: { cellWidth: 18, halign: 'right' }, 7: { cellWidth: 24, halign: 'right' } },
  });
  const taxGroups = new Map();
  for (const item of note.items || []) {
    const rate = Number(item.taxRate || 0);
    taxGroups.set(rate, (taxGroups.get(rate) || 0) + Number(item.tax ?? (Number(item.total || 0) - Number(item.subtotal ?? Number(item.quantity || 0) * Number(item.unitPrice || 0)))));
  }
  const totals = [['Sub Total', number(note.subtotal)]];
  // Only show a tax breakdown when it reconciles with the saved tax total.
  const taxSum = [...taxGroups.values()].reduce((sum, value) => sum + value, 0);
  if (taxGroups.size && Math.abs(taxSum - Number(note.totalTax || 0)) < 0.01) {
    for (const [rate, tax] of taxGroups) {
      if (note.taxType === 'cgst_sgst') totals.push([`CGST (${rate / 2}%)`, number(tax / 2)], [`SGST (${rate / 2}%)`, number(tax / 2)]);
      else totals.push([`${note.taxType === 'igst' ? 'IGST' : 'GST'} (${rate}%)`, number(tax)]);
    }
  } else totals.push(['GST reversal', number(note.totalTax)]);
  totals.push(['Rounding', number(note.roundOff)], ['Total', money(note.total), true]);
  if (note.status !== 'cancelled') {
    totals.push(['Credits Used', `(-) ${number(note.replacementCredit)}`, false, true],
      ['Credits Remaining', money(Number(note.total || 0) - Number(note.replacementCredit || 0)), true]);
  }
  let details = `Total In Words\n${amountWords(note.total, currency)}\n\nReturn reason\n${note.reason || '-'}${note.status === 'cancelled' ? '\n\nCancellation reason\n' + (note.cancellationReason || '-') : ''}`;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5);
  if (pdf.splitTextToSize(details, 97).length > 38) {
    table({ startY: pdf.lastAutoTable.finalY, body: [[details]] });
    details = '';
  }
  const totalRows = totals.map(([label, value, bold, red]) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    const labels = pdf.splitTextToSize(label, 39), values = pdf.splitTextToSize(value, 33);
    return { labels, values, bold, red, height: Math.max(labels.length, values.length) * 3.5 + 1.2 };
  });
  const totalsHeight = totalRows.reduce((sum, row) => sum + row.height, 4);
  const signatureHeight = 30;
  const signature = getSignature();
  table({ startY: pdf.lastAutoTable.finalY, rowPageBreak: 'avoid', body: [[details, '']],
    columnStyles: { 0: { cellWidth: 103, cellPadding: 2 }, 1: { cellWidth: 79, minCellHeight: totalsHeight + signatureHeight } },
    didDrawCell: data => {
      if (data.section !== 'body' || data.column.index !== 1) return;
      const { x, y, width, height } = data.cell;
      let cursor = y + 4;
      for (const row of totalRows) {
        pdf.setFontSize(8.5); pdf.setFont('helvetica', row.bold ? 'bold' : 'normal'); pdf.setTextColor(20);
        pdf.text(row.labels, x + 45, cursor, { align: 'right' });
        if (row.red) pdf.setTextColor(220, 30, 30);
        pdf.text(row.values, x + width - 2, cursor, { align: 'right' });
        cursor += row.height;
      }
      const signatureTop = y + height - signatureHeight;
      pdf.setDrawColor(...grey); pdf.line(x, signatureTop, x + width, signatureTop);
      const image = pdf.getImageProperties(signature);
      const scale = Math.min(52 / image.width, 22 / image.height);
      const w = image.width * scale, h = image.height * scale;
      pdf.addImage(signature, 'PNG', x + (width - w) / 2, signatureTop + 1, w, h, 'authorised-signature', 'FAST');
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(20);
      pdf.text('Authorized Signature', x + width / 2, y + height - 2, { align: 'center' });
    },
  });
  pdf.setProperties({ title: `Credit Note ${note.returnNumber}`, author: company.name });
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setDrawColor(...grey); pdf.setLineWidth(0.2); pdf.rect(14, 18, 182, 261);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(100);
    pdf.text(`${note.returnNumber} | Page ${page} of ${pages}`, 196, 284, { align: 'right' });
  }
  return Buffer.from(pdf.output('arraybuffer'));
};
