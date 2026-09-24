const mongoose = require("mongoose");

// ========== BATCH SCHEMA ==========
const BatchSchema = new mongoose.Schema({
  sourceGRN: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt' },
  sourceGRNItem: { type: mongoose.Schema.Types.ObjectId },
  purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
  batchNumber: { type: String, required: true },
  mfgDate: { type: String, default: "" },
  expDate: { type: String, default: "" },
  quantity: { type: Number, default: 0 },
  reservedQuantity: { type: Number, default: 0 }, // ← Stock Reservation
  mrp: { type: Number, default: 0 },
  costPrice: { type: Number, default: 0 },
  sellingPrice: { type: Number, default: 0 },
  supplierName: { type: String, default: "" },
  supplier: { type: mongoose.Schema.Types.Mixed, default: null },
  packing: { type: String, default: "N/A" },
  grossWeight: { type: Number, default: 0 },
  totalKg: { type: Number, default: 0 },
  dimension: { type: String, default: "N/A" },
  storageCondition: { type: String, default: "Room temperature" },
  shelfLife: { type: String, default: "N/A" },
  manufacturer: { type: String, default: "N/A" },
  addedDate: { type: String, default: "" },
  addedBy: { type: String, default: "System" },
  reason: { type: String, default: "Stock addition" },
});

// ========== STOCK MOVEMENT HISTORY ==========
const StockMovementSchema = new mongoose.Schema({
  batchNumber: { type: String, default: '' },
  sourceGRN: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt' },
  sourceGRNItem: { type: mongoose.Schema.Types.ObjectId },
  purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
  type: { type: String, enum: ["add", "remove", "reserve", "release"], required: true },
  quantity: { type: Number, required: true },
  mrp: { type: Number, default: 0 },
  costPrice: { type: Number, default: 0 },
  sellingPrice: { type: Number, default: 0 },
  supplierName: { type: String, default: "" },
  reason: { type: String, default: "" },
  addedBy: { type: String, default: "System" },
  date: { type: Date, default: Date.now },
});

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, unique: true, sparse: true },
    category: { type: String, required: true },
    subCategory: { type: String, default: "" },
    brand: { type: String, default: "" },
    manufacturer: { type: String, default: "" },
    hsnCode: { type: String, default: "" },
    unit: { type: String, default: "Pcs" },
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
    stock: { type: Number, default: 0 },
    reservedStock: { type: Number, default: 0 }, // ← Stock Reservation
    minStock: { type: Number, default: 0 },
    maxStock: { type: Number, default: 0 },
    reorderLevel: { type: Number, default: 0 },

    batches: { type: [BatchSchema], default: [] },
    stockMovements: { type: [StockMovementSchema], default: [] },

    images: { type: [String], default: [] },
    documents: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["active", "low_stock", "critical", "inactive", "pending"],
      default: "pending",
    },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ProductSchema.index({ name: "text", sku: "text", brand: "text" });
ProductSchema.index({ category: 1, status: 1 });
ProductSchema.index({ createdAt: -1 });

// ====================== PRE-SAVE HOOK ======================
ProductSchema.pre("save", function () {
  if (this.productType === "batch") {
    let totalStock = 0;
    let totalReserved = 0;
    if (Array.isArray(this.batches) && this.batches.length > 0) {
      this.batches.forEach((batch) => {
        totalStock += Number(batch.quantity) || 0;
        totalReserved += Number(batch.reservedQuantity) || 0;
      });
    }
    this.stock = totalStock;
    this.reservedStock = totalReserved;
  } else {
    this.batches = [];
  }

  // Status based on AVAILABLE stock (Physical - Reserved)
  const available = (this.stock || 0) - (this.reservedStock || 0);

  if (available <= 0) {
    this.status = "inactive";
  } else if (this.reorderLevel > 0 && available <= this.reorderLevel) {
    this.status = "critical";
  } else if (this.minStock > 0 && available <= this.minStock) {
    this.status = "low_stock";
  } else {
    this.status = "active";
  }

  this.lastUpdated = new Date();
});

module.exports = mongoose.models.Product || mongoose.model("Product", ProductSchema);
