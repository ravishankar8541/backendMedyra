const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const PurchaseInvoiceShare = require('../models/PurchaseInvoiceShare');
const controller = require('../controllers/purchaseInvoiceShareController');

const originalCreate = PurchaseInvoiceShare.create;
const originalFindOne = PurchaseInvoiceShare.findOne;
after(() => {
  PurchaseInvoiceShare.create = originalCreate;
  PurchaseInvoiceShare.findOne = originalFindOne;
});

function response() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(headers) { Object.assign(this.headers, headers); return this; },
    send(body) { this.body = body; return this; }
  };
}

test('creates a private token for a valid purchase invoice PDF', async () => {
  let stored;
  PurchaseInvoiceShare.create = async document => { stored = document; return document; };
  const res = response();

  await controller.create({
    body: { invoiceNumber: ' PI/2026/001 ' },
    file: { buffer: Buffer.from('%PDF-1.4\nexample') },
    user: { _id: '507f1f77bcf86cd799439011' }
  }, res);

  assert.equal(res.statusCode, 201);
  assert.match(res.body.token, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(stored.invoiceNumber, 'PI/2026/001');
  assert.equal(stored.createdBy, '507f1f77bcf86cd799439011');
});

test('serves a token document inline as a non-cacheable PDF', async () => {
  const token = 'A'.repeat(22);
  const pdf = Buffer.from('%PDF-1.4\nexample');
  PurchaseInvoiceShare.findOne = query => ({
    select: async projection => {
      assert.deepEqual(query, { token });
      assert.equal(projection, '+pdf');
      return { invoiceNumber: 'PI/2026/001', pdf };
    }
  });
  const res = response();

  await controller.view({ params: { token } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.match(res.headers['Content-Disposition'], /^inline; filename="PI_2026_001\.pdf"$/);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(res.body, pdf);
});

test('rejects malformed public document tokens', async () => {
  const res = response();

  await controller.view({ params: { token: 'too-short' } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
});
