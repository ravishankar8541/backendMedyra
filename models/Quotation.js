// models/Quotation.js - FIXED VERSION

const mongoose = require('mongoose');

const QuotationItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  },
  productName: {
    type: String,
    required: true
  },
  description: String,
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unit: {
    type: String,
    default: 'Pcs'
  },
  rate: {
    type: Number,
    required: true,
    min: 0
  },
  taxRate: {
    type: Number,
    default: 18
  },
  total: {
    type: Number,
    required: true
  },
  batch: String,
  hsCode: String,
  mfgDate: String,
  expiryDate: String,
  countryOfOrigin: String
});

const QuotationSchema = new mongoose.Schema({
  quotationNumber: {
    type: String,
    required: true,
    unique: true
  },
  
  // Type: Domestic or International
  type: {
    type: String,
    enum: ['domestic', 'international'],
    default: 'domestic'
  },
  
  // Linked to Lead
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },
  
  customer: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: String,
    address: { type: String, required: true },
    gst: String,
    drugLicense: String,
    state: String,
    stateCode: String,
    country: String,
    taxId: String,
    passportNo: String
  },
  
  items: [QuotationItemSchema],
  
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
  
  // Quotation Status
  status: {
    type: String,
    enum: ['draft', 'sent', 'accepted', 'rejected', 'expired'],
    default: 'draft'
  },
  
  validUntil: {
    type: Date,
    required: true
  },
  
  // Payment & Delivery Terms
  paymentTerms: {
    type: String,
    default: '100% Advance'
  },
  deliveryTerms: {
    type: String,
    default: '3-5 working days after payment'
  },
  placeOfSupply: String,
  
  // International specific fields
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
  
  notes: String,
  terms: String,
  
  // Sent Details
  sentDate: Date,
  sentVia: {
    type: String,
    enum: ['email', 'whatsapp', 'sms', 'manual'],
    default: 'manual'
  },
  
  acceptedDate: Date,
  rejectedDate: Date,
  rejectionReason: String,
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // PDF
  pdfUrl: String,
  pdfGenerated: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// ============================================
// ✅ FIXED: Generate quotation number - Mongoose 8.x compatible
// ============================================
QuotationSchema.pre('save', function() {
  // ✅ No 'next' parameter needed in Mongoose 8.x
  if (this.isNew && !this.quotationNumber) {
    const year = new Date().getFullYear();
    const prefix = this.type === 'domestic' ? 'QT' : 'QTI';
    const count = Math.floor(Math.random() * 10000);
    this.quotationNumber = `${prefix}-${year}-${String(count).padStart(4, '0')}`;
  }
});

// Indexes - ✅ Fixed: Remove duplicate index
QuotationSchema.index({ leadId: 1 });
QuotationSchema.index({ quotationNumber: 1 }, { unique: true }); // ✅ Unique index
QuotationSchema.index({ status: 1 });
QuotationSchema.index({ createdAt: -1 });
QuotationSchema.index({ type: 1 });

module.exports = mongoose.model('Quotation', QuotationSchema);