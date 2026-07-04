const mongoose = require('mongoose');

const PackageItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  },
  name: String,
  quantity: Number,
  batchNo: String,
  mfgDate: String,
  expDate: String
});

const PackageSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  orderId: {
    type: String,
    required: true
  },
  invoiceNo: String,
  performaInvoiceNo: String,
  boxNo: String,
  customerName: {
    type: String,
    required: true
  },
  customerPhone: String,
  customerAddress: {
    type: String,
    required: true
  },
  products: [PackageItemSchema],
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  fragile: {
    type: Boolean,
    default: false
  },
  requiresColdStorage: {
    type: Boolean,
    default: false
  },
  countryOfOrigin: {
    type: String,
    default: 'INDIA'
  },
  shippingMethod: {
    type: String,
    enum: ['Air Freight', 'Sea Freight', 'Road Transport', 'Rail Transport'],
    default: 'Air Freight'
  },
  transportMode: String,
  vehicleNo: String,
  lrNo: String,
  lrDate: Date,
  placeOfSupply: String,
  gstNo: String,
  stateCode: String,
  bankName: String,
  bankAccount: String,
  bankIfsc: String,
  bankBranch: String,
  packageWeight: String,
  grossWeight: String,
  packageDimensions: {
    length: String,
    width: String,
    height: String
  },
  assignedTo: String,
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'shipped'],
    default: 'pending'
  },
  labelGenerated: {
    type: Boolean,
    default: false
  },
  packingSlipGenerated: {
    type: Boolean,
    default: false
  },
  packingSlipGeneratedAt: Date,
  notes: String,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  completedDate: Date
}, {
  timestamps: true
});

module.exports = mongoose.model('Package', PackageSchema);