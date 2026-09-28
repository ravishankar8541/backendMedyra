const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const sift = require('sift').default;
const Supplier = require('../models/Supplier');
const PurchaseOrder = require('../models/PurchaseOrder');
const PurchaseReturn = require('../models/PurchaseReturn');
const { GoodsReceipt, ConsolidatedInvoice } = require('../models/GoodsReceipt');
const { getVendorLedger } = require('../controllers/vendorLedgerController');
const oid = () => new mongoose.Types.ObjectId();

test('vendor endpoint scopes all history by identity and rejects incomplete loads', async t => {
  const vendor = { _id: oid(), companyName: 'Vendor (QA)+', currency: 'INR' };
  const other = { _id: oid(), companyName: 'Another Vendor', currency: 'INR' };
  let suppliers = [vendor, other], orders = [], receipts = [], invoices = [], returns = [], failInvoices = false;
  const saved = [];
  const mock = (model, name, implementation) => { saved.push([model, name, model[name]]); model[name] = implementation; };
  mock(Supplier, 'findById', id => ({ lean: async () => suppliers.find(row => String(row._id) === String(id)) }));
  mock(Supplier, 'countDocuments', async query => suppliers.filter(sift(query)).length);
  mock(PurchaseOrder, 'find', query => ({ lean: async () => orders.filter(sift(query)) }));
  mock(GoodsReceipt, 'find', query => ({ lean: async () => receipts.filter(sift(query)) }));
  mock(ConsolidatedInvoice, 'find', query => ({ lean: async () => { if (failInvoices) throw new Error('Unavailable'); return invoices.filter(sift(query)); } }));
  mock(PurchaseReturn, 'find', query => ({ lean: async () => returns.filter(sift(query)) }));
  const call = async (id = String(vendor._id)) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await getVendorLedger({ params: { id } }, res);
    return res;
  };
  try {
    await t.test('uses IDs even when another vendor has the same stored display name', async () => {
      orders = [{ _id: oid(), supplierId: vendor._id, poNumber: 'PO-1', items: [] }];
      invoices = [
        { _id: oid(), supplierId: vendor._id, invoiceNumber: 'PI-OWN', grandTotal: 100 },
        { _id: oid(), supplierId: other._id, supplierName: vendor.companyName, invoiceNumber: 'PI-OTHER', grandTotal: 9999 },
        { _id: oid(), purchaseOrder: orders[0]._id, invoiceNumber: 'PI-LINKED', grandTotal: 50 },
        { _id: oid(), supplierName: vendor.companyName, invoiceNumber: 'PI-LEGACY', grandTotal: 20 },
      ];
      const res = await call();
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.summaries[0].totalBilledValue, 170);
      assert.equal(res.body.data.entries.some(row => row.refDoc === 'PI-OTHER'), false);
    });
    await t.test('ambiguous company names do not merge unlinked financial records', async () => {
      suppliers = [vendor, { ...other, companyName: vendor.companyName }];
      const res = await call();
      assert.equal(res.body.data.summaries[0].totalBilledValue, 150);
      assert.match(res.body.data.warnings[0], /Multiple vendors/);
    });
    await t.test('returns all 251 matching invoices instead of one paginated batch', async () => {
      invoices = Array.from({ length: 251 }, (_, index) => ({ _id: oid(), supplierId: vendor._id, invoiceNumber: `PI-${index}`, grandTotal: 10 }));
      const res = await call();
      assert.equal(res.body.data.entries.length, 251);
      assert.equal(res.body.data.summaries[0].totalBilledValue, 2510);
    });
    await t.test('failed invoice query returns an error, never partial totals', async () => {
      failInvoices = true;
      const res = await call();
      assert.equal(res.statusCode, 500);
      assert.equal(res.body.success, false);
      assert.equal(res.body.data, undefined);
      failInvoices = false;
    });
    await t.test('invalid or missing vendor returns 400/404', async () => {
      assert.equal((await call('bad-id')).statusCode, 400);
      assert.equal((await call(String(oid()))).statusCode, 404);
    });
  } finally {
    saved.forEach(([model, name, value]) => { model[name] = value; });
  }
});
