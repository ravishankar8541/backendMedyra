


// models/JournalEntry.js
const mongoose = require('mongoose');

const JournalLineSchema = new mongoose.Schema({
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true
  },
  accountCode: String,
  accountName: String,
  debit: {
    type: Number,
    default: 0,
    min: 0
  },
  credit: {
    type: Number,
    default: 0,
    min: 0
  },
  description: {
    type: String,
    default: ''
  },
  entityType: {
    type: String,
    enum: ['Customer', 'Supplier', 'User', 'Other'],
    default: 'Other'
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  }
}, { _id: true });

const JournalEntrySchema = new mongoose.Schema({
  entryNumber: {
    type: String,
    required: true,
    unique: true
  },
  voucherNo: {
    type: String,
    default: ''
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  referenceNumber: {
    type: String,
    default: ''
  },
  sourceModule: {
    type: String,
    enum: ['manual', 'sales_invoice', 'sales_return', 'purchase_invoice', 'purchase_return', 'payment_receipt', 'payment_disbursement', 'inventory_adjustment'],
    default: 'manual'
  },
  sourceId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  memo: {
    type: String,
    required: true,
    trim: true
  },
  lines: [JournalLineSchema],
  totalDebit: {
    type: Number,
    required: true,
    min: 0
  },
  totalCredit: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['draft', 'posted', 'void'],
    default: 'posted'
  },
  currency: {
    type: String,
    default: 'INR'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

JournalEntrySchema.index({ entryNumber: 1, date: -1 });
JournalEntrySchema.index({ 'lines.account': 1, date: -1 });

module.exports = mongoose.models.JournalEntry || mongoose.model('JournalEntry', JournalEntrySchema);
