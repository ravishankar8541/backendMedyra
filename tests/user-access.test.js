const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const policy = require('../utils/accessPolicy');
const { protect, authorize } = require('../middleware/auth');
let mongo, server, base, admin, adminToken;
const secretBefore = process.env.JWT_SECRET;
before(async () => {
  process.env.JWT_SECRET = 'isolated-user-access-test-secret';
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'user_access_tests' });
  admin = await User.create({ name: 'Admin', email: 'admin@example.test', phone: '1234567890', password: 'Password123!', role: 'admin', status: 'active', accessVersion: 1 });
  adminToken = jwt.sign({ id: admin._id, v: 0 }, process.env.JWT_SECRET);
  const app = express(); app.use(express.json());
  app.use('/api/auth', require('../routes/authRoutes'));
  app.use('/api/users', require('../routes/userRoutes'));
  app.use('/api/purchase-orders', require('../routes/purchaseOrderRoutes'));
  for (const [method, path] of [['get','/api/accounting/dashboard'],['post','/api/accounting/journals'],['delete','/api/products/test'],['post','/api/packages/test/share'],['get','/api/leads/test']]) {
    app[method](path, protect, authorize(), (req,res) => res.json({ success: true }));
  }
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { await new Promise(resolve => server?.close(resolve)); await mongoose.disconnect(); await mongo?.stop(); if (secretBefore === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secretBefore; });
async function request(path, method='GET', body, token=adminToken) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
const data = (email, extra={}) => ({ name: 'Test user', email, phone: '1234567890', password: 'Password123!', role: 'sales', status: 'active', permissions: [], ...extra });

test('only three roles; public registration and privilege escalation are denied', async () => {
  assert.equal((await request('/purchase-orders', 'GET', null, null)).status, 401);
  assert.equal((await request('/purchase-orders/send-email', 'POST', {}, null)).status, 401);
  assert.equal((await request('/auth/register', 'POST', data('public@example.test', { role: 'admin' }), null)).status, 401);
  for (const role of ['staff','manager','telecaller','delivery_agent']) assert.equal((await request('/users','POST',data(`${role}@example.test`,{role}))).status,400);
  assert.equal((await request('/users','POST',data('wildcard@example.test',{permissions:['all']}))).status,400);
  assert.equal((await request('/users','POST',data('bad@example.test',{permissions:['accounting:delete']}))).status,400);
  const created = await request('/users','POST',data('sales@example.test',{permissions:['accounting:view']}));
  assert.equal(created.status,201); assert.equal(created.body.token,undefined); assert.equal(created.body.data.password,undefined);
  const login = await request('/auth/login','POST',{email:'sales@example.test',password:'Password123!',role:'sales'},null);
  assert.equal(login.status,200);
  const token = login.body.token;
  assert.equal((await request('/users','GET',null,token)).status,403);
  assert.equal((await request('/auth/register','POST',data('evil@example.test',{role:'admin'}),token)).status,403);
  assert.equal((await request('/users/'+created.body.data._id,'PUT',{role:'admin'},token)).status,403);
  assert.equal((await request('/accounting/dashboard','GET',null,token)).status,200);
  assert.equal((await request('/accounting/journals','POST',{},token)).status,403);
  assert.equal((await request('/users/'+created.body.data._id,'PUT',{permissions:['accounting:view','accounting:create']})).status,200);
  assert.equal((await request('/accounting/journals','POST',{},token)).status,200);
  await request('/users/'+created.body.data._id,'PUT',{permissions:[]});
  assert.equal((await request('/accounting/dashboard','GET',null,token)).status,403);
  const relogin = await request('/auth/login','POST',{email:'sales@example.test',password:'Password123!',role:'sales'},null);
  assert.deepEqual(relogin.body.user.permissions,[]);
  await request('/users/'+created.body.data._id+'/status','PATCH',{status:'inactive'});
  assert.equal((await request('/auth/me','GET',null,token)).status,401);
});

test('admin self-protection, whitelisted updates, and reset revoke existing tokens', async () => {
  const profile = await request('/users/'+admin._id,'PUT',{name:'Changed name',email:'updated-admin@example.test',phone:'9876543210',department:'Administration'});
  assert.equal(profile.status,200);
  assert.equal(profile.body.data.name,'Changed name');
  assert.equal(profile.body.data.email,'updated-admin@example.test');
  assert.equal(profile.body.data.role,'admin');
  assert.equal((await request('/users/'+admin._id,'PUT',{email:'invalid'})).status,400);
  assert.equal((await request('/users/'+admin._id,'PUT',{password:'Bypass123!'})).status,400);
  assert.equal((await request('/users/'+admin._id+'/reset-password','POST',{newPassword:'Replacement123!'})).status,400);
  assert.equal((await request('/auth/change-password','PUT',{currentPassword:'wrong',newPassword:'Replacement123!'})).status,400);
  assert.equal((await request('/users/'+admin._id,'PUT',{role:'sales'})).status,400);
  assert.equal((await request('/users/'+admin._id+'/status','PATCH',{status:'inactive'})).status,400);
  assert.equal((await request('/users/'+admin._id,'DELETE')).status,400);
  const created = await request('/users','POST',data('accountant@example.test',{role:'accountant'}));
  const id = created.body.data._id;
  const login = await request('/auth/login','POST',{email:'accountant@example.test',password:'Password123!',role:'accountant'},null);
  await request('/users/'+id,'PUT',{password:'Hacked123!',authVersion:999,permissions:[]});
  const stored = await User.findById(id);
  assert.equal(await stored.comparePassword('Password123!'),true);
  assert.equal(stored.authVersion,0);
  assert.equal((await request('/users/'+id+'/reset-password','POST',{newPassword:'Replacement123!'})).status,200);
  assert.equal((await request('/auth/me','GET',null,login.body.token)).status,401);
  assert.equal((await request('/users/'+id+'/status','PATCH',{status:'invalid'})).status,400);
});

test('legacy sales role and module permissions migrate once without recreating denied access', async () => {
  const source = await User.create(data('legacy@example.test'));
  await User.collection.updateOne({_id:source._id},{$set:{role:'telecaller',permissions:['telecaller'],accessVersion:0}});
  const login = await request('/auth/login','POST',{email:'legacy@example.test',password:'Password123!',role:'sales'},null);
  assert.equal(login.status,200);
  assert.equal(login.body.user.role,'sales');
  assert.ok(login.body.user.permissions.includes('sales:edit'));
  assert.equal((await User.findById(source._id)).accessVersion,1);
});

test('action policy distinguishes reading, payments, sharing, cancellation and cross-module conversion', () => {
  const user={role:'sales',permissions:['purchase:view','purchase:share','invoices:view','invoices:create']};
  const allowed=(method,path)=>policy.canRequest(user,{method,originalUrl:'/api'+path});
  assert.equal(allowed('POST','/purchase-orders/send-email'),true);
  assert.equal(allowed('DELETE','/purchase-orders/123'),false);
  assert.equal(allowed('POST','/purchase-returns/123/cancel'),false);
  assert.equal(allowed('POST','/goods-receipts/123/payment'),false);
  assert.equal(allowed('POST','/leads/123/convert-invoice'),false);
  user.permissions.push('sales:view');
  assert.equal(allowed('POST','/leads/123/convert-invoice'),true);
});
