const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ConsolidatedInvoice } = require('../models/GoodsReceipt');
const { getPublicInvoiceView } = require('../controllers/goodsReceiptController');
test('public invoice link serves an inline PDF with embedded logo and handles missing records', async () => {
 const original=ConsolidatedInvoice.findById;let status=200,body;const headers={};
 const res={set(k,v){headers[k]=v;return this;},status(v){status=v;return this;},send(v){body=v;return this;}};
 try {
  ConsolidatedInvoice.findById=async()=>({invoiceNumber:'PI-2026/001',poNumber:'PO-2026/001',supplierName:'QA Vendor',currency:'INR',invoiceDate:'2026-09-28',dueDate:'2026-10-01',grandTotal:500,subtotal:500,totalTax:0,paidAmount:400,remainingAmount:100,items:[{productName:'Vitamin D3',batchNumber:'BATCH-1',acceptedQty:10,receivedQty:10,unitPrice:50,taxRate:0,unit:'Bottle'}]});
  await getPublicInvoiceView({params:{id:'507f1f77bcf86cd799439011'}},res);
  assert.equal(status,200);assert.equal(headers['Content-Type'],'application/pdf');assert.match(headers['Content-Disposition'],/^inline;/);assert.equal(body.subarray(0,5).toString(),'%PDF-');assert.match(body.toString('latin1'),/\/Subtype \/Image/);
  fs.mkdirSync('tmp/pi-pdf-qa',{recursive:true});fs.writeFileSync('tmp/pi-pdf-qa/public-pi.pdf',body);
  ConsolidatedInvoice.findById=async()=>null;await getPublicInvoiceView({params:{id:'507f1f77bcf86cd799439011'}},res);assert.equal(status,404);
 }finally{ConsolidatedInvoice.findById=original;}
});
