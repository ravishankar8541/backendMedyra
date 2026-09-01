// models/Account.js
const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['asset', 'liability', 'equity', 'revenue', 'expense'],
    required: true
  },
  subType: {
    type: String,
    enum: [
      'current_asset', 'bank', 'cash', 'accounts_receivable', 'inventory', 'fixed_asset',
      'current_liability', 'accounts_payable', 'tax_payable', 'long_term_liability',
      'equity', 'retained_earnings',
      'operating_revenue', 'other_income',
      'cost_of_goods_sold', 'operating_expense', 'tax_expense', 'financial_expense'
    ],
    required: true
  },
  currency: {
    type: String,
    default: 'INR'
  },
  balance: {
    type: Number,
    default: 0
  },
  description: {
    type: String,
    default: ''
  },
  isSystem: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  parentAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

AccountSchema.index({ code: 1, type: 1 });
AccountSchema.index({ name: 'text' });

module.exports = mongoose.models.Account || mongoose.model('Account', AccountSchema);