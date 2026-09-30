const mongoose = require('mongoose');
module.exports = mongoose.models.PackageShare || mongoose.model('PackageShare', new mongoose.Schema({
  token: { type: String, unique: true, required: true },
  package: { type: mongoose.Schema.Types.ObjectId, ref: 'Package', required: true },
  orderId: { type: String, required: true },
  pdf: { type: Buffer, required: true, select: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true }));
