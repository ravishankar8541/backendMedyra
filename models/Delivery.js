const mongoose = require('mongoose');

const DeliverySchema = new mongoose.Schema({
  deliveryNumber: {
    type: String,
    required: true,
    unique: true
  },
  orderId: {
    type: String,
    required: true,
    trim: true
  },
  invoiceNo: {
    type: String,
    default: ''
  },
  packageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Package',
    default: null
  },
  customer: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    country: { type: String, default: 'India' }
  },
  itemsSummary: {
    type: String,
    default: ''
  },
  totalBoxes: {
    type: Number,
    default: 1
  },
  totalWeight: {
    type: String,
    default: ''
  },
  driverName: {
    type: String,
    default: 'Self / Courier'
  },
  driverPhone: {
    type: String,
    default: ''
  },
  trackingNumber: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'out_for_delivery', 'delivered', 'failed', 'returned'],
    default: 'pending'
  },
  dispatchDate: {
    type: Date,
    default: Date.now
  },
  // "Pahuch Gaya" Confirmation Details
  deliveredAt: {
    type: Date,
    default: null
  },
  receivedBy: {
    type: String,
    default: ''
  },
  receiverPhone: {
    type: String,
    default: ''
  },
  deliveryNotes: {
    type: String,
    default: ''
  },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  proof: {
    name: String, mimeType: String, size: Number, uploadedAt: Date,
    data: { type: Buffer, select: false },
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, { timestamps: true });

DeliverySchema.index({ deliveryNumber: 1, orderId: 1, status: 1 });

module.exports = mongoose.models.Delivery || mongoose.model('Delivery', DeliverySchema);
