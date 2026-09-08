// routes/goodsReceiptRoutes.js
// FULLY FIXED — public PI view is OUTSIDE protect
const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/goodsReceiptController');

// ============================================================
// PUBLIC ROUTES (NO AUTH) — must be BEFORE router.use(protect)
// ============================================================
// WhatsApp / share link for Purchase Invoice
router.get('/invoices/public-view/:id', ctrl.getPublicInvoiceView);

// ============================================================
// AUTH REQUIRED FROM HERE
// ============================================================
router.use(protect);

// Dashboard
router.get('/dashboard', ctrl.getReceiptDashboard);

// ========== INVOICE (PI) ROUTES (before /:id) ==========
router.get('/invoices', ctrl.getConsolidatedInvoices);
router.get('/invoices/:invoiceId', ctrl.getConsolidatedInvoice);
router.put(
  '/invoices/:invoiceId',
  restrictTo('admin', 'manager'),
  ctrl.updateConsolidatedInvoice
);
router.post(
  '/invoices/:invoiceId/payment',
  restrictTo('admin', 'manager'),
  ctrl.addConsolidatedPayment
);
router.delete(
  '/invoices/:invoiceId',
  restrictTo('admin', 'manager'),
  ctrl.deleteConsolidatedInvoice
);
router.delete(
  '/invoices',
  restrictTo('admin', 'manager'),
  ctrl.deleteConsolidatedInvoice
);

// Send Purchase Invoice Email (PDF field name = "pdf")
router.post(
  '/invoices/send-email',
  upload.single('pdf'),
  restrictTo('admin', 'manager'),
  ctrl.sendPurchaseInvoiceEmail
);

// ========== GOODS RECEIPT (GRN) ROUTES ==========
router.get('/', ctrl.getGRNs);
router.post('/', restrictTo('admin', 'manager'), ctrl.createGRN);
router.get('/:id', ctrl.getGRN);
router.put('/:id', restrictTo('admin', 'manager'), ctrl.updateGRN);
router.delete('/:id', restrictTo('admin', 'manager'), ctrl.deleteGRN);
router.post('/:id/payment', restrictTo('admin', 'manager'), ctrl.addPayment);

module.exports = router;