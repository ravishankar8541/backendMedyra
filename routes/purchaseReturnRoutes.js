const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');

const {
  getReturnSource,
  cancelPurchaseReturn,
  createPurchaseReturn,
  getPurchaseReturns,
  getPurchaseReturn,
  deletePurchaseReturn
} = require('../controllers/purchaseReturnController');

router.get('/source/:invoiceId', protect, restrictTo('admin', 'manager'), getReturnSource);
router.post('/:id/cancel', protect, restrictTo('admin', 'manager'), cancelPurchaseReturn);

router.route('/')
  .post(protect, restrictTo('admin', 'manager'), createPurchaseReturn)
  .get(protect, getPurchaseReturns);

router.route('/:id')
  .get(protect, getPurchaseReturn)
  .delete(protect, restrictTo('admin'), deletePurchaseReturn);

module.exports = router;
