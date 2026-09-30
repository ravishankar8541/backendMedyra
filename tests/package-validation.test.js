const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizePackage } = require('../utils/packageValidation');
const Package = require('../models/Package');
const controller = require('../controllers/packageController');
test('cartons determine counts and product summary without changing batch allocations', () => {
  const boxes = [{ items: [{ name: 'Medicine', batchNo: 'A', quantity: '2.5' }] }, { items: [{ name: 'Medicine', batchNo: 'B', quantity: '3' }] }];
  const result = normalizePackage({ boxes, totalBoxesCount: 9, products: [] });
  assert.equal(result.totalBoxesCount, 2);
  assert.equal(result.boxNo, '1/2');
  assert.deepEqual(result.products.map(i => i.batchNo), ['A', 'B']);
  assert.equal(result.products[0].quantity, '2.5');
  assert.equal(result.boxes[1].boxNumber, '2');
});
test('rejects empty cartons, invalid quantities and unknown statuses', () => {
  for (const boxes of [[], [{ items: [] }], [{ items: [{ name: 'Medicine', quantity: '-1' }] }], [{ items: [{ name: 'Medicine', quantity: 'Infinity' }] }]]) assert.throws(() => normalizePackage({ boxes }));
  assert.throws(() => normalizePackage({ status: 'shipped' }));
  assert.throws(() => normalizePackage({ customerAddress: '   ' }));
});
test('status API validates values and clears stale completion dates when reopened', async () => {
  const original = Package.findByIdAndUpdate;
  const calls = [];
  Package.findByIdAndUpdate = async (...args) => { calls.push(args); return { _id: 'id', ...args[1] }; };
  let status = 200;
  const res = { status(value) { status = value; return this; }, json(value) { return value; } };
  try {
    await controller.updatePackageStatus({ params: { id: 'id' }, body: { status: 'invalid' } }, res);
    assert.equal(status, 400); assert.equal(calls.length, 0);
    await controller.updatePackageStatus({ params: { id: 'id' }, body: { status: 'in_progress' } }, res);
    assert.equal(calls[0][1].completedDate, '');
    assert.equal(calls[0][2].runValidators, true);
  } finally { Package.findByIdAndUpdate = original; }
});
