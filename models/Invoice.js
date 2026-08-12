// models/Invoice.js - FULL UPDATED VERSION WITH FREIGHT, INSURANCE & PAYMENT TRACKING
const mongoose = require('mongoose');

const InvoiceItemSchema = new mongoose.Schema({
  description: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unit: String,
  rate: {
    type: Number,
    required: true,
    min: 0
  },
  taxRate: {
    type: Number,
    default: 0
  },
  amount: {
    type: Number,
    required: true
  },
  batch: String,
  hsCode: String,
  mfgDate: String,
  expiryDate: String,
  freight: {
    type: Boolean,
    default: false
  },
  countryOfOrigin: String,

  // Incentive fields per item
  costPrice: {
    type: Number,
    default: 0
  },
  sellingPrice: {
    type: Number,
    default: 0
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
  }
});

// Payment / Installment Log Schema
const PaymentLogSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  method: {
    type: String,
    enum: ['advance', 'cash', 'neft', 'upi', 'cheque', 'bank_transfer', 'card', 'other'],
    default: 'bank_transfer'
  },
  reference: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  receivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

const InvoiceSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    required: true,
    unique: true
  },
  proformaNumber: {
    type: String,
    default: ''
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead'
  },
  type: {
    type: String,
    enum: ['domestic', 'international'],
    default: 'domestic'
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  dueDate: {
    type: Date,
    required: true
  },
  poNumber: String,
  placeOfSupply: String,
  paymentTerms: {
    type: String,
    default: '100% Advance'
  },
  currency: {
    type: String,
    default: 'INR'
  },
  exchangeRate: {
    type: Number,
    default: 1
  },
  customer: {
    name: { type: String, required: true },
    phone: String,
    email: String,
    address: { type: String, required: true },
    country: String,
    gst: String,
    drugLicense: String,
    state: String,
    stateCode: String,
    taxId: String,
    passportNo: String,
    countryOfOrigin: String
  },
  items: [InvoiceItemSchema],
  subtotal: {
    type: Number,
    required: true
  },
  tax: {
    type: Number,
    default: 0
  },
  total: {
    type: Number,
    required: true
  },
  rounding: {
    type: Number,
    default: 0
  },
  totalInWords: String,
  notes: String,
  terms: String,

  // ===== FREIGHT & INSURANCE (copied from proforma) =====
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

  // ===== PAYMENT & INSTALLMENT TRACKING =====
  status: {
    type: String,
    enum: ['draft', 'sent', 'paid', 'overdue', 'cancelled'],
    default: 'draft'
  },
  paidAmount: {
    type: Number,
    default: 0
  },
  dueAmount: {
    type: Number,
    default: 0
  },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'partially_paid', 'paid'],
    default: 'unpaid'
  },
  payments: [PaymentLogSchema],

  paymentDate: Date,
  paymentMethod: String,
  paymentReference: String,

  // International fields
  portOfLoading: String,
  portOfDischarge: String,
  shippingMark: String,
  vesselNo: String,
  billOfLading: String,
  letterOfCredit: String,
  destinationCountry: String,
  grossWeight: String,
  netWeight: String,
  volumetricWeight: String,
  countryOfOriginGoods: String,
  totalBoxes: String,

  // Company details
  company: {
    name: String,
    address: String,
    gstin: String,
    drugLicenses: [String],
    email: String,
    phone: String,
    pan: String,
    cin: String
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },

  // Incentive tracking fields
  incentive: {
    type: Number,
    default: 0
  },
  profit: {
    type: Number,
    default: 0
  },
  profitPercentage: {
    type: Number,
    default: 0
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedToName: {
    type: String,
    default: ''
  },
  totalValue: {
    type: Number,
    default: 0
  },
  totalCost: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Pre-save hook
InvoiceSchema.pre('save', function () {
  if (this.isNew && !this.invoiceNumber) {
    const year = new Date().getFullYear();
    const count = Math.floor(Math.random() * 1000);
    this.invoiceNumber = `MPDMS${year}/${String(count).padStart(3, '0')}`;
  }

  // Auto calculate dueAmount if not set
  if (this.dueAmount === undefined || this.dueAmount === null) {
    this.dueAmount = Math.max(0, Math.round((this.total - (this.paidAmount || 0)) * 100) / 100);
  }
});

module.exports = mongoose.model('Invoice', InvoiceSchema);