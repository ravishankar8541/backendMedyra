const mongoose = require('mongoose');

// Helper to convert empty strings or invalid IDs to null
const toObjectIdOrNull = (v) => {
  if (!v || v === '' || typeof v !== 'string' || v.length !== 24) return null;
  return mongoose.Types.ObjectId.isValid(v) ? v : null;
};

// Individual Medicine Item Schema
const PackageProductSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    default: null,
    set: toObjectIdOrNull
  },
  name: { 
    type: String, 
    required: true,
    trim: true 
  }, // e.g. "AMBILON - 50"
  description: { 
    type: String, 
    default: ''
  }, // e.g. "Amphotericin - 50 mg Liposomal Injection"
  quantity: { 
    type: String, 
    default: '1' 
  },
  packing: { 
    type: String, 
    default: '10*10' 
  }, // e.g. "5*10", "10*10", "1*100", "30*10", "20*4", "1*36", "2*42+30"
  batchNo: { 
    type: String, 
    default: ''
  },
  mfgDate: { 
    type: String, 
    default: ''
  }, // e.g. "Dec-25"
  expDate: { 
    type: String, 
    default: ''
  }, // e.g. "Nov-27"
  grossWeight: { 
    type: String, 
    default: ''
  }, // e.g. "9.5"
  manufacturer: { 
    type: String, 
    default: 'Medyra Pharmaceuticals Pvt Ltd' 
  },
  mfgAddress: { 
    type: String, 
    default: 'Bawana Industrial Area, Delhi-110039, India' 
  },
  mfgLicNo: { 
    type: String, 
    default: ''
  },
  hsn: { 
    type: String, 
    default: '3004' 
  },
  rate: { 
    type: Number, 
    default: 0 
  },
  amount: { 
    type: Number, 
    default: 0 
  }
});

// Single Carton / S.No. Breakdown Schema
const SingleBoxSchema = new mongoose.Schema({
  boxIndex: { 
    type: Number, 
    default: 1 
  },
  boxNumber: { 
    type: String, 
    required: true 
  }, // Carton S.No. e.g. "1", "2", "3"
  totalBoxes: { 
    type: Number, 
    default: 1 
  },
  netWeight: { 
    type: String, 
    default: ''
  },
  grossWeight: { 
    type: String, 
    default: ''
  }, // Carton total gross weight e.g. "9.5", "12.3"
  dimension: { 
    type: String, 
    default: '57*38*39' 
  }, // Dimension in cm
  items: [PackageProductSchema]
});

const PackageSchema = new mongoose.Schema({
  orderId: {
    type: String,
    required: true,
    trim: true
  },
  invoiceNo: { 
    type: String, 
    default: ''
  },
  invoiceDate: { 
    type: String, 
    default: ''
  },
  performaInvoiceNo: { 
    type: String, 
    default: ''
  },
  buyerReference: { 
    type: String, 
    default: ''
  },
  countryOfOrigin: { 
    type: String, 
    default: 'INDIA' 
  },
  ieCode: { 
    type: String, 
    default: 'BLQPR8835Q' 
  },
  drugLicNo: { 
    type: String, 
    default: 'DL-ROH-143605' 
  },
  gstNo: { 
    type: String, 
    default: '07BLQPR8835Q2ZR' 
  },
  destinationCountry: { 
    type: String, 
    default: ''
  },
  destination: { 
    type: String, 
    default: ''
  },

  // Export Header Summaries
  totalVolumetricWeight: { 
    type: String, 
    default: ''
  },
  totalNetWeight: { 
    type: String, 
    default: ''
  },
  totalGrossWeight: { 
    type: String, 
    default: ''
  },
  totalBoxesCount: { 
    type: Number, 
    default: 1 
  },
  boxDimension: { 
    type: String, 
    default: '57*38*39' 
  },
  coldChainBoxes: { 
    type: String, 
    default: ''
  },
  boxNo: { 
    type: String, 
    default: '1/1' 
  },

  // Consignee & Notify Party
  customerName: { 
    type: String, 
    required: true 
  },
  customerAddress: { 
    type: String, 
    required: true 
  },
  customerPhone: { 
    type: String, 
    default: ''
  },
  notifyParty: {
    type: String,
    default: ''
  },

  // Packaging Mode & Boxes
  packingType: {
    type: String,
    enum: ['single_box', 'identical_boxes', 'custom_boxes'],
    default: 'custom_boxes'
  },
  boxes: {
    type: [SingleBoxSchema],
    default: []
  },
  products: {
    type: [PackageProductSchema],
    default: []
  },

  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed'],
    default: 'pending'
  },
  shippingMethod: { 
    type: String, 
    default: 'Air Freight' 
  },
  fragile: { 
    type: Boolean, 
    default: false 
  },
  requiresColdStorage: { 
    type: Boolean, 
    default: false 
  },

  createdDate: { 
    type: String, 
    default: () => new Date().toISOString().split('T')[0] 
  },
  completedDate: { 
    type: String, 
    default: ''
  },

  labelGenerated: { 
    type: Boolean, 
    default: false 
  },
  labelGeneratedAt: { 
    type: Date 
  },
  packingSlipGenerated: { 
    type: Boolean, 
    default: false 
  },
  packingSlipGeneratedAt: { 
    type: Date 
  },

  notes: { 
    type: String, 
    default: ''
  },
  trackingNumber: { 
    type: String, 
    default: ''
  },
  assignedTo: { 
    type: String, 
    default: 'Unassigned' 
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    set: toObjectIdOrNull
  }
}, { timestamps: true });

PackageSchema.index({ orderId: 1, customerName: 1 });
PackageSchema.index({ invoiceNo: 1 });
PackageSchema.index({ status: 1, createdDate: -1 });

module.exports = mongoose.models.Package || mongoose.model('Package', PackageSchema);