// controllers/subCategoryController.js
const SubCategory = require("../models/SubCategory");

// Get all sub categories
exports.getSubCategories = async (req, res) => {
  try {
    const subCategories = await SubCategory.find().sort({ name: 1 });
    res.json({
      success: true,
      data: subCategories,
    });
  } catch (error) {
    console.error("Get sub categories error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create new sub category
exports.createSubCategory = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Sub Category name is required",
      });
    }

    const trimmedName = name.trim();

    // Case-insensitive check
    const existing = await SubCategory.findOne({
      name: { $regex: new RegExp(`^${trimmedName}$`, "i") },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Sub Category already exists",
      });
    }

    const subCategory = await SubCategory.create({
      name: trimmedName,
      createdBy: req.user?.id,
    });

    res.status(201).json({
      success: true,
      data: subCategory,
      message: "Sub Category created successfully",
    });
  } catch (error) {
    console.error("Create sub category error:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Sub Category already exists",
      });
    }

    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete sub category (optional)
exports.deleteSubCategory = async (req, res) => {
  try {
    const subCategory = await SubCategory.findByIdAndDelete(req.params.id);

    if (!subCategory) {
      return res.status(404).json({
        success: false,
        message: "Sub Category not found",
      });
    }

    res.json({
      success: true,
      message: "Sub Category deleted successfully",
    });
  } catch (error) {
    console.error("Delete sub category error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};