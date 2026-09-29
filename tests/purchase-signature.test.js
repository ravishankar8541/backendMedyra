const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildPurchaseInvoicePdf } = require('../utils/purchaseInvoicePdf');
const { buildPurchaseOrderPdf } = require('../utils/purchaseOrderPdf');
const logo = require('../utils/documentLogo');

test('purchase invoice and order keep the signature below totals on short and multipage documents', () => {
  fs.mkdirSync('tmp/purchase-signature-qa', { recursive: true });
  for (const count of [1, 60]) {
    const items = Array.from({ length: count }, (_, i) => ({ productName: `Vitamin D3 ${i + 1}`, quantity: 10, unitPrice: 50, taxRate: 18, unit: 'Bottle' }));
    const company = { name: 'Medyra Pharmaceutical', address: 'Bawana Industrial Area, Delhi', gstin: '07BLQPR8835QZZR', phone: '9310879396', email: 'Pharmaceutical@medyra.in' };
    const html = `<title>PI-SIGNATURE-QA</title><div class="invoice-container"><table class="header-table"><tr><td><p>${company.name}</p><p>${company.address}</p></td><td><p>Invoice: PI-SIGNATURE-QA</p><p>Date: 29 Sept 2026</p></td></tr></table><div><div class="section-title">VENDOR DETAILS</div><p>QA Vendor</p></div><table class="items-table"><thead><tr>${['#','Item','Batch','Qty','Unit','Rate','Tax','Total'].map(t => `<th>${t}</th>`).join('')}</tr></thead><tbody>${items.map((item, i) => `<tr><td>${i + 1}</td><td>${item.productName}</td><td>BATCH-${i + 1}</td><td>10</td><td>Bottle</td><td>50.00</td><td>18%</td><td>500.00</td></tr>`).join('')}</tbody></table><div class="total-row"><span>Total</span><span>${count * 590}.00</span></div><div class="bottom-grid"><div><p>Notes: Preserve purchase data.</p></div></div></div>`;
    const docs = {
      invoice: buildPurchaseInvoicePdf(html, { currency: 'INR', logo }),
      order: buildPurchaseOrderPdf({ poNumber: 'PO-SIGNATURE-QA', items, total: count * 590, totalTax: count * 90, currency: 'INR', supplierName: 'QA Vendor', notes: 'Preserve purchase data.' }, company, { logo }),
    };
    for (const [name, doc] of Object.entries(docs)) {
      assert.ok(Object.values(doc.internal.collections.addImage_images).some(image => image.alias === 'authorised-signature'));
      const pages = doc.internal.pages.slice(1).map(page => page.join('\n'));
      assert.equal(pages.filter(page => page.includes('(Authorized Signature)')).length, 1);
      assert.ok(pages.at(-1).includes('(Authorized Signature)'));
      if (count === 60) assert.ok(doc.getNumberOfPages() > 1);
      fs.writeFileSync(`tmp/purchase-signature-qa/${name}-${count}.pdf`, Buffer.from(doc.output('arraybuffer')));
    }
  }
});
