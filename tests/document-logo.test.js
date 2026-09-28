const { test } = require('node:test');
const assert = require('node:assert/strict');
const PurchaseReturn = require('../models/PurchaseReturn');
const { ConsolidatedInvoice } = require('../models/GoodsReceipt');
const logo = require('../utils/documentLogo');
const { getPublicDebitNoteView } = require('../controllers/purchaseReturnController');
const { getPublicInvoiceView } = require('../controllers/goodsReceiptController');

test('shared purchase invoices and debit notes embed the bundled PNG', async () => {
  const fixture = { returnNumber: 'PR-QA-1', invoiceNumber: 'PI-QA-1', supplierName: 'QA Vendor', items: [], currency: 'INR', total: 0, returnDate: '2026-09-28' };
  const originalReturn = PurchaseReturn.findById;
  const originalInvoice = ConsolidatedInvoice.findById;
  PurchaseReturn.findById = async () => fixture;
  ConsolidatedInvoice.findById = async () => fixture;
  try {
    for (const handler of [getPublicDebitNoteView, getPublicInvoiceView]) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, setHeader() {}, send(html) { this.html = html; return this; } };
      await handler({ params: { id: '507f1f77bcf86cd799439011' } }, res);
      assert.equal(res.statusCode, 200);
      assert.ok(res.html.includes(`src="${logo}"`));
      assert.ok(!res.html.includes('medyra-frontend-new-cwlc.vercel.app'));
    }
    assert.equal(Buffer.from(logo.split(',')[1], 'base64').subarray(1, 4).toString(), 'PNG');
  } finally {
    PurchaseReturn.findById = originalReturn;
    ConsolidatedInvoice.findById = originalInvoice;
  }
});
