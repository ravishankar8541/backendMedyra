const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const SalesReturn = require('../models/SalesReturn');
const mail = require('../utils/poEmail');
const controller = require('../controllers/salesReturnController');
const originalFind = SalesReturn.findById;
const originalFindOne = SalesReturn.findOne;
const originalTransport = mail.getTransport;
const id = '507f1f77bcf86cd799439011';
let sent, sends = 0, accepted = true;
const note = { _id: id, returnNumber: 'CN/TEST/001', invoiceNumber: 'INV/001', invoiceDate: '2026-09-01', placeOfSupply: 'Delhi',
  returnDate: '2026-09-29', status: 'posted', total: 118, subtotal: 100, totalTax: 18, items: [], reason: 'Test return',
  async save() {} };
SalesReturn.findById = () => Object.assign(Promise.resolve(note), { select: async () => note });
SalesReturn.findOne = async query => Object.entries(query).every(([key, value]) => note[key] === value) ? note : null;
mail.getTransport = () => ({ user: 'sender@example.invalid', transporter: { sendMail: async value => {
  sends++; sent = value; return { accepted: accepted ? [value.to] : [] };
} } });
after(() => { SalesReturn.findById = originalFind; SalesReturn.findOne = originalFindOne; mail.getTransport = originalTransport; });
async function call(handler, body = {}, params = { id }) {
  let status = 200, data, headers;
  await handler({ body, params }, {
    status(code) { status = code; return this; }, json(value) { data = value; return this; },
    set(value) { headers = value; return this; }, send(value) { data = value; return this; },
  });
  return { status, data, headers };
}
test('edited email fields reach the mailer with a generated PDF attachment', async () => {
  const result = await call(controller.email, { to: ' client@example.invalid ', subject: ' Revised credit note ', message: 'Dear Customer,\n\nPlease review this credit.' });
  assert.equal(result.status, 200);
  assert.equal(sent.to, 'client@example.invalid');
  assert.equal(sent.subject, 'Revised credit note');
  assert.equal(sent.text, 'Dear Customer,\n\nPlease review this credit.');
  assert.equal(sent.attachments[0].filename, 'CN_TEST_001.pdf');
  assert.equal(sent.attachments[0].content.subarray(0, 5).toString(), '%PDF-');
  assert.equal(sent.attachments[0].contentType, 'application/pdf');
});
test('legacy email requests keep default subject and message', async () => {
  assert.equal((await call(controller.email, { to: 'client@example.invalid' })).status, 200);
  assert.match(sent.subject, /Credit Note CN\/TEST\/001/);
  assert.match(sent.text, /invoice INV\/001/);
});
test('bad recipient and invalid custom content are rejected before sending', async () => {
  const before = sends;
  for (const body of [{ to: 'bad' }, { subject: {} }, { message: [] }, { subject: 'Header\r\nInjection' }, { subject: 'x'.repeat(201) }, { message: 'x'.repeat(10001) }]) {
    assert.equal((await call(controller.email, { to: 'client@example.invalid', ...body })).status, 400);
  }
  assert.equal(sends, before);
});
test('SMTP rejection is reported instead of success', async () => {
  accepted = false;
  try { assert.equal((await call(controller.email, { to: 'client@example.invalid' })).status, 502); }
  finally { accepted = true; }
});
test('WhatsApp sharing token serves a public PDF and is reused', async () => {
  const result = await call(controller.share);
  assert.equal(result.status, 200);
  assert.match(result.data.token, /^[A-Za-z0-9_-]{22}$/);
  assert.equal((await call(controller.share)).data.token, result.data.token);
  const response = await call(controller.sharedPdf, {}, { token: result.data.token });
  assert.equal(response.headers['Content-Type'], 'application/pdf');
  assert.equal(response.data.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await call(controller.sharedPdf, {}, { token: id })).status, 404);
});
test('existing credit notes get a short link without breaking previously shared links', async () => {
  const legacy = '9a5f9c2e-e73e-4ab3-9da2-d0bdaaedeedc6a6cee81-808b-47ca-a185-7a313845eedc';
  note.shareToken = legacy;
  delete note.shortShareToken;
  const result = await call(controller.share);
  assert.match(result.data.token, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(note.shareToken, legacy);
  for (const token of [legacy, result.data.token]) {
    const response = await call(controller.sharedPdf, {}, { token });
    assert.equal(response.status, 200);
    assert.equal(response.data.subarray(0, 5).toString(), '%PDF-');
  }
  assert.equal((await call(controller.sharedPdf, {}, { token: 'a'.repeat(22) })).status, 404);
});
test('cancelled notes cannot be emailed or newly shared', async () => {
  note.status = 'cancelled';
  const before = sends;
  try {
    assert.equal((await call(controller.email, { to: 'client@example.invalid' })).status, 400);
    assert.equal((await call(controller.share)).status, 400);
    assert.equal(sends, before);
  } finally { note.status = 'posted'; }
});
