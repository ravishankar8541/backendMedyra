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

    status: {
      type: String,
      enum: ['new', 'contacted', 'qualified', 'converted', 'lost'],
      default: 'new'
    },

    source: {
      type: String,
      enum: [
        'Website',
        'Reference',
        'Cold Call',
        'Email',
        'Social Media',
        'Walk-in'
      ],
      default: 'Website'
    },

    // Multiple products
    items: {
      type: [LeadItemSchema],
      default: []
    },

    // Totals
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

    // Legacy fields
    value: {
      type: Number,
      default: 0
    },

    profit: {
      type: Number,
      default: 0
    },

    incentive: {
      type: Number,
      default: 0
    },

    productName: {
      type: String,
      default: ''
    },

    productSku: {
      type: String,
      default: ''
    },

    quantity: {
      type: Number,
      default: 1
    },

    notes: {
      type: String,
      maxlength: 1000
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },

    assignedToName: {
      type: String
    },

    date: {
      type: Date,
      default: Date.now
    },

    followUpDate: Date,

    followUpNotes: String,

    conversionDate: Date,

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },

    lastContact: Date
  },
  {
    timestamps: true
  }
);

// Indexes
LeadSchema.index({
  name: 'text',
  phone: 'text',
  email: 'text'
});

LeadSchema.index({
  status: 1,
  assignedTo: 1
});

// ===============================
// PRE SAVE MIDDLEWARE
// ===============================
LeadSchema.pre('save', function () {

  if (!this.items || this.items.length === 0) {
    this.totalValue = 0;
    this.totalProfit = 0;
    this.totalIncentive = 0;

    this.value = 0;
    this.profit = 0;
    this.incentive = 0;

    this.productName = '';
    this.productSku = '';
    this.quantity = 1;

    return;
  }

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

  // Legacy fields
  this.value = totalValue;
  this.profit = totalProfit;
  this.incentive = totalIncentive;

  this.productName = this.items[0]?.productName || '';
  this.productSku = this.items[0]?.productSku || '';
  this.quantity = totalQuantity;
});

module.exports = mongoose.model('Lead', LeadSchema);