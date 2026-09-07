// routes/goodsReceiptRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer'); // 1. Import multer
const upload = multer({ storage: multer.memoryStorage() }); // 2. Define upload middleware

const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/goodsReceiptController');

router.use(protect);

// Dashboard
router.get('/dashboard', ctrl.getReceiptDashboard);

// ========== INVOICE (PI) ROUTES (Registered before /:id) ==========
router.get('/invoices', ctrl.getConsolidatedInvoices);
router.get('/invoices/:invoiceId', ctrl.getConsolidatedInvoice);
router.put('/invoices/:invoiceId', restrictTo('admin', 'manager'), ctrl.updateConsolidatedInvoice);
router.post('/invoices/:invoiceId/payment', restrictTo('admin', 'manager'), ctrl.addConsolidatedPayment);
router.delete('/invoices/:invoiceId', restrictTo('admin', 'manager'), ctrl.deleteConsolidatedInvoice);
router.delete('/invoices', restrictTo('admin', 'manager'), ctrl.deleteConsolidatedInvoice);

// Send Purchase Invoice Email
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