// routes/invoiceRoutes.js - UPDATED WITH PAYMENT ROUTE

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  createInvoice,
  getInvoices,
  getInvoice,
  updateInvoiceStatus,
  deleteInvoice,
  addInvoicePayment
} = require('../controllers/invoiceController');
const { protect, restrictTo } = require('../middleware/auth');

const invoiceValidation = [
  body('customer.name').notEmpty().withMessage('Customer name required'),
  body('customer.address').notEmpty().withMessage('Customer address required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item required'),
  body('date').notEmpty().withMessage('Invoice date required'),
  body('dueDate').notEmpty().withMessage('Due date required')
];

// ✅ Add Installment / Payment to Invoice
router.post('/:id/payments', protect, addInvoicePayment);

// Routes
router.route('/')
  .post(protect, invoiceValidation, createInvoice)
  .get(protect, getInvoices);

router.route('/:id')
  .get(protect, getInvoice)
  .delete(protect, restrictTo('admin'), deleteInvoice);

router.put('/:id/status', protect, updateInvoiceStatus);

module.exports = router;