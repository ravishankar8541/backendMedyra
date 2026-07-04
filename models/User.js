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
    enum: ['admin', 'manager', 'accountant', 'telecaller', 'delivery_agent', 'staff'],
    default: 'staff'
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
  }]
}, {
  timestamps: true
});

// ✅ FIXED: Mongoose 8.x compatible - NO 'next' parameter
UserSchema.pre('save', function() {
  if (this.isModified('password')) {
    const salt = bcrypt.genSaltSync(12);
    this.password = bcrypt.hashSync(this.password, salt);
    this.passwordChangedAt = new Date();
  }
});

// Compare password method
UserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);