const mongoose = require('mongoose');

const DeliverySchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  orderNumber: String,
  customer: {
    name: String,
    phone: String,
    address: String
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedDate: Date,
  pickupDate: Date,
  deliveryDate: Date,
  deliveryTime: String,
  status: {
    type: String,
    enum: ['assigned', 'picked_up', 'in_transit', 'delivered', 'delayed', 'failed'],
    default: 'assigned'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  distance: String,
  estimatedTime: String,
  delayReason: String,
  deliveryNote: String,
  proofImage: String,
  signature: String,
  trackingNumber: String,
  routeOptimized: Boolean,
  route: [{
    lat: Number,
    lng: Number,
    address: String,
    stopNumber: Number
  }],
  startedAt: Date,
  completedAt: Date,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Delivery', DeliverySchema);