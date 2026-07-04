const mongoose = require('mongoose');

const RevenueSchema = new mongoose.Schema({
  period: {
    type: String,
    enum: ['monthly', 'quarterly', 'yearly'],
    required: true
  },
  periodKey: {
    type: String,
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  revenue: {
    type: Number,
    default: 0,
    min: [0, 'Revenue cannot be negative']
  },
  target: {
    type: Number,
    default: 0,
    min: [0, 'Target cannot be negative']
  },
  leads: {
    type: Number,
    default: 0
  },
  converted: {
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
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Compound unique index
RevenueSchema.index({ period: 1, periodKey: 1, year: 1, assignedTo: 1 }, { unique: true });

// Static method to calculate incentive
RevenueSchema.statics.calculateIncentive = function(revenue, profitPercentage) {
  if (profitPercentage < 10) return 0;
  
  if (profitPercentage >= 10 && profitPercentage < 15) {
    return revenue * 0.004;
  } else if (profitPercentage >= 15 && profitPercentage < 20) {
    return revenue * 0.0125;
  } else if (profitPercentage >= 20 && profitPercentage < 25) {
    return revenue * 0.0165;
  } else if (profitPercentage >= 25 && profitPercentage < 35) {
    return revenue * 0.0185;
  } else if (profitPercentage >= 35) {
    return revenue * 0.02;
  }
  return 0;
};

module.exports = mongoose.model('Revenue', RevenueSchema);