const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../models/Lead');
const Share = require('../models/ProformaShare');
const mailPath = require.resolve('../utils/poEmail');
const realMail = require(mailPath);
let sent;
require.cache[mailPath].exports = { getTransport: () => ({ user: 'sender@example.invalid', transporter: { sendMail: async mail => { sent = mail; return { accepted: [mail.to], rejected: [] }; } } }), emailError: () => 'Mail failed' };
const controller = require('../controllers/proformaShareController');
const originalLeadFind = Lead.findById, originalCreate = Share.create, originalFind = Share.findOne;
const id = '507f1f77bcf86cd799439011';
const lead = { _id: id, createdBy: 'owner', proformas: [{ number: 'PF-2026/001' }] };
Lead.findById = async () => lead;
let saved;
Share.create = async data => { saved = data; return data; };
Share.findOne = () => ({ select: async () => saved });
after(() => { Lead.findById = originalLeadFind; Share.create = originalCreate; Share.findOne = originalFind; require.cache[mailPath].exports = realMail; });
const pdf = Buffer.from('%PDF-1.4\nTest document');
async function call(handler, overrides = {}) {
  let status = 200, data, headers;
  await handler({ params: { id }, user: { role: 'admin', id }, body: { proformaNumber: 'PF-2026/001', to: 'client@example.invalid', cc: 'cc@example.invalid', subject: 'Proforma', message: 'Please review' }, file: { buffer: pdf }, ...overrides }, {
    status(code) { status = code; return this; }, json(value) { data = value; return this; }, set(value) { headers = value; return this; }, send(value) { data = value; return this; }
  });
  return { status, data, headers };
}
test('email attaches exact PDF bytes and preserves recipient/CC/message', async () => {
  const result = await call(controller.email);
  assert.equal(result.status, 200); assert.equal(sent.to, 'client@example.invalid'); assert.equal(sent.cc, 'cc@example.invalid');
  assert.equal(sent.text, 'Please review'); assert.deepEqual(sent.attachments[0].content, pdf);
});
test('share returns random token and serves identical PDF without authentication', async () => {
  const result = await call(controller.share);
  assert.equal(result.status, 201); assert.match(result.data.token, /^[A-Za-z0-9_-]{22}$/);
  const response = await call(controller.view, { params: { token: result.data.token }, user: null });
  assert.equal(response.headers['Content-Type'], 'application/pdf'); assert.deepEqual(response.data, pdf);
});
test('invalid PDF and invalid recipient cannot be sent', async () => {
  assert.equal((await call(controller.email, { file: { buffer: Buffer.from('not-pdf') } })).status, 400);
  assert.equal((await call(controller.email, { body: { proformaNumber: 'PF-2026/001', to: 'bad' } })).status, 400);
});
test('proforma must belong to selected client', async () => {
  assert.equal((await call(controller.share, { body: { proformaNumber: 'OTHER' } })).status, 404);
});
test('unassigned sales users cannot share another client document', async () => {
  assert.equal((await call(controller.share, { user: { id: 'stranger', role: 'telecaller' } })).status, 403);
  assert.equal((await call(controller.share, { user: { id: 'owner', role: 'telecaller' } })).status, 201);
});
test('public link requires full valid token', async () => {
  assert.equal((await call(controller.view, { params: { token: id } })).status, 404);
});

test('legacy long tokens still serve previously shared PDFs', async () => {
  await call(controller.share);
  saved.token = 'a'.repeat(64);
  const response = await call(controller.view, { params: { token: saved.token }, user: null });
  assert.equal(response.status, 200); assert.deepEqual(response.data, pdf);
});
