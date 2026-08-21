// models/GoodsReceipt.js
const mongoose = require('mongoose');

const GRNItemSchema = new mongoose.Schema({
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

const GoodsReceiptSchema = new mongoose.Schema({
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
  
  // ===== FINANCIALS =====
  currency: { type: String, default: 'INR' },
  exchangeRate: { type: Number, default: 1 },
  subtotal: { type: Number, default: 0 },
  totalTax: { type: Number, default: 0 },
  chargesSubtotal: { type: Number, default: 0 },
  chargesTax: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },
  
  // ===== ADDITIONAL CHARGES =====
  freight: { type: ChargesSchema, default: () => ({}) },
  insurance: { type: ChargesSchema, default: () => ({}) },
  inventoryCharges: { type: ChargesSchema, default: () => ({}) },
  
  gstType: { type: String, enum: ['igst', 'cgst_sgst'], default: 'igst' },
  
  // ===== INVOICE TRACKING =====
  invoiceGenerated: { type: Boolean, default: false },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseInvoice' }
}, { timestamps: true });

GoodsReceiptSchema.index({ grnNumber: 1 });
GoodsReceiptSchema.index({ poNumber: 1 });
GoodsReceiptSchema.index({ receivedDate: -1 });
GoodsReceiptSchema.index({ supplierId: 1 });

module.exports = mongoose.models.GoodsReceipt || mongoose.model('GoodsReceipt', GoodsReceiptSchema);