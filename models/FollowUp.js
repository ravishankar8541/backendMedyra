const mongoose = require('mongoose');

const FollowupSchema = new mongoose.Schema({
  customer: {
    type: String,
    required: [true, 'Customer name is required'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  date: {
    type: Date,
    required: [true, 'Follow-up date is required']
  },
  time: {
    type: String,
    required: [true, 'Time is required'],
    match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)']
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  notes: {
    type: String,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedToName: {
    type: String
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead'
  },
  completedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes
FollowupSchema.index({ date: 1, status: 1 });
FollowupSchema.index({ assignedTo: 1, date: 1 });
FollowupSchema.index({ priority: 1, status: 1 });

FollowupSchema.pre('save', async function () {
  if (this.status === 'completed' && !this.completedAt) {
    this.completedAt = new Date();
  }
});

module.exports = mongoose.model('Followup', FollowupSchema);