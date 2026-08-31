// routes/goodsReceiptRoutes.js
const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const {
  createGRN,
  getGRNs,
  getGRN,
  deleteGRN,
  addPayment,
  generatePurchaseInvoice,
  getConsolidatedInvoices,
  getConsolidatedInvoice,
  addConsolidatedPayment,
  getReceiptDashboard
} = require('../controllers/goodsReceiptController');

// All routes protected by JWT auth
router.use(protect);

// ============================================
// DASHBOARD
// ============================================
router.get('/dashboard', getReceiptDashboard);

// ============================================
// CONSOLIDATED PURCHASE INVOICE (PI) ROUTES
// ============================================
router.get('/invoices', getConsolidatedInvoices);
router.get('/invoices/:invoiceId', getConsolidatedInvoice);
router.post('/invoices/:invoiceId/payment', restrictTo('admin', 'manager'), addConsolidatedPayment);

// ============================================
// GRN LIST + CREATE
// ============================================
router
  .route('/')
  .get(getGRNs)
  .post(restrictTo('admin', 'manager'), createGRN);

// ============================================
// SINGLE GRN ACTIONS (PAYMENT & INVOICE GENERATE)
// ============================================
router.post('/:id/payment', restrictTo('admin', 'manager'), addPayment);
router.post('/:id/generate-invoice', restrictTo('admin', 'manager'), generatePurchaseInvoice);

// ============================================
// SINGLE GRN (GET / DELETE)
// ============================================
router
  .route('/:id')
  .get(getGRN)
  .delete(restrictTo('admin'), deleteGRN);

module.exports = router;