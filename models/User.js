// models/User.js - COMPLETE UPDATED WITH INCENTIVE TRACKING

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'accountant', 'sales'],
    default: 'sales'
  },
  phone: {
    type: String,
    required: true
  },
  department: String,
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending', 'suspended'],
    default: 'pending'
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  lastLogin: Date,
  dob: Date,
  address: {
    current: String,
    permanent: String
  },
  emergencyContact: {
    name: String,
    phone: String,
    relation: String
  },
  bankDetails: {
    accountNo: String,
    ifsc: String,
    bankName: String,
    name: String
  },
  profileImage: String,
  permissions: [String],
  accessVersion: Number,
  authVersion: { type: Number, default: 0 },
  passwordResetHash: { type: String, select: false },
  passwordResetExpires: { type: Date, select: false },
  passwordResetRequestedAt: { type: Date, select: false },
  accessUpdatedAt: Date,
  accessUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  forcePasswordChange: {
    type: Boolean,
    default: false
  },
  passwordChangedAt: Date,
  joinDate: {
    type: Date,
    default: Date.now
  },
  lastActivity: Date,
  loginHistory: [{
    date: Date,
    ip: String,
    device: String,
    location: String
  }],
  notifications: [{
    type: String,
    message: String,
    read: Boolean,
    date: Date
  }],

  // ============================================
  // ✅ INCENTIVE TRACKING FIELDS
  // ============================================
  totalIncentiveEarned: {
    type: Number,
    default: 0
  },
  totalSalesValue: {
    type: Number,
    default: 0
  },
  totalConversions: {
    type: Number,
    default: 0
  },
  totalProfitGenerated: {
    type: Number,
    default: 0
  },
  incentiveHistory: [{
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead'
    },
    leadName: {
      type: String
    },
    invoiceNumber: {
      type: String
    },
    amount: {
      type: Number,
      default: 0
    },
    value: {
      type: Number,
      default: 0
    },
    profit: {
      type: Number,
      default: 0
    },
    profitPercentage: {
      type: Number,
      default: 0
    },
    date: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['pending', 'credited', 'paid'],
      default: 'credited'
    }
  }]
}, {
  timestamps: true
});

// ✅ Password hashing middleware
UserSchema.pre('save', async function() {
  if (this.isModified('password')) {
    this.passwordResetHash = undefined;
    this.passwordResetExpires = undefined;
    if (!this.isNew) this.authVersion = (this.authVersion || 0) + 1;
    this.password = await bcrypt.hash(this.password, 12);
    this.passwordChangedAt = new Date();
  }
});

// Compare password method
UserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
