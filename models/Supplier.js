const mongoose = require('mongoose');

const SupplierSchema = new mongoose.Schema({
  // ===== BASIC INFORMATION =====
  companyName: {
    type: String,
    required: true,
    trim: true
  },
  contactPerson: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  alternativePhone: {
    type: String,
    trim: true
  },
  website: {
    type: String,
    trim: true
  },

  // ===== ADDRESS =====
  address: {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    country: { type: String, default: 'Pakistan' },
    postalCode: { type: String, trim: true }
  },

  // ===== BUSINESS DETAILS =====
  businessType: {
    type: String,
    enum: ['manufacturer', 'distributor', 'wholesaler', 'retailer', 'importer', 'exporter'],
    default: 'distributor'
  },
  gstNumber: {
    type: String,
    trim: true
  },
  ntfnNumber: {
    type: String,
    trim: true
  },
  industry: {
    type: String,
    default: 'pharmaceutical'
  },

  // ===== BANK DETAILS =====
  bankName: {
    type: String,
    trim: true
  },
  accountTitle: {
    type: String,
    trim: true
  },
  accountNumber: {
    type: String,
    trim: true
  },
  branchCode: {
    type: String,
    trim: true
  },

  // ===== PAYMENT TERMS =====
  paymentTerms: {
    type: String,
    enum: ['net_15', 'net_30', 'net_45', 'net_60', 'cod', 'advance', 'letter_of_credit'],
    default: 'net_30'
  },
  currency: {
    type: String,
    default: 'PKR'
  },
  creditLimit: {
    type: Number,
    default: 0
  },
  taxRate: {
    type: Number,
    default: 0
  },
  discountRate: {
    type: Number,
    default: 0
  },
  deliveryTime: {
    type: String,
    default: '3-5 days'
  },

  // ===== STATUS =====
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending'],
    default: 'pending'
  },
  
  // ===== NOTES =====
  notes: {
    type: String,
    trim: true
  },

  // ===== TRACKING =====
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  totalOrders: {
    type: Number,
    default: 0
  },
  totalSpent: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// ===== INDEXES FOR SEARCH =====
SupplierSchema.index({ companyName: 'text', contactPerson: 'text', email: 'text' });
SupplierSchema.index({ status: 1 });
SupplierSchema.index({ businessType: 1 });

module.exports = mongoose.model('Supplier', SupplierSchema);