const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  createOrder,
  getOrders,
  updateOrderStatus,
  assignOrder
} = require('../controllers/orderController');
const { protect } = require('../middleware/auth');

// Validation rules
const orderValidation = [
  body('customer.name').notEmpty().withMessage('Customer name required'),
  body('customer.phone').notEmpty().withMessage('Customer phone required'),
  body('customer.address').notEmpty().withMessage('Delivery address required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item required')
];

router.route('/')
  .post(protect, orderValidation, createOrder)
  .get(protect, getOrders);

router.put('/:id/status', protect, updateOrderStatus);
router.put('/:id/assign', protect, assignOrder);

module.exports = router;