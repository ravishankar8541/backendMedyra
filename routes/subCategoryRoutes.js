// routes/subCategoryRoutes.js
const express = require("express");
const router = express.Router();
const { protect, restrictTo } = require("../middleware/auth");
const {
  getSubCategories,
  createSubCategory,
  deleteSubCategory,
} = require("../controllers/subCategoryController");

// Get all sub categories
router.get("/", protect, getSubCategories);

// Create sub category (admin / manager)
router.post("/", protect, restrictTo("admin", "manager"), createSubCategory);

// Delete sub category (admin only)
router.delete("/:id", protect, restrictTo("admin"), deleteSubCategory);

module.exports = router;