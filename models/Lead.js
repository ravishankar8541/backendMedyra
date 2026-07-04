const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema({
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
    enum: ['Website', 'Reference', 'Cold Call', 'Email', 'Social Media', 'Walk-in'],
    default: 'Website'
  },
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
  followUpDate: {
    type: Date
  },
  followUpNotes: String,
  conversionDate: Date,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastContact: Date
}, {
  timestamps: true
});

// Index for search
LeadSchema.index({ name: 'text', phone: 'text', email: 'text' });
LeadSchema.index({ status: 1, assignedTo: 1 });

module.exports = mongoose.model('Lead', LeadSchema);