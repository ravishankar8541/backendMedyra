// routes/goodsReceiptRoutes.js
const express = require('express');
const router = express.Router();
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
router.delete('/invoices', restrictTo('admin', 'manager'), ctrl.deleteConsolidatedInvoice); // Fallback for query param ?id=

// ========== GOODS RECEIPT (GRN) ROUTES ==========
router.get('/', ctrl.getGRNs);
router.post('/', restrictTo('admin', 'manager'), ctrl.createGRN);
router.get('/:id', ctrl.getGRN);
router.put('/:id', restrictTo('admin', 'manager'), ctrl.updateGRN);
router.delete('/:id', restrictTo('admin', 'manager'), ctrl.deleteGRN);
router.post('/:id/payment', restrictTo('admin', 'manager'), ctrl.addPayment);

module.exports = router;