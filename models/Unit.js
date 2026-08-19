// models/Unit.js
const mongoose = require("mongoose");

const UnitSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
 
  },
  {
    timestamps: true,
  }
);

// Case-insensitive unique index
UnitSchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

module.exports = mongoose.models.Unit || mongoose.model("Unit", UnitSchema);