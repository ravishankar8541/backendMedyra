const mongoose = require('mongoose');

const PriceListItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: { type: String, default: '' },
  sku: { type: String, default: '' },
  hsn: { type: String, default: '' },
  unit: { type: String, default: 'Pcs' },
  costPrice: { type: Number, required: true, min: 0 },
  defaultQty: { type: Number, default: 1, min: 1 },
  batchNumber: { type: String, default: '' },
  isBatchProduct: { type: Boolean, default: true },
  notes: { type: String, default: '' }
}, { _id: true });

const VendorPriceListSchema = new mongoose.Schema({
  supplierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true,
    unique: true
  },
  supplierName: { type: String, default: '' },
  items: { type: [PriceListItemSchema], default: [] },
  notes: { type: String, default: '' },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

VendorPriceListSchema.index({ supplierId: 1 });
VendorPriceListSchema.index({ 'items.productId': 1 });

module.exports =
  mongoose.models.VendorPriceList ||
  mongoose.model('VendorPriceList', VendorPriceListSchema);