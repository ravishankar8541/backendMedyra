// models/Lead.js - COMPLETE UPDATED VERSION

const mongoose = require('mongoose');

// Lead Item Schema
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
  sellingPrice: {
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
  totalValue: {
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

const LeadSchema = new mongoose.Schema(
  {
    // Basic Info
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

    // ✅ COMPLETE STATUS FLOW
    status: {
      type: String,
      enum: [
        'new',              // Just added by telecaller
        'contacted',        // First call done
        'qualified',        // Interested, need quotation
        'quotation_sent',   // Quotation/Proforma sent
        'order_confirmed',  // Customer agreed to buy
        'payment_pending',  // Waiting for payment
        'converted',        // Payment received
        'sent',             // Invoice sent to customer
        'packed',           // Packed order in warehouse
        'in_transit',       // Order in transit
        'delivered',        // Order delivered
        'completed',        // Order completed & reported
        'lost'              // Lost deal
      ],
      default: 'new'
    },

    // ✅ Quotation Details
    quotation: {
      sentDate: Date,
      amount: Number,
      document: String,
      followUpDate: Date,
      notes: String
    },

    // ✅ Order Confirmation
    orderConfirmedAt: Date,

    // ✅ Payment Tracking
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

    // ✅ Products
    items: {
      type: [LeadItemSchema],
      default: []
    },

    // ✅ Totals
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

    // Legacy fields (for backward compatibility)
    value: { type: Number, default: 0 },
    profit: { type: Number, default: 0 },
    incentive: { type: Number, default: 0 },
    productName: { type: String, default: '' },
    productSku: { type: String, default: '' },
    quantity: { type: Number, default: 1 },

    // Assignment
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

    // Dates
    date: {
      type: Date,
      default: Date.now
    },
    followUpDate: Date,
    followUpNotes: String,
    conversionDate: Date,
    lastContact: Date,

    // ✅ Status History (for tracking)
    statusHistory: [{
      status: String,
      date: { type: Date, default: Date.now },
      notes: String,
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    }]
  },
  {
    timestamps: true
  }
);

// Indexes
LeadSchema.index({ name: 'text', phone: 'text', email: 'text' });
LeadSchema.index({ status: 1, assignedTo: 1 });
LeadSchema.index({ createdAt: -1 });

// ===============================
// PRE SAVE MIDDLEWARE
// ===============================
LeadSchema.pre('save', function() {
  // Calculate totals from items
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
    this.productName = this.items[0]?.productName || '';
    this.productSku = this.items[0]?.productSku || '';
    this.quantity = totalQuantity;
  }

  // ✅ Add status history if status changed
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