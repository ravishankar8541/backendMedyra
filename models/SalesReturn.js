const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  returnNumber: { type: String, required: true, unique: true },
  requestId: { type: String, required: true, unique: true },
  requestHash: String,
  shareToken: { type: String, select: false, index: true, unique: true, sparse: true },
  invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
  invoiceNumber: String,
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  customer: mongoose.Schema.Types.Mixed,
  company: mongoose.Schema.Types.Mixed,
  currency: String,
  exchangeRate: Number,
  taxType: String,
  returnDate: { type: String, required: true },
  reason: { type: String, required: true },
  items: [{
    invoiceItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    stockBatchId: mongoose.Schema.Types.ObjectId,
    productName: String, batchNumber: String, unit: String, hsn: String,
    mfgDate: String, expiryDate: String,
    quantity: Number, unitPrice: Number, taxRate: Number,
    subtotal: Number, tax: Number, total: Number, costPrice: Number,
    restock: { type: Boolean, default: true }
  }],
  subtotal: Number, totalTax: Number, roundOff: Number, total: Number,
  status: { type: String, enum: ['posted', 'cancelled'], default: 'posted' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cancelledAt: Date, cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cancellationReason: String
}, { timestamps: true });
module.exports = mongoose.models.SalesReturn || mongoose.model('SalesReturn', schema);
