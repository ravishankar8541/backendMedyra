// models/Lead.js - COMPLETE FIXED VERSION

const mongoose = require('mongoose');

// ✅ LeadItemSchema with ALL required fields including incentive
const LeadItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  },
  productName: {
    type: String,
    default: ''
  },
  productSku: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  },
  sellingPrice: {
    type: Number,
    default: 0
  },
  rate: {
    type: Number,
    default: 0
  },
  costPrice: {
    type: Number,
    default: 0
  },
  quantity: {
    type: Number,
    default: 1
  },
  unit: {
    type: String,
    default: 'Vial'
  },
  totalValue: {
    type: Number,
    default: 0
  },
  total: {
    type: Number,
    default: 0
  },
  taxRate: {
    type: Number,
    default: 18
  },
  // ✅ Incentive fields per item
  profitAmount: {
    type: Number,
    default: 0
  },
  profitPercentage: {
    type: Number,
    default: 0
  },
  incentive: {
    type: Number,
    default: 0
  },
  batch: {
    type: String,
    default: ''
  },
  hsCode: {
    type: String,
    default: ''
  },
  mfgDate: {
    type: String,
    default: ''
  },
  expiryDate: {
    type: String,
    default: ''
  },
  countryOfOrigin: {
    type: String,
    default: 'India'
  }
});

// ✅ ProformaSchema - With incentive fields
const ProformaSchema = new mongoose.Schema({
  number: String,
  sentDate: Date,
  amount: Number,
  type: {
    type: String,
    enum: ['domestic', 'international'],
    default: 'domestic'
  },
  taxType: {
    type: String,
    enum: ['cgst_sgst', 'igst'],
    default: 'cgst_sgst'
  },
  poNumber: {
    type: String,
    default: ''
  },
  items: [LeadItemSchema],
  subtotal: Number,
  tax: Number,
  total: Number,
  validUntil: Date,
  paymentTerms: String,
  deliveryTerms: String,
  placeOfSupply: String,
  notes: String,
  terms: String,
  document: String,
  totalInWords: String,
  
  portOfLoading: String,
  portOfDischarge: String,
  destinationCountry: String,
  grossWeight: String,
  netWeight: String,
  volumetricWeight: String,
  countryOfOriginGoods: String,
  totalBoxes: String,
  shippingMark: String,
  vesselNo: String
});

// ✅ Main Lead Schema
const LeadSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  source: {
    type: String,
    enum: ['Website', 'Reference', 'Cold Call', 'Email', 'Social Media', 'Walk-in'],
    default: 'Website'
  },
  notes: {
    type: String,
    maxlength: 1000
  },

  address: {
    type: String,
    default: ''
  },
  gst: {
    type: String,
    default: ''
  },
  drugLicense: {
    type: String,
    default: ''
  },
  state: {
    type: String,
    default: ''
  },
  stateCode: {
    type: String,
    default: ''
  },
  country: {
    type: String,
    default: 'India'
  },

  status: {
    type: String,
    enum: [
      'new',
      'contacted',
      'qualified',
      'proforma_sent',
      'order_confirmed',
      'payment_pending',
      'converted',
      'lost'
    ],
    default: 'new'
  },

  // ✅ Array to support multiple proformas
  proformas: {
    type: [ProformaSchema],
    default: []
  },

  // ✅ Keep single proforma for current/latest
  proforma: ProformaSchema,

  quotation: {
    sentDate: Date,
    amount: Number,
    document: String,
    followUpDate: Date,
    notes: String
  },

  orderConfirmedAt: Date,

  payment: {
    status: {
      type: String,
      enum: ['pending', 'partial', 'paid', 'overdue'],
      default: 'pending'
    },
    amount: Number,
    method: {
      type: String,
      enum: ['advance', 'credit', 'cod', 'upi', 'neft', 'cheque', 'cash']
    },
    date: Date,
    reference: String,
    dueDate: Date,
    notes: String
  },

  items: {
    type: [LeadItemSchema],
    default: []
  },

  // ✅ Incentive tracking fields at lead level
  totalValue: {
    type: Number,
    default: 0
  },
  totalProfit: {
    type: Number,
    default: 0
  },
  totalIncentive: {
    type: Number,
    default: 0
  },

  value: { type: Number, default: 0 },
  profit: { type: Number, default: 0 },
  incentive: { type: Number, default: 0 },
  productName: { type: String, default: '' },
  productSku: { type: String, default: '' },
  quantity: { type: Number, default: 1 },

  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedToName: {
    type: String
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  date: {
    type: Date,
    default: Date.now
  },
  followUpDate: Date,
  followUpNotes: String,
  conversionDate: Date,
  lastContact: Date,

  statusHistory: [{
    status: String,
    date: { type: Date, default: Date.now },
    notes: String,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }]
}, {
  timestamps: true
});

// Indexes
LeadSchema.index({ name: 'text', phone: 'text', email: 'text' });
LeadSchema.index({ status: 1, assignedTo: 1 });
LeadSchema.index({ createdAt: -1 });

// ✅ FIXED: Pre-save middleware - Only auto-calculate if items exist and not skipped
LeadSchema.pre('save', function() {
  // ✅ Skip auto-calculation if flag is set (during conversion)
  if (this._skipAutoCalculate) {
    // Still add status history if status changed
    if (this.isModified('status')) {
      this.statusHistory.push({
        status: this.status,
        date: new Date(),
        notes: this.notes || `Status updated to ${this.status}`,
        updatedBy: this._updateBy || this.createdBy
      });
    }
    return;
  }

  // ✅ Only auto-calculate if items array has data
  if (this.items && this.items.length > 0) {
    let totalValue = 0;
    let totalProfit = 0;
    let totalIncentive = 0;
    let totalQuantity = 0;

    for (const item of this.items) {
      totalValue += Number(item.totalValue || 0);
      totalProfit += Number(item.profitAmount || 0);
      totalIncentive += Number(item.incentive || 0);
      totalQuantity += Number(item.quantity || 0);
    }

    this.totalValue = totalValue;
    this.totalProfit = totalProfit;
    this.totalIncentive = totalIncentive;
    this.value = totalValue;
    this.profit = totalProfit;
    this.incentive = totalIncentive;
    this.quantity = totalQuantity;
    
    if (this.items.length > 0) {
      this.productName = this.items[0].productName || '';
      this.productSku = this.items[0].productSku || '';
    }
  }

  // Add status history if status changed
  if (this.isModified('status')) {
    this.statusHistory.push({
      status: this.status,
      date: new Date(),
      notes: this.notes || `Status updated to ${this.status}`,
      updatedBy: this._updateBy || this.createdBy
    });
  }
});

module.exports = mongoose.model('Lead', LeadSchema);