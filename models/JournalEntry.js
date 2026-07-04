const mongoose = require('mongoose');

const JournalEntrySchema = new mongoose.Schema({
  voucherNo: {
    type: String,
    required: true,
    unique: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  description: {
    type: String,
    required: true
  },
  entries: [{
    account: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['debit', 'credit'],
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    description: String
  }],
  reference: String,
  status: {
    type: String,
    enum: ['draft', 'posted', 'cancelled'],
    default: 'draft'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  postedDate: Date,
  notes: String
}, {
  timestamps: true
});

// Generate voucher number
JournalEntrySchema.pre('save', function(next) {
  if (this.isNew && !this.voucherNo) {
    const count = Math.floor(Math.random() * 1000);
    this.voucherNo = `JV-${String(count).padStart(3, '0')}`;
  }
  next();
});

// Ensure entries balance
JournalEntrySchema.pre('save', function(next) {
  const totalDebit = this.entries
    .filter(e => e.type === 'debit')
    .reduce((sum, e) => sum + e.amount, 0);
  const totalCredit = this.entries
    .filter(e => e.type === 'credit')
    .reduce((sum, e) => sum + e.amount, 0);
  
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    next(new Error('Journal entries must balance (total debit = total credit)'));
  }
  next();
});

module.exports = mongoose.model('JournalEntry', JournalEntrySchema);