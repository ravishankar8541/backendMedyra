const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
let options, sent, outcome;
nodemailer.createTransport = config => {
  options = config;
  return { close() {}, async sendMail(message) {
    sent = message;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  } };
};
const { sendPurchaseInvoiceEmail } = require('../controllers/goodsReceiptController');
process.env.EMAIL_HOST = 'smtp.titan.email';
process.env.EMAIL_PORT = '587';
process.env.EMAIL_USER = 'sender@example.com';
process.env.EMAIL_PASS = 'pass with spaces';
const payload = { to: 'vendor@example.com', cc: 'cc@example.com', invoiceNumber: 'PI/009', body: 'Please confirm <receipt>.' };
async function send(body = { emailData: JSON.stringify(payload) }, file = { buffer: Buffer.from('%PDF-1.4\nfixture') }) {
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.data = value; } };
  await sendPurchaseInvoiceEmail({ body, file }, res);
  return res;
}
test('invoice emails use configured SMTP and report real outcomes', async t => {
  await t.test('Titan transport, unmodified password, PDF, CC and text alternative', async () => {
    outcome = { accepted: ['vendor@example.com', 'cc@example.com'], rejected: [], messageId: 'test' };
    assert.equal((await send()).data.success, true);
    assert.equal(options.host, 'smtp.titan.email');
    assert.equal(options.port, 587);
    assert.equal(options.auth.pass, 'pass with spaces');
    assert.equal(sent.cc, payload.cc);
    assert.equal(sent.text, payload.body);
    assert.match(sent.html, /&lt;receipt&gt;/);
    assert.equal(sent.attachments[0].filename, 'PI-PI_009.pdf');
  });
  await t.test('malformed data and missing PDF are rejected', async () => {
    assert.equal((await send({ emailData: '{' })).statusCode, 400);
    assert.equal((await send({ to: 'invalid' })).statusCode, 400);
    assert.equal((await send({ emailData: JSON.stringify(payload) }, null)).statusCode, 400);
  });
  await t.test('vendor rejection is not reported as success', async () => {
    outcome = { accepted: ['cc@example.com'], rejected: ['vendor@example.com'] };
    assert.equal((await send()).statusCode, 502);
  });
  await t.test('partial CC rejection is surfaced', async () => {
    outcome = { accepted: ['vendor@example.com'], rejected: ['cc@example.com'] };
    const res = await send();
    assert.equal(res.data.success, true);
    assert.match(res.data.warning, /CC/);
  });
  await t.test('SMTP failures return actionable errors', async () => {
    outcome = Object.assign(new Error('private SMTP diagnostic'), { code: 'EAUTH' });
    const res = await send();
    assert.equal(res.statusCode, 502);
    assert.match(res.data.error, /EMAIL_PASS/);
    assert.doesNotMatch(res.data.error, /private/);
  });
});
