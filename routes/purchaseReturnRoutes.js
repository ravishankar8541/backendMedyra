// routes/purchaseReturnRoutes.js
const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const multer = require('multer');
const { sendDebitNoteEmail } = require('../controllers/debitNoteEmailController');
const upload = multer({ storage: multer.memoryStorage(), limits: {
  fileSize: 10 * 1024 * 1024, files: 1, fields: 1, fieldSize: 64 * 1024
} });

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

router.post('/:id/send-email', restrictTo('admin', 'manager'), (req, res, next) => {
  upload.single('pdf')(req, res, error => {
    if (!error) return next();
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      success: false, error: error.code === 'LIMIT_FILE_SIZE'
        ? 'The debit note PDF exceeds the 10 MB email limit.'
        : 'Attach one debit note PDF and the email details.'
    });
  });
}, sendDebitNoteEmail);

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
