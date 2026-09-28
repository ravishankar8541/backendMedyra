
// models/GoodsReceipt.js
const mongoose = require('mongoose');

const GRNItemSchema = new mongoose.Schema({
  purchaseOrderItemId: { type: mongoose.Schema.Types.ObjectId },
  stockBatchId: { type: mongoose.Schema.Types.ObjectId },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productName: { type: String, required: true },
  sku: { type: String, default: '' },
  hsn: { type: String, default: '' },
  unit: { type: String, default: 'Strips' },
  orderedQty: { type: Number, default: 0 },
  alreadyReceived: { type: Number, default: 0 },
  receivedQty: { type: Number, required: true, min: 0 },
  acceptedQty: { type: Number, required: true, min: 0 },
  rejectedQty: { type: Number, default: 0 },
  remainingQty: { type: Number, default: 0 },
  batchNumber: { type: String, default: 'N/A' },
  mfgDate: { type: String, default: '' },
  expDate: { type: String, default: '' },
  unitPrice: { type: Number, default: 0 },
  mrp: { type: Number },
  sellingPrice: { type: Number },
  taxRate: { type: Number, default: 0 },
  subtotal: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  totalWithTax: { type: Number, default: 0 },
  remarks: { type: String, default: '' }
});

const ChargesSchema = new mongoose.Schema({
  amount: { type: Number, default: 0 },
  taxRate: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 }
}, { _id: false });

// ⭐ Expanded enum to support all payment methods safely
const PaymentSchema = new mongoose.Schema({
  date: { type: String, required: true },
  amount: { type: Number, required: true },
  method: {
    type: String,
    enum: ['cash', 'bank', 'cheque', 'online', 'adjustment', 'bank_transfer', 'upi', 'advance', 'other'],
    default: 'bank'
  },
  reference: { type: String, default: '' },
  notes: { type: String, default: '' },
  receivedBy: { type: String, default: '' }
}, { _id: true });

const ConsolidatedInvoiceSchema = new mongoose.Schema({
  paymentCorrections: [{ previousAmount: Number, correctedAmount: Number, reason: String, correctedBy: String, correctedAt: Date, previousPayments: [PaymentSchema], correctedPayments: [PaymentSchema] }],
  invoiceNumber: { type: String, required: true, unique: true },
  grnIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt' }],
  poNumber: { type: String, required: true },
  purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  supplierName: { type: String, required: true },
  supplierGST: { type: String, default: '' },
  supplierAddress: { type: String, default: '' },
  supplierContact: { type: String, default: '' },
  supplierEmail: { type: String, default: '' },
  invoiceDate: { type: String, required: true },
  dueDate: { type: String, required: true },
  items: [GRNItemSchema],
  subtotal: { type: Number, default: 0 },
  totalTax: { type: Number, default: 0 },
  chargesSubtotal: { type: Number, default: 0 },
  chargesTax: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },
  roundOff: { type: Number, default: 0 },
  freight: { type: ChargesSchema, default: () => ({}) },
  insurance: { type: ChargesSchema, default: () => ({}) },
  inventoryCharges: { type: ChargesSchema, default: () => ({}) },
  gstType: { type: String, enum: ['igst', 'cgst_sgst'], default: 'igst' },
  currency: { type: String, default: 'INR' },
  exchangeRate: { type: Number, default: 1 },
  paidAmount: { type: Number, default: 0 },
  payments: { type: [PaymentSchema], default: [] },
  returnCredit: { type: Number, default: 0 },
  returnSubtotal: { type: Number, default: 0 },
  returnTax: { type: Number, default: 0 },
  supplierCredit: { type: Number, default: 0 },
  remainingAmount: { type: Number, default: 0 },
  paymentStatus: {
    type: String,
    enum: ['pending', 'partial', 'paid'],
    default: 'pending'
  },
  // ⭐ Added 'partial' to enum to prevent Mongoose validation crash on partial payments
  status: {
    type: String,
    enum: ['draft', 'generated', 'paid', 'partial'],
    default: 'draft'
  },
  notes: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isConsolidated: { type: Boolean, default: true },
  receiptCount: { type: Number, default: 0 }
}, { timestamps: true });

const GoodsReceiptSchema = new mongoose.Schema({
  receiptRequestIds: { type: [String], default: [] },
  grnNumber: { type: String, required: true, unique: true },
  purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
  poNumber: { type: String, required: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  supplierName: { type: String, required: true },
  supplierGST: { type: String, default: '' },
  receivedDate: { type: String, required: true },
  receivedBy: { type: String, default: '' },
  warehouse: { type: String, default: 'Main Warehouse' },
  items: [GRNItemSchema],
  notes: { type: String, default: '' },
  status: {
    type: String,
    enum: ['draft', 'completed', 'cancelled'],
    default: 'completed'
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  currency: { type: String, default: 'INR' },
  exchangeRate: { type: Number, default: 1 },
  subtotal: { type: Number, default: 0 },
  totalTax: { type: Number, default: 0 },
  chargesSubtotal: { type: Number, default: 0 },
  chargesTax: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },
  roundOff: { type: Number, default: 0 },
  freight: { type: ChargesSchema, default: () => ({}) },
  insurance: { type: ChargesSchema, default: () => ({}) },
  inventoryCharges: { type: ChargesSchema, default: () => ({}) },
  gstType: { type: String, enum: ['igst', 'cgst_sgst'], default: 'igst' },
  paidAmount: { type: Number, default: 0 },
  payments: { type: [PaymentSchema], default: [] },
  invoiceGenerated: { type: Boolean, default: false },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConsolidatedInvoice' },
  chargesApplied: { type: Boolean, default: false },
  consolidatedInvoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConsolidatedInvoice' }
}, { timestamps: true });

ConsolidatedInvoiceSchema.index({ poNumber: 1 });
ConsolidatedInvoiceSchema.index({ supplierId: 1 });
ConsolidatedInvoiceSchema.index({ invoiceDate: -1 });

GoodsReceiptSchema.index({ poNumber: 1 });
GoodsReceiptSchema.index({ receivedDate: -1 });
GoodsReceiptSchema.index({ supplierId: 1 });

module.exports = {
  GoodsReceipt: mongoose.models.GoodsReceipt || mongoose.model('GoodsReceipt', GoodsReceiptSchema),
  ConsolidatedInvoice: mongoose.models.ConsolidatedInvoice || mongoose.model('ConsolidatedInvoice', ConsolidatedInvoiceSchema)
};
