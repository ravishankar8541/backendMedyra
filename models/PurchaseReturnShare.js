const mongoose = require('mongoose');

module.exports = mongoose.models.PurchaseReturnShare || mongoose.model('PurchaseReturnShare', new mongoose.Schema({
  token: { type: String, unique: true, required: true },
  purchaseReturn: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseReturn', required: true },
  debitNoteNumber: { type: String, required: true },
  pdf: { type: Buffer, required: true, select: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true }));
