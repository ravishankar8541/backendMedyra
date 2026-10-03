// routes/goodsReceiptRoutes.js
// FULLY FIXED — public PI view is OUTSIDE protect
const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: {
  fileSize: 10 * 1024 * 1024, files: 1, fields: 10, fieldSize: 64 * 1024
} });

const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/goodsReceiptController');
const invoiceShare = require('../controllers/purchaseInvoiceShareController');

// ============================================================
// PUBLIC ROUTES (NO AUTH) — must be BEFORE router.use(protect)
// ============================================================
// WhatsApp / share link for Purchase Invoice
router.get('/invoices/public-view/:id', ctrl.getPublicInvoiceView);
router.get('/invoices/document/:token', invoiceShare.view);

// ============================================================
// AUTH REQUIRED FROM HERE
// ============================================================
router.use(protect);

// Dashboard
router.get('/dashboard', ctrl.getReceiptDashboard);

// ========== INVOICE (PI) ROUTES (before /:id) ==========
router.get('/invoices', ctrl.getConsolidatedInvoices);
router.get('/invoices/:invoiceId/deletion-context', authorize(), ctrl.getInvoiceDeletionContext);
router.get('/invoices/:invoiceId', ctrl.getConsolidatedInvoice);
router.put(
  '/invoices/:invoiceId',
  authorize(),
  ctrl.updateConsolidatedInvoice
);
router.post(
  '/invoices/:invoiceId/payment',
  authorize(),
  ctrl.addConsolidatedPayment
);
router.delete(
  '/invoices/:invoiceId',
  authorize(),
  ctrl.deleteConsolidatedInvoice
);
router.delete(
  '/invoices',
  authorize(),
  ctrl.deleteConsolidatedInvoice
);

// Send Purchase Invoice Email (PDF field name = "pdf")
router.post(
  '/invoices/send-email',
  authorize(),
  (req, res, next) => upload.single('pdf')(req, res, error => {
    if (!error) return next();
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      success: false,
      error: error.code === 'LIMIT_FILE_SIZE'
        ? 'The invoice PDF exceeds the 10 MB email limit.'
        : 'Invalid upload. Attach one invoice PDF and the email details.'
    });
  }),
  ctrl.sendPurchaseInvoiceEmail
);

router.post(
  '/invoices/share',
  authorize(),
  (req, res, next) => upload.single('pdf')(req, res, error => {
    if (!error) return next();
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      success: false,
      message: error.code === 'LIMIT_FILE_SIZE'
        ? 'The invoice PDF exceeds the 10 MB sharing limit.'
        : 'Attach one purchase invoice PDF up to 10 MB.'
    });
  }),
  invoiceShare.create
);

// ========== GOODS RECEIPT (GRN) ROUTES ==========
router.get('/', ctrl.getGRNs);
router.post('/', authorize(), ctrl.createGRN);
router.get('/:id', ctrl.getGRN);
router.put('/:id', authorize(), ctrl.updateGRN);
router.delete('/:id', authorize(), ctrl.deleteGRN);
router.post('/:id/payment', authorize(), ctrl.addPayment);

module.exports = router;
