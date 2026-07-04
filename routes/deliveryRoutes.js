const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  createDelivery,
  getDeliveries,
  updateDeliveryStatus,
  getDeliveryStats
} = require('../controllers/deliveryController');
const { protect, restrictTo } = require('../middleware/auth');

const deliveryValidation = [
  body('order').notEmpty().withMessage('Order required'),
  body('assignedTo').notEmpty().withMessage('Delivery agent required')
];

router.use(protect);

router.get('/stats', getDeliveryStats);

router.route('/')
  .post(restrictTo('admin', 'manager'), deliveryValidation, createDelivery)
  .get(getDeliveries);

router.put('/:id/status', updateDeliveryStatus);

module.exports = router;