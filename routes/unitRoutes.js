// routes/unitRoutes.js
const express = require("express");
const router = express.Router();
const { protect, restrictTo } = require("../middleware/auth");
const {
  getUnits,
  createUnit,
  deleteUnit,
} = require("../controllers/unitController");

// Get all units (anyone logged in)
router.get("/", protect, getUnits);

// Create unit (admin / manager)
router.post("/", protect, restrictTo("admin", "manager"), createUnit);

// Delete unit (admin only)
router.delete("/:id", protect, restrictTo("admin"), deleteUnit);

module.exports = router;