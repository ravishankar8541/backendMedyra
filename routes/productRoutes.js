const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  addBatch,
  getLowStockProducts,
  updateStock,
  removeBatchStock
} = require('../controllers/productController');

// ============================================
// PRODUCT CRUD ROUTES
// ============================================

// Get all products & Create new product
router.route('/')
  .get(protect, getProducts)
  .post(protect, restrictTo('admin', 'manager'), createProduct);

// Get, Update, Delete single product
router.route('/:id')
  .get(protect, getProduct)
  .put(protect, restrictTo('admin', 'manager'), updateProduct)
  .delete(protect, restrictTo('admin'), deleteProduct);

// ============================================
// STOCK MANAGEMENT ROUTES
// ============================================

// Add batch to product
router.post('/:id/batch', protect, restrictTo('admin', 'manager'), addBatch);

// Remove batch stock
router.delete('/:id/batch', protect, restrictTo('admin', 'manager'), removeBatchStock);

// Update stock
router.patch('/:id/stock', protect, restrictTo('admin', 'manager'), updateStock);

// Get low stock products
router.get('/low-stock', protect, getLowStockProducts);

module.exports = router;