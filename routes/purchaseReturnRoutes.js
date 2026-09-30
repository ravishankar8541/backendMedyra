// routes/purchaseReturnRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
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

router.post('/:id/send-email', authorize(), (req, res, next) => {
  upload.single('pdf')(req, res, error => {
    if (!error) return next();
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      success: false, error: error.code === 'LIMIT_FILE_SIZE'
        ? 'The debit note PDF exceeds the 10 MB email limit.'
        : 'Attach one debit note PDF and the email details.'
    });
  });
}, sendDebitNoteEmail);

router.get('/source/:invoiceId', authorize(), getReturnSource);
router.post('/:id/cancel', authorize(), cancelPurchaseReturn);
router.post('/:id/replacement', authorize(), receiveReplacement);

router
  .route('/')
  .post(authorize(), createPurchaseReturn)
  .get(getPurchaseReturns);

router
  .route('/:id')
  .get(getPurchaseReturn)
  .put(authorize(), updatePurchaseReturn)
  .delete(authorize(), deletePurchaseReturn);

module.exports = router;
