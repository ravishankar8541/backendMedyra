const mongoose = require('mongoose');

const ClientPriceListItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: { type: String, default: '' },
  sku: { type: String, default: '' },
  hsn: { type: String, default: '' },
  unit: { type: String, default: 'Pcs' },
  sellingPrice: { type: Number, required: true, min: 0 },
  defaultQty: { type: Number, default: 1, min: 1 },
  batchNumber: { type: String, default: '' },
  isBatchProduct: { type: Boolean, default: true },
  taxRate: { type: Number, default: 5 },
  notes: { type: String, default: '' }
}, { _id: true });

const ClientPriceListSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true,
    unique: true
  },
  clientName: { type: String, default: '' },
  currency: { type: String, default: 'INR' },
  items: { type: [ClientPriceListItemSchema], default: [] },
  notes: { type: String, default: '' },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

ClientPriceListSchema.index({ clientId: 1 });
ClientPriceListSchema.index({ 'items.productId': 1 });

module.exports =
  mongoose.models.ClientPriceList ||
  mongoose.model('ClientPriceList', ClientPriceListSchema);