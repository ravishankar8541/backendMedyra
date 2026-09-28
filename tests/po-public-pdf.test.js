const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PurchaseOrder = require('../models/PurchaseOrder');
const { getPublicPOView } = require('../controllers/purchaseOrderController');

test('WhatsApp public PO returns the canonical PDF with embedded logo', async () => {
  const original = PurchaseOrder.findById;
  let status = 200, body;
  const headers = {};
  const res = { set(key, value) { headers[key] = value; return this; }, status(code) { status = code; return this; }, send(value) { body = value; return this; } };
  try {
    PurchaseOrder.findById = async () => ({ poNumber: 'PO-2026/001', supplierName: 'QA Vendor', currency: 'INR', date: '2026-09-28', expectedDate: '2026-10-01', subtotal: 500, totalTax: 90, total: 590, items: [{ productName: 'Vitamin D3', quantity: 10, unitPrice: 50, taxRate: 18, unit: 'Bottle' }] });
    await getPublicPOView({ params: { id: '507f1f77bcf86cd799439011' } }, res);
    assert.equal(status, 200);
    assert.equal(headers['Content-Type'], 'application/pdf');
    assert.match(headers['Content-Disposition'], /^inline;/);
    assert.equal(body.subarray(0, 5).toString(), '%PDF-');
    assert.match(body.toString('latin1'), /\/Subtype \/Image/);
    fs.mkdirSync('tmp/po-pdf-qa', { recursive: true });
    fs.writeFileSync('tmp/po-pdf-qa/public-po.pdf', body);
    PurchaseOrder.findById = async () => null;
    await getPublicPOView({ params: { id: '507f1f77bcf86cd799439011' } }, res);
    assert.equal(status, 404);
    await getPublicPOView({ params: { id: 'invalid' } }, res);
    assert.equal(status, 400);
  } finally { PurchaseOrder.findById = original; }
});
