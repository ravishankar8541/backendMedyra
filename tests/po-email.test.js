const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const express = require('express');

// No database connection or external email is used by these tests.
let outcome;
let sent;
let transportOptions;
nodemailer.createTransport = options => {
  transportOptions = options;
  return {
    close() {},
    async sendMail(message) {
      sent = message;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }
  };
};
const router = require('../routes/purchaseOrderRoutes');
const PurchaseOrder = require('../models/PurchaseOrder');
const { sendPOEmail } = require('../controllers/purchaseOrderController');
process.env.EMAIL_USER = 'sender@example.com';
process.env.EMAIL_PASS = 'test-password';
process.env.EMAIL_PORT = '587';

function request(overrides = {}) {
  return {
    body: { emailData: JSON.stringify({ to: 'vendor@example.com', cc: 'cc@example.com', body: '<hello> & thanks', poNumber: 'PO-1' }) },
    file: { buffer: Buffer.from('%PDF-1.4\nfixture') },
    ...overrides
  };
}
async function invoke(req) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
  await sendPOEmail(req, res);
  return res;
}

test('purchase order email validation, SMTP outcomes and upload handling', async t => {
  await t.test('rejects malformed JSON, wrong field types, invalid addresses and missing PDF before sending', async () => {
    for (const req of [request({ body: { emailData: '{' } }), request({ body: { to: [] } }), request({ body: { to: 'invalid' } }), request({ file: undefined }), request({ file: { buffer: Buffer.from('not a pdf') } })]) {
      sent = undefined;
      assert.equal((await invoke(req)).statusCode, 400);
      assert.equal(sent, undefined);
    }
  });
  await t.test('sends PDF with CC once, escapes HTML, uses TLS and records acceptance', async () => {
    outcome = { accepted: ['vendor@example.com', 'cc@example.com'], rejected: [], messageId: 'test-id' };
    let update;
    PurchaseOrder.findOneAndUpdate = async (...args) => { update = args; return {}; };
    const res = await invoke(request());
    assert.equal(res.data.success, true);
    assert.equal(sent.cc, 'cc@example.com');
    assert.equal(sent.attachments[0].content.toString(), '%PDF-1.4\nfixture');
    assert.match(sent.html, /&lt;hello&gt; &amp; thanks/);
    assert.equal(update[1].emailSent, true);
    assert.equal(transportOptions.secure, false);
    assert.equal(transportOptions.requireTLS, true);
    assert.notEqual(transportOptions.tls.rejectUnauthorized, false);
  });
  await t.test('does not report a failed send after SMTP acceptance if saving fails', async () => {
    PurchaseOrder.findOneAndUpdate = async () => { throw new Error('database unavailable'); };
    const res = await invoke(request());
    assert.equal(res.data.success, true);
    assert.match(res.data.warning, /Do not resend/);
  });
  await t.test('reports partial CC rejection while preserving vendor success', async () => {
    outcome = { accepted: ['vendor@example.com'], rejected: ['cc@example.com'] };
    PurchaseOrder.findOneAndUpdate = async () => ({});
    const res = await invoke(request());
    assert.equal(res.data.success, true);
    assert.match(res.data.warning, /CC recipient was rejected/);
  });
  await t.test('vendor rejection never marks the PO emailed even if CC accepted', async () => {
    outcome = { accepted: ['cc@example.com'], rejected: ['vendor@example.com'] };
    PurchaseOrder.findOneAndUpdate = async () => assert.fail('must not update');
    assert.equal((await invoke(request())).data.success, false);
  });
  await t.test('authentication failures provide actionable errors without secrets', async () => {
    outcome = Object.assign(new Error('secret diagnostic'), { code: 'EAUTH' });
    const res = await invoke(request());
    assert.equal(res.statusCode, 502);
    assert.match(res.data.error, /EMAIL_PASS/);
    assert.doesNotMatch(res.data.error, /secret diagnostic/);
  });
  await t.test('missing server configuration is explicit', async () => {
    const pass = process.env.EMAIL_PASS;
    delete process.env.EMAIL_PASS;
    try { assert.equal((await invoke(request())).statusCode, 503); }
    finally { process.env.EMAIL_PASS = pass; }
  });
  await t.test('multipart endpoint accepts the real frontend payload and rejects oversized uploads', async () => {
    outcome = { accepted: ['vendor@example.com'], rejected: [] };
    PurchaseOrder.findOneAndUpdate = async () => ({});
    const app = express();
    app.use('/purchase-orders', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      for (const [size, status] of [[30, 200], [10 * 1024 * 1024 + 1, 413]]) {
        const data = new FormData();
        const pdf = Buffer.alloc(size);
        pdf.write('%PDF-1.4');
        data.append('pdf', new Blob([pdf], { type: 'application/pdf' }), 'PO-1.pdf');
        data.append('emailData', request().body.emailData);
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/purchase-orders/send-email', { method: 'POST', body: data });
        assert.equal(response.status, status);
        assert.equal((await response.json()).success, status === 200);
      }
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});
