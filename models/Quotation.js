// models/Quotation.js - COMPLETE FIXED VERSION WITH ALL FIELDS

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
  countryOfOrigin: String,
  // ✅ Extra fields for better tracking
  sellingPrice: {
    type: Number,
    default: 0
  },
  costPrice: {
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
  
  // ============================================
  // ✅ FREIGHT FIELDS - ADDED
  // ============================================
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
  freightDescription: {
    type: String,
    default: 'Transportation & logistics'
  },
  
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
  
  // Exchange Rate (for international)
  exchangeRate: {
    type: String,
    default: '1'
  },
  currency: {
    type: String,
    default: 'INR'
  },
  
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
  
  // Incentive & Profit Tracking
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
  totalValue: {
    type: Number,
    default: 0
  },
  totalCost: {
    type: Number,
    default: 0
  },
  
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
// ✅ PRE-SAVE HOOK: Calculate totals with freight
// ============================================
QuotationSchema.pre('save', function(next) {
  // Generate quotation number if new
  if (this.isNew && !this.quotationNumber) {
    const year = new Date().getFullYear();
    const prefix = this.type === 'domestic' ? 'QT' : 'QTI';
    const count = Math.floor(Math.random() * 10000);
    this.quotationNumber = `${prefix}-${year}-${String(count).padStart(4, '0')}`;
  }

  // ✅ Calculate freight tax
  if (this.freight && this.freight > 0) {
    const freightTaxRate = this.freightTaxRate || 18;
    this.freightTax = (this.freight * freightTaxRate) / 100;
  } else {
    this.freightTax = 0;
  }

  // ✅ Recalculate totals with freight
  if (this.items && this.items.length > 0) {
    let subtotal = 0;
    let totalTax = 0;
    let totalIncentive = 0;
    let totalProfit = 0;
    let totalValue = 0;
    let totalCost = 0;

    this.items.forEach(item => {
      const qty = item.quantity || 1;
      const rate = item.rate || 0;
      const taxRate = item.taxRate || 0;
      const itemTotal = qty * rate;
      
      subtotal += itemTotal;
      totalTax += (itemTotal * taxRate) / 100;
      
      // Calculate profit if costPrice available
      if (item.costPrice) {
        const cost = item.costPrice * qty;
        const profit = itemTotal - cost;
        totalProfit += profit;
        totalCost += cost;
        item.profitAmount = profit;
        item.profitPercentage = cost > 0 ? (profit / cost) * 100 : 0;
      }
      
      totalValue += itemTotal;
      totalIncentive += item.incentive || 0;
    });

    // Add freight and freight tax
    const freight = this.freight || 0;
    const freightTax = this.freightTax || 0;
    
    this.subtotal = subtotal;
    this.tax = totalTax + freightTax;
    this.total = subtotal + this.tax + freight;
    this.totalValue = totalValue + freight;
    this.incentive = totalIncentive;
    this.profit = totalProfit;
    this.profitPercentage = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
    this.totalCost = totalCost;
  }

 
});

// ============================================
// ✅ INDEXES
// ============================================
QuotationSchema.index({ leadId: 1 });
QuotationSchema.index({ quotationNumber: 1 }, { unique: true });
QuotationSchema.index({ status: 1 });
QuotationSchema.index({ createdAt: -1 });
QuotationSchema.index({ type: 1 });
QuotationSchema.index({ 'customer.name': 'text' });

module.exports = mongoose.model('Quotation', QuotationSchema);