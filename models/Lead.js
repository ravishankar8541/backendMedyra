// models/Lead.js - COMPLETE UPDATED VERSION WITH FREIGHT & METADATA
const mongoose = require('mongoose');

// ✅ LeadItemSchema - ITEMS ONLY
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

// ✅ ProformaSchema - INCLUDES ALL FREIGHT & METADATA FIELDS
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
  
  // ===== FREIGHT & METADATA FIELDS =====
  freight: {
    type: Number,
    default: 0
  },
  freightTaxRate: {
    type: Number,
    default: 18
  },
  freightQty: {
    type: Number,
    default: 1
  },
  freightTax: {
    type: Number,
    default: 0
  },
  insurance: {
  type: Number,
  default: 0
},
insuranceTaxRate: {
  type: Number,
  default: 18
},
insuranceQty: {
  type: Number,
  default: 1
},
insuranceTax: {
  type: Number,
  default: 0
},
  channel: {
    type: String,
    default: 'Domestic'
  },
  salesPerson: {
    type: String,
    default: ''
  },
  exchangeRate: {
    type: String,
    default: '1'
  },
  deliveryTime: {
    type: String,
    default: '15 Days'
  },

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
  vesselNo: String,
  convertedToInvoice: {
    type: Boolean,
    default: false
  },
  invoiceNumber: {
    type: String,
    default: ''
  },
  incentive: {
    type: Number,
    default: 0
  },
  profit: {
    type: Number,
    default: 0
  },
  conversionDate: {
    type: Date
  }
});

// ✅ MAIN LEAD SCHEMA
const LeadSchema = new mongoose.Schema({
  // ===== BASIC INFO =====
  name: {
    type: String,
    required: true,
    trim: true
  },
  companyName: {
    type: String,
    default: ''
  },
  contactPerson: {
    type: String,
    default: ''
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  alternativePhone: {
    type: String,
    default: ''
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  website: {
    type: String,
    default: ''
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

  // ===== ADDRESS =====
  address: {
    type: String,
    default: ''
  },
  city: {
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
  countryCode: {
    type: String,
    default: 'IN'
  },
  postalCode: {
    type: String,
    default: ''
  },

  // ===== TAX & REGISTRATION =====
  gst: {
    type: String,
    default: ''
  },
  drugLicense: {
    type: String,
    default: ''
  },
  ntfnNumber: {
    type: String,
    default: ''
  },
  businessType: {
    type: String,
    default: 'distributor'
  },

  // ===== BANK DETAILS =====
  bankName: {
    type: String,
    default: ''
  },
  accountTitle: {
    type: String,
    default: ''
  },
  accountNumber: {
    type: String,
    default: ''
  },
  branchCode: {
    type: String,
    default: ''
  },

  // ===== PAYMENT & CURRENCY =====
  paymentTerms: {
    type: String,
    default: 'net_30'
  },
  currency: {
    type: String,
    default: 'INR'
  },

  // ===== STATUS =====
  status: {
    type: String,
    enum: [
      'new', 'contacted', 'qualified', 'proforma_sent',
      'order_confirmed', 'payment_pending', 'converted', 'lost'
    ],
    default: 'new'
  },

  // ===== PROFORMAS =====
  proformas: {
    type: [ProformaSchema],
    default: []
  },
  proforma: ProformaSchema,

  // ===== QUOTATION =====
  quotation: {
    sentDate: Date,
    amount: Number,
    document: String,
    followUpDate: Date,
    notes: String
  },

  orderConfirmedAt: Date,

  // ===== PAYMENT =====
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

  // ===== ITEMS =====
  items: {
    type: [LeadItemSchema],
    default: []
  },

  // ===== INCENTIVE TRACKING =====
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

  // ===== ASSIGNMENT =====
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

  // ===== DATES =====
  date: {
    type: Date,
    default: Date.now
  },
  followUpDate: Date,
  followUpNotes: String,
  conversionDate: Date,
  lastContact: Date,

  // ===== STATUS HISTORY =====
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

// ===== INDEXES =====
LeadSchema.index({ name: 'text', phone: 'text', email: 'text' });
LeadSchema.index({ status: 1, assignedTo: 1 });
LeadSchema.index({ createdAt: -1 });

// ===== PRE-SAVE HOOK =====
LeadSchema.pre('save', function () {
  if (this._skipAutoCalculate === true) {
    if (this.isModified('status')) {
      this.statusHistory = this.statusHistory || [];
      this.statusHistory.push({
        status: this.status,
        date: new Date(),
        notes: this.notes || `Status updated to ${this.status}`,
        updatedBy: this._updateBy || this.createdBy
      });
    }
    return;
  }

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

  if (this.isModified('status')) {
    this.statusHistory = this.statusHistory || [];
    this.statusHistory.push({
      status: this.status,
      date: new Date(),
      notes: this.notes || `Status updated to ${this.status}`,
      updatedBy: this._updateBy || this.createdBy
    });
  }
});

module.exports = mongoose.model('Lead', LeadSchema);