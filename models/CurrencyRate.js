const mongoose = require('mongoose');

const CurrencyRateSchema = new mongoose.Schema({
  baseCurrency: {
    type: String,
    default: 'USD'
  },
  rates: {
    type: Map,
    of: Number
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  provider: String,
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient queries
CurrencyRateSchema.index({ timestamp: -1 });

// Static method to get latest rates
CurrencyRateSchema.statics.getLatest = async function() {
  return await this.findOne().sort({ timestamp: -1 });
};

// Instance method to check if rates are stale (> 1 hour old)
CurrencyRateSchema.methods.isStale = function() {
  const oneHour = 60 * 60 * 1000;
  return (new Date() - this.timestamp) > oneHour;
};

module.exports = mongoose.model('CurrencyRate', CurrencyRateSchema);