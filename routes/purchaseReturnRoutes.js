// routes/purchaseReturnRoutes.js
const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');

const {
  getReturnSource,
  cancelPurchaseReturn,
  createPurchaseReturn,
  updatePurchaseReturn,
  receiveReplacement,
  getPurchaseReturns,
  getPurchaseReturn,
  deletePurchaseReturn,
  getPublicDebitNoteView
} = require('../controllers/purchaseReturnController');

// Public Debit Note View (no login required for direct print or sharing)
router.get('/public-view/:id', getPublicDebitNoteView);

router.use(protect);

router.get('/source/:invoiceId', restrictTo('admin', 'manager'), getReturnSource);
router.post('/:id/cancel', restrictTo('admin', 'manager'), cancelPurchaseReturn);
router.post('/:id/replacement', restrictTo('admin', 'manager'), receiveReplacement);

router
  .route('/')
  .post(restrictTo('admin', 'manager'), createPurchaseReturn)
  .get(getPurchaseReturns);

router
  .route('/:id')
  .get(getPurchaseReturn)
  .put(restrictTo('admin', 'manager'), updatePurchaseReturn)
  .delete(restrictTo('admin', 'manager'), deletePurchaseReturn);

module.exports = router;