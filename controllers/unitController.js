// controllers/unitController.js
const Unit = require("../models/Unit");

// Get all units
exports.getUnits = async (req, res) => {
  try {
    const units = await Unit.find().sort({ name: 1 });
    res.json({
      success: true,
      data: units,
    });
  } catch (error) {
    console.error("Get units error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create new unit
exports.createUnit = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Unit name is required",
      });
    }

    const trimmedName = name.trim();

    // Check if already exists (case-insensitive)
    const existing = await Unit.findOne({
      name: { $regex: new RegExp(`^${trimmedName}$`, "i") },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Unit already exists",
      });
    }

    const unit = await Unit.create({
      name: trimmedName,
      createdBy: req.user?.id,
    });

    res.status(201).json({
      success: true,
      data: unit,
      message: "Unit created successfully",
    });
  } catch (error) {
    console.error("Create unit error:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Unit already exists",
      });
    }

    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete unit (optional)
exports.deleteUnit = async (req, res) => {
  try {
    const unit = await Unit.findByIdAndDelete(req.params.id);

    if (!unit) {
      return res.status(404).json({
        success: false,
        message: "Unit not found",
      });
    }

    res.json({
      success: true,
      message: "Unit deleted successfully",
    });
  } catch (error) {
    console.error("Delete unit error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};