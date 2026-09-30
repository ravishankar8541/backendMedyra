const { test } = require('node:test');
const assert = require('node:assert/strict');
const groupItems = require('../utils/creditNoteGroups');
const base = { product: 'product-1', productName: 'Sample medicine', hsn: '3004', unit: 'Box', unitPrice: 100, taxRate: 18, restock: true };
const items = [
  { ...base, batchNumber: 'BATCH-A', expiryDate: '2027-01-01', quantity: 2, subtotal: 200, total: 236 },
  { ...base, batchNumber: 'BATCH-B', expiryDate: '2028-02-01', quantity: 3, subtotal: 300, total: 354 },
  { ...base, batchNumber: 'BATCH-A', expiryDate: '2027-01-01', quantity: 1, subtotal: 100, total: 118 },
];
test('groups batches without mutating saved return lines and keeps UI/PDF grouping identical', async () => {
  const before = JSON.stringify(items);
  const rows = groupItems(items);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 6);
  assert.equal(rows[0].subtotal, 600);
  assert.equal(rows[0].total, 708);
  assert.deepEqual(rows[0].batches.map(b => [b.batchNumber, b.quantity]), [['BATCH-A', 3], ['BATCH-B', 3]]);
  assert.equal(JSON.stringify(items), before);
  const frontend = await import('../../medyra-frontend_2Sept/src/utils/creditNoteGroups.js');
  assert.deepEqual(frontend.creditNoteGroups(items), rows);
});
test('different product, price, tax, unit, HSN and stock action remain separate', () => {
  for (const change of [{ product: 'product-2' }, { unitPrice: 50 }, { taxRate: 12 }, { unit: 'Strip' }, { hsn: 'other' }, { restock: false }]) {
    assert.equal(groupItems([items[0], { ...items[1], ...change }]).length, 2);
  }
  const row = groupItems([items[0], { ...items[0], expiryDate: '2029-01-01' }])[0];
  assert.equal(row.batches.length, 2);
  assert.deepEqual(groupItems(), []);
});
test('PDF renders a single item row with both batch quantities and dates', () => {
  const { jsPDF } = require('jspdf');
  const render = require('../utils/creditNotePdf');
  const original = jsPDF.API.autoTable;
  let productTable;
  jsPDF.API.autoTable = function (options) {
    if (options.head?.[0]?.[1] === 'Item & Description') productTable = options;
    return original.call(this, options);
  };
  try {
    const pdf = render({ returnNumber: 'CN-GROUP-CHECK', items, subtotal: 600, totalTax: 108, total: 708 });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal(productTable.body.length, 1);
    const row = productTable.body[0];
    assert.match(row[2], /BATCH-A[\s\S]*BATCH-B/);
    assert.equal(row[3], '3\nBox\n3\nBox');
    assert.match(row[4], /01\/01\/2027[\s\S]*01\/02\/2028/);
    assert.equal(row[5], '6\nBox');
    assert.equal(row[7], '600.00');
  } finally { jsPDF.API.autoTable = original; }
});
