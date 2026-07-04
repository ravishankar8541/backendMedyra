const mongoose = require('mongoose');

const PurchaseOrderItemSchema = new mongoose.Schema({
  product: {
    type: String,
    required: true
  },
  name: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  },
  sku: {
    type: String,
    default: ''
  },
  hsn: {
    type: String,
    default: ''
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unit: {
    type: String,
    default: 'Strips'
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  total: {
    type: Number,
    required: true
  }
});

const PurchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: {
      type: String,
      required: true,
      unique: true
    },

    supplier: {
      type: String,
      required: true
    },

    supplierName: {
      type: String,
      default: ''
    },

    supplierAddress: {
      type: String,
      default: 'N/A'
    },

    supplierGST: {
      type: String,
      default: 'N/A'
    },

    supplierContact: {
      type: String,
      default: 'N/A'
    },

    supplierEmail: {
      type: String,
      default: ''
    },

    ccEmail: {
      type: String,
      default: ''
    },

    emailSent: {
      type: Boolean,
      default: false
    },

    emailSentDate: {
      type: String,
      default: ''
    },

    date: {
      type: String,
      required: true
    },

    expectedDate: {
      type: String,
      required: true
    },

    deliveryDate: {
      type: String,
      default: ''
    },

    items: {
      type: [PurchaseOrderItemSchema],
      default: []
    },

    subtotal: {
      type: Number,
      required: true,
      default: 0
    },

    gstType: {
      type: String,
      enum: ['igst', 'cgst_sgst'],
      default: 'igst'
    },

    igst: {
      type: Number,
      default: 0
    },

    igstRate: {
      type: Number,
      default: 5
    },

    cgst: {
      type: Number,
      default: 0
    },

    cgstRate: {
      type: Number,
      default: 2.5
    },

    sgst: {
      type: Number,
      default: 0
    },

    sgstRate: {
      type: Number,
      default: 2.5
    },

    total: {
      type: Number,
      required: true,
      default: 0
    },

    status: {
      type: String,
      enum: ['pending', 'shipped', 'delivered', 'cancelled'],
      default: 'pending'
    },

    notes: {
      type: String,
      default: 'No notes'
    },

    createdFromAlert: {
      type: Boolean,
      default: false
    },

    alertId: {
      type: Number,
      default: null
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

// Indexes
PurchaseOrderSchema.index({ supplier: 'text' });
PurchaseOrderSchema.index({ status: 1 });
PurchaseOrderSchema.index({ createdAt: -1 });

module.exports = mongoose.models.PurchaseOrder || mongoose.model('PurchaseOrder', PurchaseOrderSchema);