const mongoose = require('mongoose');

const CallLogSchema = new mongoose.Schema({
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },
  leadName: {
    type: String,
    required: true
  },
  leadPhone: {
    type: String,
    required: true
  },
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  agentName: {
    type: String
  },
  date: {
    type: Date,
    default: Date.now
  },
  duration: {
    type: Number,
    default: 0
  },
  type: {
    type: String,
    enum: ['incoming', 'outgoing'],
    default: 'outgoing'
  },
  status: {
    type: String,
    enum: ['completed', 'missed', 'busy', 'no_answer'],
    default: 'completed'
  },
  notes: String,
  recording: String,
  outcome: {
    type: String,
    enum: ['connected', 'not_connected', 'voicemail', 'callback_requested', 'not_interested'],
    default: 'connected'
  }
}, {
  timestamps: true
});

CallLogSchema.index({ lead: 1, agent: 1 });
CallLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CallLog', CallLogSchema);