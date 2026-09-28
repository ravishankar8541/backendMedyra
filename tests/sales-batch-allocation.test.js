const test = require('node:test');
const assert = require('node:assert/strict');
const allocate = require('../utils/allocateSalesBatches');
function setup() {
  let saves = 0;
  const product = { name: 'Medicine', productType: 'batch', stock: 15,
    batches: [
      { _id: 'a', batchNumber: 'SAME', quantity: 10, reservedQuantity: 3, costPrice: 50, mfgDate: '2026-01-01', expDate: '2028-01-01' },
      { _id: 'b', batchNumber: 'SAME', quantity: 5, reservedQuantity: 0, costPrice: 60 }
    ], save: async () => { saves++; } };
  return { product, Product: { findById: async () => product }, saves: () => saves };
}
const original = [{ productId: 'p', quantity: 10 }];
test('grouped batch allocates across matching and restock lots with exact costs and dates', async () => {
  const ctx = setup();
  ctx.product.batches[1].batchNumber = 'RESTOCK-SAME';
  const items = [{ productId: 'p', quantity: 10, stockBatchId: 'a', batchGroup: true, rate: 99 }];
  await allocate(items, original, ctx.Product);
  assert.deepEqual(items.map(i => [i.stockBatchId, i.quantity, i.costPrice, i.rate]), [['a', 7, 50, 99], ['b', 3, 60, 99]]);
  assert.equal(items[0].mfgDate, '2026-01-01');
  assert.equal(items[1].mfgDate, '');
  assert.equal(ctx.product.batches[0].quantity, 3);
  assert.equal(ctx.product.batches[1].quantity, 2);
  assert.equal(ctx.product.stock, 5);
});
test('grouped stock cannot borrow another batch or oversell across repeated rows', async () => {
  const ctx = setup();
  ctx.product.batches.push({_id:'c', batchNumber:'OTHER', quantity:100});
  const items = [7, 6].map(quantity => ({productId:'p', quantity, stockBatchId:'a', batchGroup:true}));
  await assert.rejects(allocate(items, [{productId:'p',quantity:20}], ctx.Product), /only 5 available/);
  assert.equal(ctx.saves(), 0);
  assert.equal(ctx.product.batches[2].quantity, 100);
});
test('deducts exact lot and copies authoritative dates/cost without changing selling rate', async () => {
  const ctx = setup();
  const items = [{ productId: 'p', quantity: 4, stockBatchId: 'a', rate: 99, batch: 'forged' }];
  await allocate(items, original, ctx.Product);
  assert.equal(ctx.product.batches[0].quantity, 6);
  assert.equal(ctx.product.batches[1].quantity, 5);
  assert.equal(items[0].batch, 'SAME');
  assert.equal(items[0].mfgDate, '2026-01-01');
  assert.equal(items[0].costPrice, 50);
  assert.equal(items[0].rate, 99);
  assert.equal(ctx.saves(), 1);
});
test('requires explicit batch and never falls back to another lot', async () => {
  for (const id of ['', 'missing']) {
    const ctx = setup();
    await assert.rejects(allocate([{ productId: 'p', quantity: 1, stockBatchId: id }], original, ctx.Product), /Select an inventory batch/);
    assert.equal(ctx.saves(), 0);
  }
});
test('respects reserved stock and cumulative duplicate rows before saving', async () => {
  const ctx = setup();
  await assert.rejects(allocate([4, 4].map(quantity => ({ productId: 'p', quantity, stockBatchId: 'a' })), original, ctx.Product), /only 3 available/);
  assert.equal(ctx.saves(), 0);
});
test('rejects combined quantity exceeding proforma', async () => {
  const ctx = setup();
  await assert.rejects(allocate([6, 5].map(quantity => ({ productId: 'p', quantity, stockBatchId: 'a' })), original, ctx.Product), /exceeds the proforma/);
  assert.equal(ctx.saves(), 0);
});
test('non-batch products deduct stock without batch selection', async () => {
  const product = { name: 'Item', productType: 'non-batch', stock: 8, reservedStock: 2, save: async () => {} };
  await allocate([{ productId: 'p', quantity: 6 }], original, { findById: async () => product });
  assert.equal(product.stock, 2);
});
