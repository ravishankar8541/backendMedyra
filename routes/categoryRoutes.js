// routes/categoryRoutes.js
const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/auth");
const {
  getCategories,
  createCategory,
  deleteCategory,
} = require("../controllers/categoryController");

// Get all categories
router.get("/", protect, getCategories);

// Create category (admin / manager)
router.post("/", protect, authorize(), createCategory);

// Delete category (admin only)
router.delete("/:id", protect, authorize(), deleteCategory);

module.exports = router;