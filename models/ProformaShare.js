const mongoose = require('mongoose');
module.exports = mongoose.models.ProformaShare || mongoose.model('ProformaShare', new mongoose.Schema({
  token: { type: String, unique: true, required: true },
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
  proformaNumber: { type: String, required: true },
  pdf: { type: Buffer, required: true, select: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true }));
