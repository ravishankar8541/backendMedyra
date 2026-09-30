const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Package = require('../models/Package');
const Share = require('../models/PackageShare');
const mail = require('../utils/poEmail');
const controller = require('../controllers/packageShareController');
const originals = [Package.findById, Share.create, Share.findOne, mail.getTransport];
const id = '507f1f77bcf86cd799439011';
let saved, sent, accepted = true;
Package.findById = async () => ({ _id: id, orderId: 'MP/001' });
Share.create = async data => (saved = data);
Share.findOne = query => ({ select: async () => query.token === saved?.token ? saved : null });
mail.getTransport = () => ({ user: 'sender@example.invalid', transporter: { sendMail: async data => { sent = data; return { accepted: accepted ? [data.to] : [] }; } } });
after(() => { [Package.findById, Share.create, Share.findOne, mail.getTransport] = originals; });
async function call(handler, overrides = {}) {
  let status = 200, data, headers;
  await handler({ params: { id }, user: { role: 'sales', permissions: ['packaging:view','packaging:create','packaging:edit','packaging:delete','packaging:share','delivery:view','delivery:edit'], id }, body: { to: 'qa@example.invalid', subject: 'Packing List', message: 'Review this list.' }, file: { buffer: Buffer.from('%PDF-test') }, ...overrides }, {
    status(value) { status = value; return this; }, json(value) { data = value; }, set(value) { headers = value; return this; }, send(value) { data = value; },
  });
  return { status, data, headers };
}
test('email attaches packing list PDF with custom message', async () => {
  assert.equal((await call(controller.email)).status, 200);
  assert.equal(sent.subject, 'Packing List');
  assert.equal(sent.text, 'Review this list.');
  assert.equal(sent.attachments[0].filename, 'Packing_List_MP_001.pdf');
  assert.equal(sent.attachments[0].content.toString(), '%PDF-test');
});
test('invalid recipient, header injection, unauthorized role and missing PDF are rejected', async () => {
  for (const overrides of [{ body: { to: 'bad' } }, { body: { to: 'qa@example.invalid', subject: 'bad\r\nheader' } }, { file: null }]) assert.equal((await call(controller.email, overrides)).status, 400);
  assert.equal((await call(controller.share, { user: { role: 'telecaller' } })).status, 403);
});
test('share serves immutable PDF by unguessable public token', async () => {
  const result = await call(controller.share);
  assert.equal(result.status, 201);
  assert.match(result.data.token, /^[A-Za-z0-9_-]{22}$/);
  const view = await call(controller.view, { params: { token: result.data.token } });
  assert.equal(view.headers['Content-Type'], 'application/pdf');
  assert.equal(view.data.toString(), '%PDF-test');
  assert.equal((await call(controller.view, { params: { token: 'invalid' } })).status, 404);
  assert.equal((await call(controller.view, { params: { token: 'z'.repeat(22) } })).status, 404);
});
test('mail rejection reports failure', async () => {
  accepted = false;
  try { assert.equal((await call(controller.email)).status, 502); } finally { accepted = true; }
});
