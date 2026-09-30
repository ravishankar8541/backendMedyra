const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');
const Delivery = require('../models/Delivery');
const Package = require('../models/Package');
const controller = require('../controllers/deliveryController');

test('handover validates receiver, stores proof through real multipart HTTP, and supports simple status changes', async () => {
  const original = [auth.protect, Delivery.findById, Package.findByIdAndUpdate, Delivery.findByIdAndUpdate];
  const id = '507f1f77bcf86cd799439011';
  const record = { _id: id, orderId: 'ORDER/001', status: 'out_for_delivery', customer: { name: 'Customer' }, async save() {} };
  auth.protect = (req, res, next) => { req.user = { id, role: 'sales', permissions: ['packaging:view','packaging:create','packaging:edit','packaging:delete','packaging:share','delivery:view','delivery:edit'] }; next(); };
  Delivery.findById = () => Object.assign(Promise.resolve(record), { select: async () => record });
  Package.findByIdAndUpdate = async () => null;
  Delivery.findByIdAndUpdate = async (id, update) => Object.assign(record, update);
  const app = express(); app.use(express.json()); app.use('/deliveries', require('../routes/deliveryRoutes'));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const api = axios.create({ baseURL: `http://127.0.0.1:${server.address().port}`, proxy: false });
  try {
    await assert.rejects(api.patch(`/deliveries/${id}/confirm`, {}), error => error.response.status === 400);
    await assert.rejects(api.patch(`/deliveries/${id}/status`, { status: 'invalid' }), error => error.response.status === 400);
    assert.equal(record.status, 'out_for_delivery');
    const bad = new FormData(); bad.append('receivedBy', 'Receiver'); bad.append('proof', new Blob(['not an image']), 'image.png');
    await assert.rejects(api.patch(`/deliveries/${id}/confirm`, bad), error => error.response.status === 400);
    const bytes = Buffer.from('%PDF-1.4\nSigned handover test');
    const body = new FormData(); body.append('receivedBy', ' Actual Receiver '); body.append('deliveryNotes', 'Two sealed boxes received'); body.append('proof', new Blob([bytes], { type: 'application/pdf' }), 'signed-receipt.pdf');
    const response = await api.patch(`/deliveries/${id}/confirm`, body);
    assert.equal(response.data.data.status, 'delivered');
    assert.equal(record.receivedBy, 'Actual Receiver');
    assert.equal(response.data.data.proof.name, 'signed-receipt.pdf');
    assert.equal(response.data.data.proof.data, undefined);
    assert.deepEqual(record.proof.data, bytes);
    const file = await api.get(`/deliveries/${id}/proof`, { responseType: 'arraybuffer' });
    assert.deepEqual(Buffer.from(file.data), bytes);
    const timestamp = record.deliveredAt;
    await api.patch(`/deliveries/${id}/confirm`, { receivedBy: 'Different person' });
    assert.equal(record.receivedBy, 'Actual Receiver'); assert.equal(record.deliveredAt, timestamp);
    await api.patch(`/deliveries/${id}/status`, { status: 'pending' });
    assert.equal(record.status, 'pending'); assert.equal(record.deliveredAt, null);
    await api.patch(`/deliveries/${id}/status`, { status: 'delivered' });
    assert.equal(record.status, 'delivered'); assert.ok(record.deliveredAt);
    const deliveredAt = record.deliveredAt;
    await api.patch(`/deliveries/${id}/status`, { status: 'delivered' });
    assert.equal(record.deliveredAt, deliveredAt);
  } finally { await new Promise(resolve => server.close(resolve)); [auth.protect, Delivery.findById, Package.findByIdAndUpdate, Delivery.findByIdAndUpdate] = original; }
});
test('sync never treats packing completion as a delivered handover', async () => {
  const original = [Package.find, Delivery.findOne, Delivery.create];
  let saved;
  Package.find = () => ({ sort: async () => [{ _id: 'pkg', orderId: 'ORDER/002', status: 'completed', customerName: 'Customer', customerAddress: 'Delhi', products: [] }] });
  Delivery.findOne = async () => null;
  Delivery.create = async value => { saved = value; };
  try {
    await controller.syncFromPackages({}, { json() {}, status() { return this; } });
    assert.equal(saved.status, 'pending'); assert.equal(saved.receivedBy, ''); assert.equal(saved.deliveredAt, null);
  } finally { [Package.find, Delivery.findOne, Delivery.create] = original; }
});
