const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { jsPDF } = require('jspdf');
require('jspdf-autotable');
const { buildPurchaseInvoicePdf } = require('../utils/purchaseInvoicePdf');
const logo = require('../utils/documentLogo');
function html(items) {
 return `<title>Purchase Invoice QA</title><div class="invoice-container"><table class="header-table"><tr><td><p>Medyra Pharmaceutical</p><p>Bawana Industrial Area, Delhi</p><p>GSTIN: 07BLQPR8835QZZR</p></td><td><p>Invoice: PI-2026/003</p><p>PO: PO-2026/003</p></td></tr></table><div><div class="section-title">Vendor</div><p>HealthPlus Labs Pvt. Ltd.</p></div><table class="items-table"><tbody>${items.map((item, i) => `<tr><td>${i+1}</td><td><p>${item.productName}</p><p>HSN: 30049099</p></td><td>${item.batchNumber}</td><td>${item.acceptedQty}</td><td>Strip</td><td>${item.unitPrice.toFixed(2)}</td><td>0%</td><td>${(item.acceptedQty*item.unitPrice).toFixed(2)}</td></tr>`).join('')}</tbody></table><div class="total-row"><span>Total</span><span>INR ${items.reduce((sum,i)=>sum+i.acceptedQty*i.unitPrice,0).toFixed(2)}</span></div><div class="bottom-grid"><div><p>Currency: INR</p></div></div></div>`;
}
test('purchase PDF groups batch quantities while preserving rates, dates, totals and signature', () => {
 const items = [
  { productId: 'p1', purchaseOrderItemId: 'line1', productName: 'Cetirizine 10mg Tablets', acceptedQty: 3, unitPrice: 50, batchNumber: 'C-2026-01', mfgDate: '2026-09-29', expDate: '2027-09-29' },
  { productId: 'p1', purchaseOrderItemId: 'line1', productName: 'Cetirizine 10mg Tablets', acceptedQty: 2, unitPrice: 50, batchNumber: 'C-2026-02', mfgDate: '2026-09-30', expDate: '2027-09-30' },
 ];
 const original = jsPDF.API.autoTable;
 let table;
 jsPDF.API.autoTable = function(options) { if (options.head?.[0]?.includes('Batch Qty')) table = options; return original.call(this, options); };
 fs.mkdirSync('tmp/purchase-batch-qa', { recursive: true });
 try {
  const pdf = buildPurchaseInvoicePdf(html(items), { currency: 'INR', logo, items });
  assert.equal(table.body.length, 1);
  assert.equal(table.body[0][6], '5');
  assert.equal(table.body[0][10], '250.00');
  assert.match(table.body[0][2], /C-2026-01[\s\S]*C-2026-02/);
  assert.deepEqual(table.body[0][3].split('\n').filter(Boolean), ['3','2']);
  assert.ok(Object.values(pdf.internal.collections.addImage_images).some(image=>image.alias==='authorised-signature'));
  fs.writeFileSync('tmp/purchase-batch-qa/grouped.pdf', Buffer.from(pdf.output('arraybuffer')));
  const different = [...items, { ...items[1], unitPrice: 55 }];
  buildPurchaseInvoicePdf(html(different), { currency: 'INR', items: different });
  assert.equal(table.body.length, 2);
  assert.equal(table.body[1][10], '110.00');
  const many = Array.from({ length: 65 }, (_,i)=>({ ...items[i%2], batchNumber: `BATCH-${i+1}`, acceptedQty: 1 }));
  const long = buildPurchaseInvoicePdf(html(many), { currency: 'INR', logo, items: many });
  assert.equal(table.body[0][6], '65');
  assert.ok(long.getNumberOfPages()>1);
  fs.writeFileSync('tmp/purchase-batch-qa/grouped-long.pdf', Buffer.from(long.output('arraybuffer')));
 } finally { jsPDF.API.autoTable = original; }
});
