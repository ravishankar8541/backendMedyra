// models/Product.js
const mongoose = require("mongoose");

const BatchSchema = new mongoose.Schema({
  batchNumber: {
    type: String,
    required: true,
  },
  mfgDate: {
    type: String,
    default: "",
  },
  expDate: {
    type: String,
    default: "",
  },
  quantity: {
    type: Number,
    default: 0,
  },
  packing: {
    type: String,
    default: "N/A",
  },
  grossWeight: {
    type: Number,
    default: 0,
  },
  totalKg: {
    type: Number,
    default: 0,
  },
  dimension: {
    type: String,
    default: "N/A",
  },
  storageCondition: {
    type: String,
    default: "Room temperature",
  },
  shelfLife: {
    type: String,
    default: "N/A",
  },
  addedDate: {
    type: String,
    default: "",
  },
  addedBy: {
    type: String,
    default: "System",
  },
  reason: {
    type: String,
    default: "Stock addition",
  },
});

const ProductSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    sku: {
      type: String,
      unique: true,
      sparse: true,
    },
    category: {
      type: String,
      required: true,
    },
    subCategory: {
      type: String,
      default: "",
    },
    brand: {
      type: String,
      default: "",
    },
    manufacturer: {
      type: String,
      default: "",
    },
    hsnCode: {
      type: String,
      default: "",
    },
    unit: {
      type: String,
      default: "Pcs",
    },
    productType: {
      type: String,
      enum: ["batch", "non-batch"],
      default: "batch",
    },
    pricing: {
      mrp: { type: Number, default: 0 },
      sellingPrice: { type: Number, default: 0 },
      costPrice: { type: Number, default: 0 },
      taxRate: { type: Number, default: 18 },
      discount: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
    },
    stock: {
      type: Number,
      default: 0,
    },
    minStock: { type: Number, default: 0 },
    maxStock: { type: Number, default: 0 },
    reorderLevel: { type: Number, default: 0 },

    batches: {
      type: [BatchSchema],
      default: [],
    },
    images: { type: [String], default: [] },
    documents: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["active", "low_stock", "critical", "inactive", "pending"],
      default: "pending",
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

ProductSchema.index({ name: "text", sku: "text", brand: "text" });
ProductSchema.index({ category: 1, status: 1 });
ProductSchema.index({ createdAt: -1 });

// ✅ FIX: Pre-save Hook: Accurately calculate batch stock even when empty
ProductSchema.pre("save", function () {
  if (this.productType === "batch") {
    let totalStock = 0;
    if (Array.isArray(this.batches) && this.batches.length > 0) {
      this.batches.forEach((batch) => {
        totalStock += Number(batch.quantity) || 0;
      });
    }
    this.stock = totalStock; // Always update total stock
  } else {
    this.batches = [];
  }

  // Calculate status
  if (this.stock <= 0) {
    this.status = "inactive";
  } else if (this.reorderLevel > 0 && this.stock <= this.reorderLevel) {
    this.status = "critical";
  } else if (this.minStock > 0 && this.stock <= this.minStock) {
    this.status = "low_stock";
  } else {
    this.status = "active";
  }

  this.lastUpdated = new Date();
});

module.exports = mongoose.models.Product || mongoose.model("Product", ProductSchema);