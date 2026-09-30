const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');
const Package = require('../models/Package');
const Share = require('../models/PackageShare');
const mail = require('../utils/poEmail');

test('real multipart uploads override JSON defaults for Packing List email and WhatsApp', async () => {
  const id = '507f1f77bcf86cd799439011';
  const originals = [auth.protect, auth.authorize, Package.findById, Share.create, mail.getTransport];
  let sent, stored, contentType;
  // Only this isolated test server replaces authentication, database and SMTP.
  auth.protect = (req, res, next) => { req.user = { role: 'sales', permissions: ['packaging:view','packaging:create','packaging:edit','packaging:delete','packaging:share','delivery:view','delivery:edit'], id }; next(); };
  auth.authorize = () => (req, res, next) => next();
  Package.findById = async () => ({ _id: id, orderId: 'MP/HTTP/001' });
  Share.create = async value => { stored = value; return value; };
  mail.getTransport = () => ({ user: 'sender@example.invalid', transporter: { sendMail: async value => {
    sent = value; return { accepted: [value.to] };
  } } });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { contentType = req.headers['content-type']; next(); });
  app.use('/packages', require('../routes/packageRoutes'));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const api = axios.create({ baseURL: `http://127.0.0.1:${server.address().port}`, proxy: false, headers: { 'Content-Type': 'application/json' } });
  const bytes = Buffer.from('%PDF-1.4\nPacking List HTTP regression fixture\n%%EOF');
  const form = () => {
    const data = new FormData();
    data.append('pdf', new Blob([bytes], { type: 'application/pdf' }), 'Packing_List.pdf');
    data.append('to', 'recipient@example.invalid');
    data.append('subject', 'Packing List upload test');
    data.append('message', 'Test attachment');
    return data;
  };
  try {
    // Reproduce the reported failure with the previous request configuration.
    await assert.rejects(api.post(`/packages/${id}/email`, form()), error => {
      assert.equal(error.response.status, 400);
      assert.equal(error.response.data.message, 'A valid Packing List PDF is required.');
      return true;
    });
    assert.equal(sent, undefined);
    const { uploadPackingList } = await import('../../medyra-frontend_2Sept/src/utils/uploadPackingList.js');
    const response = await uploadPackingList(api, id, 'email', form());
    assert.equal(response.status, 200);
    assert.match(contentType, /^multipart\/form-data; boundary=/);
    assert.deepEqual(sent.attachments[0].content, bytes);
    assert.equal(sent.to, 'recipient@example.invalid');
    const share = await uploadPackingList(api, id, 'share', form());
    assert.equal(share.status, 201);
    assert.match(share.data.token, /^[A-Za-z0-9_-]{22}$/);
    assert.deepEqual(stored.pdf, bytes);
  } finally {
    await new Promise(resolve => server.close(resolve));
    [auth.protect, auth.authorize, Package.findById, Share.create, mail.getTransport] = originals;
  }
});
