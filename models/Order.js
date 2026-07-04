const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: String,
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true
  },
  total: {
    type: Number,
    required: true
  }
});

const OrderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    required: true,
    unique: true
  },
  customer: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    alternatePhone: String,
    email: String,
    address: { type: String, required: true },
    landmark: String,
    city: String,
    pincode: String,
    state: String,
    country: String
  },
  items: [OrderItemSchema],
  subtotal: {
    type: Number,
    required: true
  },
  tax: {
    type: Number,
    default: 0
  },
  total: {
    type: Number,
    required: true
  },
  deliveryCharges: {
    type: Number,
    default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  paymentMethod: {
    type: String,
    enum: ['Cash', 'Card', 'Online', 'COD'],
    default: 'COD'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  orderStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'packed', 'shipped', 'in_transit', 'delivered', 'cancelled', 'returned'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedDate: Date,
  deliverySlot: String,
  distance: String,
  estimatedTime: String,
  delayReason: String,
  deliveredDate: Date,
  deliveredTime: String,
  deliveryNote: String,
  proofImage: String,
  trackingNumber: String,
  notes: String,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Generate order number
OrderSchema.pre('save', function(next) {
  if (this.isNew) {
    const year = new Date().getFullYear();
    const count = Math.floor(Math.random() * 10000);
    this.orderNumber = `ORD-${year}-${String(count).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('Order', OrderSchema);