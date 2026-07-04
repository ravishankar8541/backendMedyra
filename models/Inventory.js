const mongoose = require('mongoose');

const InventorySchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  warehouse: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    default: 0
  },
  reserved: {
    type: Number,
    default: 0
  },
  minStock: {
    type: Number,
    default: 0
  },
  maxStock: Number,
  reorderLevel: Number,
  reorderQuantity: Number,
  lastRestocked: Date,
  movements: [{
    type: {
      type: String,
      enum: ['in', 'out', 'adjustment']
    },
    quantity: Number,
    reason: String,
    date: {
      type: Date,
      default: Date.now
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reference: String
  }]
}, {
  timestamps: true
});

InventorySchema.index({ product: 1, warehouse: 1 }, { unique: true });

module.exports = mongoose.model('Inventory', InventorySchema);