const mongoose = require('mongoose');
module.exports = mongoose.models.InvoiceShare || mongoose.model('InvoiceShare', new mongoose.Schema({
  token: { type: String, unique: true, required: true },
  invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
  invoiceNumber: { type: String, required: true },
  pdf: { type: Buffer, required: true, select: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true }));
