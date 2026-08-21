// models/PurchaseInvoice.js
const mongoose = require('mongoose');

const InvoiceItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productName: { type: String, required: true },
  sku: { type: String, default: '' },
  hsn: { type: String, default: '' },
  unit: { type: String, default: 'Strips' },
  orderedQty: { type: Number, default: 0 },
  receivedQty: { type: Number, default: 0 },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, default: 0 },
  taxRate: { type: Number, default: 0 },
  subtotal: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  totalWithTax: { type: Number, default: 0 },
  batchNumber: { type: String, default: 'N/A' }
});

const PaymentSchema = new mongoose.Schema({
  date: { type: String, required: true },
  amount: { type: Number, required: true },
  method: { type: String, enum: ['cash', 'bank', 'cheque', 'online', 'adjustment'], default: 'bank' },
  reference: { type: String, default: '' },
  notes: { type: String, default: '' },
  receivedBy: { type: String, default: '' }
}, { _id: true });

const PurchaseInvoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  grnId: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt', required: true },
  grnNumber: { type: String, required: true },
  purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
  poNumber: { type: String },
  
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  supplierName: { type: String, required: true },
  supplierGST: { type: String, default: '' },
  
  invoiceDate: { type: String, required: true },
  dueDate: { type: String, required: true },
  
  items: [InvoiceItemSchema],
  
  // ===== FINANCIALS =====
  subtotal: { type: Number, default: 0 },
  totalTax: { type: Number, default: 0 },
  chargesSubtotal: { type: Number, default: 0 },
  chargesTax: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },
  
  // ===== PAYMENT TRACKING =====
  paidAmount: { type: Number, default: 0 },
  remainingAmount: { type: Number, default: 0 },
  paymentStatus: { 
    type: String, 
    enum: ['pending', 'partial', 'paid', 'overdue'], 
    default: 'pending' 
  },
  payments: [PaymentSchema],
  
  // ===== ADDITIONAL CHARGES =====
  freight: { type: Object, default: { amount: 0, taxRate: 0, taxAmount: 0 } },
  insurance: { type: Object, default: { amount: 0, taxRate: 0, taxAmount: 0 } },
  inventoryCharges: { type: Object, default: { amount: 0, taxRate: 0, taxAmount: 0 } },
  
  currency: { type: String, default: 'INR' },
  exchangeRate: { type: Number, default: 1 },
  gstType: { type: String, enum: ['igst', 'cgst_sgst'], default: 'igst' },
  
  paymentTerms: { type: String, default: 'net_30' },
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'paid', 'cancelled'], 
    default: 'pending' 
  },
  notes: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

PurchaseInvoiceSchema.index({ invoiceNumber: 1 });
PurchaseInvoiceSchema.index({ grnId: 1 });
PurchaseInvoiceSchema.index({ supplierId: 1 });
PurchaseInvoiceSchema.index({ dueDate: 1 });
PurchaseInvoiceSchema.index({ paymentStatus: 1 });

module.exports = mongoose.models.PurchaseInvoice || mongoose.model('PurchaseInvoice', PurchaseInvoiceSchema);