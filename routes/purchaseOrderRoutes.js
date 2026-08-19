// routes/purchaseOrderRoutes.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { protect, restrictTo } = require('../middleware/auth');

const {
  createPurchaseOrder,
  getPurchaseOrders,
  updatePurchaseOrderStatus,
  deletePurchaseOrder,
  getPurchaseOrder
} = require('../controllers/purchaseOrderController');

const poValidation = [
  body('supplier').notEmpty().withMessage('Supplier required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item required')
];

// ============================================
// MAIN ROUTES
// ============================================
router.route('/')
  .post(protect, restrictTo('admin', 'manager'), poValidation, createPurchaseOrder)
  .get(protect, getPurchaseOrders);

router.route('/:id')
  .get(protect, getPurchaseOrder)
  .delete(protect, restrictTo('admin'), deletePurchaseOrder);

// ============================================
// STATUS UPDATE
// ============================================
router.put('/:id/status', protect, restrictTo('admin', 'manager'), updatePurchaseOrderStatus);


module.exports = router;