// routes/goodsReceiptRoutes.js
const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const {
  createGRN,
  getGRNs,
  getGRN,
  deleteGRN,
  getConsolidatedInvoices,
  getConsolidatedInvoice,
  addConsolidatedPayment,
  getReceiptDashboard
} = require('../controllers/goodsReceiptController');

// All routes protected
router.use(protect);

// ============================================
// DASHBOARD
// ============================================
router.get('/dashboard', getReceiptDashboard);

// ============================================
// CONSOLIDATED INVOICE ROUTES
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
// SINGLE GRN (GET / DELETE)
// ============================================
router
  .route('/:id')
  .get(getGRN)
  .delete(restrictTo('admin'), deleteGRN);

module.exports = router;