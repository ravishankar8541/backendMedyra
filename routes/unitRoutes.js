// routes/unitRoutes.js
const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/auth");
const {
  getUnits,
  createUnit,
  deleteUnit,
} = require("../controllers/unitController");

// Get all units (anyone logged in)
router.get("/", protect, getUnits);

// Create unit (admin / manager)
router.post("/", protect, authorize(), createUnit);

// Delete unit (admin only)
router.delete("/:id", protect, authorize(), deleteUnit);

module.exports = router;