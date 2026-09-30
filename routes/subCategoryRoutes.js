// routes/subCategoryRoutes.js
const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/auth");
const {
  getSubCategories,
  createSubCategory,
  deleteSubCategory,
} = require("../controllers/subCategoryController");

// Get all sub categories
router.get("/", protect, getSubCategories);

// Create sub category (admin / manager)
router.post("/", protect, authorize(), createSubCategory);

// Delete sub category (admin only)
router.delete("/:id", protect, authorize(), deleteSubCategory);

module.exports = router;