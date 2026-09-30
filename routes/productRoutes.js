const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  addBatch,
  getLowStockProducts,
  updateStock,
  removeBatchStock,
  updateBatch,
   deleteBatch 
} = require('../controllers/productController');

// ============================================
// PRODUCT CRUD ROUTES
// ============================================

// Get all products & Create new product
router.route('/')
  .get(protect, getProducts)
  .post(protect, authorize(), createProduct);

// Get, Update, Delete single product
router.route('/:id')
  .get(protect, getProduct)
  .put(protect, authorize(), updateProduct)
  .delete(protect, authorize(), deleteProduct);

// ============================================
// STOCK MANAGEMENT ROUTES
// ============================================

// Add batch to product
router.post('/:id/batch', protect, authorize(), addBatch);


// ✅ UPDATE EXISTING BATCH (Add/Remove stock)
router.put('/:id/batch/:batchIndex', protect, authorize(), updateBatch);

// Remove batch stock
router.delete('/:id/batch', protect, authorize(), removeBatchStock);

router.delete('/:id/batch/:batchIndex', protect, authorize(), deleteBatch);
// Update stock
router.patch('/:id/stock', protect, authorize(), updateStock);

// Get low stock products
router.get('/low-stock', protect, getLowStockProducts);

module.exports = router;