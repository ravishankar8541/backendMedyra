// models/Category.js
const mongoose = require("mongoose");

const CategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    }
   
  },
  {
    timestamps: true,
  }
);

// Case-insensitive unique index
CategorySchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

module.exports = mongoose.models.Category || mongoose.model("Category", CategorySchema);