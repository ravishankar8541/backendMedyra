const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { protect, restrictTo } = require('../middleware/auth');

const {
  getInventoryStats,
  getLowStockAlerts,
  getInventoryByCategory,
  getAllInventory,
  getInventoryItem,
  createInventory,
  updateInventory,
  addStockMovement,
  getStockMovements,
  deleteInventory
} = require('../controllers/inventoryController');

// ============================================
// VALIDATION RULES
// ============================================
const createInventoryValidation = [
  body('product').notEmpty().withMessage('Product ID required'),
  body('warehouse').notEmpty().withMessage('Warehouse required'),
  body('quantity').isNumeric().withMessage('Quantity must be a number')
];

const movementValidation = [
  body('type').isIn(['in', 'out', 'adjustment']).withMessage('Invalid movement type'),
  body('quantity').isNumeric().withMessage('Quantity must be a number'),
  body('reason').optional().isString()
];

// ============================================
// PUBLIC ROUTES (All authenticated users)
// ============================================
router.get('/stats', protect, getInventoryStats);
router.get('/alerts', protect, getLowStockAlerts);
router.get('/categories', protect, getInventoryByCategory);

// ============================================
// CRUD ROUTES
// ============================================
router.route('/')
  .get(protect, getAllInventory)
  .post(protect, restrictTo('admin', 'manager'), createInventoryValidation, createInventory);

router.route('/:id')
  .get(protect, getInventoryItem)
  .put(protect, restrictTo('admin', 'manager'), updateInventory)
  .delete(protect, restrictTo('admin'), deleteInventory);

// ============================================
// STOCK MOVEMENT ROUTES
// ============================================
router.post('/:id/movement', protect, restrictTo('admin', 'manager'), movementValidation, addStockMovement);
router.get('/:id/movements', protect, getStockMovements);

module.exports = router;