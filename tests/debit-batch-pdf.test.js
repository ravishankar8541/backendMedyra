const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Return=require('../models/PurchaseReturn');
const {getPublicDebitNoteView}=require('../controllers/purchaseReturnController');
const {jsPDF}=require('jspdf');
require('jspdf-autotable');
test('debit note groups returned batches and preserves quantities and amounts',async()=>{
 const original=Return.findById, originalTable=jsPDF.API.autoTable;
 let rows,body;
 jsPDF.API.autoTable=function(options){if(options.head?.[0]?.includes('Batch Qty'))rows=options.body;return originalTable.call(this,options)};
 const base={product:'507f1f77bcf86cd799439011',productName:'Cetirizine 10mg Tablets',quantity:3,batchNumber:'C-2026-01',unit:'Strip',unitPrice:50,total:150,totalWithTax:150,taxRate:0,hsn:'30049099',reason:'Damaged packaging'};
 const items=[base,{...base,quantity:2,batchNumber:'C-2026-02',total:100,totalWithTax:100},{...base,quantity:1,batchNumber:'C-2026-03',unitPrice:60,total:60,totalWithTax:60}];
 const res={set(){return this},status(v){assert.equal(v,200);return this},send(v){body=v;return this}};
 try{
  Return.findById=async()=>({returnNumber:'PR-2026/003',invoiceNumber:'PI-2026/003',poNumber:'PO-2026/003',supplierName:'HealthPlus Labs Pvt. Ltd.',supplier:'HealthPlus Labs Pvt. Ltd.',status:'completed',currency:'INR',returnDate:'2026-09-29',subtotal:310,totalTax:0,total:310,items});
  await getPublicDebitNoteView({params:{id:'507f1f77bcf86cd799439011'}},res);
  assert.equal(rows.length,2);
  assert.equal(rows[0][5],'5\nStrip');
  assert.equal(rows[0][7],'250.00');
  assert.equal(rows[0][3],'3\n2');
  assert.match(rows[0][2],/C-2026-01[\s\S]*C-2026-02/);
  assert.equal(rows[1][7],'60.00');
  fs.mkdirSync('tmp/debit-batch-qa',{recursive:true});
  fs.writeFileSync('tmp/debit-batch-qa/grouped.pdf',body);
 }finally{Return.findById=original;jsPDF.API.autoTable=originalTable}
});
