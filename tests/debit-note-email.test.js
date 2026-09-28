const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const PurchaseReturn = require('../models/PurchaseReturn');
let sent, outcome, note;
nodemailer.createTransport = () => ({ close() {}, async sendMail(message) {
  sent = message;
  if (outcome instanceof Error) throw outcome;
  return outcome;
} });
PurchaseReturn.findById = async () => note;
const { sendDebitNoteEmail } = require('../controllers/debitNoteEmailController');
process.env.EMAIL_USER = 'sender@example.com';
process.env.EMAIL_PASS = 'test-only';
const payload = { to: 'vendor@example.com', cc: 'cc@example.com', body: 'Please confirm <return>.' };
async function send(data = payload, buffer = Buffer.from('%PDF-1.4\nfixture'), id = '507f1f77bcf86cd799439011') {
  sent = undefined;
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.data = value; return this; } };
  await sendDebitNoteEmail({ params: { id }, body: { emailData: typeof data === 'string' ? data : JSON.stringify(data) }, file: { buffer } }, res);
  return res;
}
test('debit note email validation and delivery outcomes', async t => {
  note = { returnNumber: 'PR-2026/019', status: 'completed' };
  outcome = { accepted: ['vendor@example.com', 'cc@example.com'], rejected: [], messageId: 'test' };
  await t.test('PDF attachment, debit note subject and escaped message', async () => {
    assert.equal((await send()).data.success, true);
    assert.equal(sent.attachments[0].filename, 'DN-2026_019.pdf');
    assert.equal(sent.attachments[0].contentType, 'application/pdf');
    assert.match(sent.subject, /Debit Note DN-2026\/019/);
    assert.equal(sent.cc, payload.cc);
    assert.equal(sent.text, payload.body);
    assert.match(sent.html, /&lt;return&gt;/);
  });
  await t.test('rejects invalid recipients, fields, JSON, PDF and ID', async () => {
    for (const value of ['{', null, [], { ...payload, to: 'bad' }, { ...payload, cc: 'bad' }, { ...payload, subject: {} }]) {
      assert.equal((await send(value)).statusCode, 400);
      assert.equal(sent, undefined);
    }
    assert.equal((await send(payload, Buffer.from('not pdf'))).statusCode, 400);
    assert.equal((await send(payload, undefined, 'bad-id')).statusCode, 400);
  });
  await t.test('rejects missing and cancelled notes without emailing', async () => {
    note = null;
    assert.equal((await send()).statusCode, 404);
    note = { status: 'cancelled' };
    assert.equal((await send()).statusCode, 409);
    assert.equal(sent, undefined);
    note = { returnNumber: 'PR-2026/019', status: 'completed' };
  });
  await t.test('reports rejected vendor and partial CC delivery', async () => {
    outcome = { accepted: ['cc@example.com'], rejected: ['vendor@example.com'] };
    assert.equal((await send()).statusCode, 502);
    outcome = { accepted: ['vendor@example.com'], rejected: ['cc@example.com'] };
    assert.match((await send()).data.warning, /CC/);
  });
  await t.test('reports SMTP failures without private diagnostics', async () => {
    outcome = Object.assign(new Error('private diagnostic'), { code: 'EAUTH' });
    const res = await send();
    assert.equal(res.statusCode, 502);
    assert.match(res.data.error, /EMAIL_PASS/);
    assert.doesNotMatch(res.data.error, /private/);
  });
});
