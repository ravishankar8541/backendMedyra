const mongoose = require('mongoose');

module.exports = mongoose.models.PurchaseInvoiceShare || mongoose.model('PurchaseInvoiceShare', new mongoose.Schema({
  token: { type: String, unique: true, required: true },
  invoiceNumber: { type: String, required: true },
  pdf: { type: Buffer, required: true, select: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true }));
