// routes/goodsReceiptRoutes.js
const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const {
  createGRN,
  getGRNs,
  getGRN,
  deleteGRN,
  generatePurchaseInvoice,
  addPayment,
  getInvoice,
  getInvoices,
  getReceiptDashboard
} = require('../controllers/goodsReceiptController');

router.use(protect);

// Dashboard
router.get('/dashboard', getReceiptDashboard);

// Invoice Routes
router.get('/invoices', getInvoices);
router.get('/invoice/:invoiceId', getInvoice);
router.post('/invoice/:invoiceId/payment', restrictTo('admin', 'manager'), addPayment);

// GRN Routes
router.route('/')
  .get(getGRNs)
  .post(restrictTo('admin', 'manager'), createGRN);

router.route('/:id')
  .get(getGRN)
  .delete(restrictTo('admin'), deleteGRN);

// Invoice generation
router.post('/:grnId/generate-invoice', restrictTo('admin', 'manager'), generatePurchaseInvoice);

module.exports = router;