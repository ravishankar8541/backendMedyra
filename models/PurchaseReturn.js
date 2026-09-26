// models/PurchaseReturn.js
const mongoose = require('mongoose');

const PurchaseReturnItemSchema = new mongoose.Schema({
  invoiceItemId: mongoose.Schema.Types.ObjectId,
  grnId: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt' },
  stockBatchId: mongoose.Schema.Types.ObjectId,
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  batchNumber: {
    type: String,
    default: 'N/A'
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
    min: 0
  },
  replacedQty: {
    type: Number,
    default: 0
  },
  unit: {
    type: String,
    default: 'Pcs'
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  // Snapshot in inventory currency (INR); absent on legacy returns.
  mrp: { type: Number, min: 0 },
  taxRate: {
    type: Number,
    default: 0
  },
  total: {
    type: Number,
    required: true
  },
  totalWithTax: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    default: 'Return to supplier'
  }
});

const ReplacementHistorySchema = new mongoose.Schema({
  receivedDate: {
    type: String,
    default: () => new Date().toISOString().slice(0, 10)
  },
  receivedBy: {
    type: String,
    default: 'System'
  },
  notes: {
    type: String,
    default: ''
  },
  items: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      productName: String,
      quantity: Number,
      batchNumber: String,
      mrp: { type: Number, min: 0 },
      mfgDate: String,
      expDate: String,
      unit: String
    }
  ]
}, { timestamps: true });

const PurchaseReturnSchema = new mongoose.Schema(
  {
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'ConsolidatedInvoice' },
    invoiceNumber: String,
    requestId: { type: String },
    requestHash: String,
    roundOff: { type: Number, default: 0 },
    cancelledAt: Date,
    cancelledBy: String,
    cancellationReason: String,
    returnNumber: {
      type: String,
      required: true,
      unique: true
    },
    poNumber: {
      type: String,
      default: 'N/A'
    },
    purchaseOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseOrder',
      default: null
    },
    supplier: {
      type: String,
      required: true
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
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
    returnDate: {
      type: String,
      required: true
    },
    items: {
      type: [PurchaseReturnItemSchema],
      default: []
    },
    replacementStatus: {
      type: String,
      enum: ['none', 'pending', 'partial', 'received'],
      default: 'pending'
    },
    replacementHistory: {
      type: [ReplacementHistorySchema],
      default: []
    },
    currency: {
      type: String,
      default: 'INR'
    },
    exchangeRate: {
      type: Number,
      default: 1
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
    totalTax: {
      type: Number,
      default: 0
    },
    igst: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    total: {
      type: Number,
      required: true,
      default: 0
    },
    returnReason: {
      type: String,
      default: 'Stock return'
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'cancelled'],
      default: 'completed'
    },
    notes: {
      type: String,
      default: ''
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

PurchaseReturnSchema.index({ requestId: 1 }, { unique: true, sparse: true });
PurchaseReturnSchema.index({ invoice: 1, status: 1 });

module.exports = mongoose.models.PurchaseReturn || mongoose.model('PurchaseReturn', PurchaseReturnSchema);