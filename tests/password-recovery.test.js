const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const mail = require('../utils/poEmail');
const original = mail.getTransport;
let mongo, server, base, delivered;
before(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  mail.getTransport = () => ({ user: 'test@example.test', transporter: { sendMail: async message => { delivered = message; return { accepted: [message.to] }; } } });
  const controller = require('../controllers/passwordRecoveryController');
  const app = express(); app.use(express.json()); app.post('/forgot', controller.forgot); app.post('/reset', controller.reset);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { mail.getTransport = original; await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await mongo.stop(); });
async function post(path, body) { const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; }
test('admin recovery: email code, expiry, single use and session revocation', async () => {
  const admin = await User.create({ name: 'Admin', email: 'admin@example.test', phone: '1234567890', role: 'admin', status: 'active', password: 'OldPassword123!' });
  const sent = await post('/forgot', { email: admin.email }); assert.equal(sent.status, 200);
  const token = delivered.text.match(/[a-f0-9]{48}/)[0];
  const hidden = await User.findById(admin._id); assert.equal(hidden.passwordResetHash, undefined);
  const unknown = await post('/forgot', { email: 'unknown@example.test' }); assert.equal(unknown.body.message, sent.body.message);
  assert.equal((await post('/reset', { token: 'a'.repeat(48), newPassword: 'NewPassword123!' })).status, 400);
  assert.equal((await post('/reset', { token, newPassword: 'short' })).status, 400);
  assert.equal((await post('/reset', { token, newPassword: 'NewPassword123!' })).status, 200);
  assert.equal((await post('/reset', { token, newPassword: 'AgainPassword123!' })).status, 400);
  const updated = await User.findById(admin._id); assert.equal(updated.authVersion, 1); assert.equal(await updated.comparePassword('NewPassword123!'), true);
  await User.updateOne({ _id: admin._id }, { $unset: { passwordResetRequestedAt: 1 } });
  await post('/forgot', { email: admin.email }); const expired = delivered.text.match(/[a-f0-9]{48}/)[0];
  await User.updateOne({ _id: admin._id }, { $set: { passwordResetExpires: new Date(0) } });
  assert.equal((await post('/reset', { token: expired, newPassword: 'AnotherPassword123!' })).status, 400);
});
test('sales and accountant cannot request recovery or use previously issued tokens', async () => {
  const crypto = require('node:crypto');
  for (const role of ['sales', 'accountant']) {
    const user = await User.create({ name: role, email: `${role}@example.test`, phone: '1234567890', role, status: 'active', password: 'OldPassword123!' });
    delivered = null;
    assert.equal((await post('/forgot', { email: user.email, role: 'admin' })).status, 200);
    assert.equal(delivered, null);
    const token = crypto.randomBytes(24).toString('hex');
    await User.updateOne({ _id: user._id }, { $set: { passwordResetHash: crypto.createHash('sha256').update(token).digest('hex'), passwordResetExpires: new Date(Date.now() + 60000) } });
    assert.equal((await post('/reset', { token, newPassword: 'NewPassword123!' })).status, 400);
    assert.equal(await (await User.findById(user._id)).comparePassword('OldPassword123!'), true);
  }
});
