// routes/purchaseReturnRoutes.js
const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');

const {
  createPurchaseReturn,
  getPurchaseReturns,
  getPurchaseReturn,
  deletePurchaseReturn
} = require('../controllers/purchaseReturnController');

router.route('/')
  .post(protect, restrictTo('admin', 'manager'), createPurchaseReturn)
  .get(protect, getPurchaseReturns);

router.route('/:id')
  .get(protect, getPurchaseReturn)
  .delete(protect, restrictTo('admin'), deletePurchaseReturn);

module.exports = router;