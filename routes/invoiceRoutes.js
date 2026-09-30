// routes/invoiceRoutes.js
const express = require('express');
const router = express.Router();
const transaction = require('../utils/receiptTransaction');
const { body } = require('express-validator');
const {
  createInvoice,
  getInvoices,
  getInvoice,
  updateInvoiceStatus,
  deleteInvoice,
  addInvoicePayment,
  updateInvoiceItems
} = require('../controllers/invoiceController');
const { protect, authorize } = require('../middleware/auth');

const invoiceShare = require('../controllers/invoiceShareController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, fieldSize: 64 * 1024 } }).single('pdf');
const invoiceUpload = (req, res, next) => upload(req, res, error => {
  if (!error) return next();
  res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: 'Attach one invoice PDF up to 10 MB with its sharing details.' });
});
router.get('/document/:token', invoiceShare.view);
router.post('/:id/share', protect, invoiceUpload, invoiceShare.share);
router.post('/:id/email', protect, invoiceUpload, invoiceShare.email);

const invoiceValidation = [
  body('customer.name').notEmpty().withMessage('Customer name required'),
  body('customer.address').notEmpty().withMessage('Customer address required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item required'),
  body('date').notEmpty().withMessage('Invoice date required'),
  body('dueDate').notEmpty().withMessage('Due date required')
];

// Add Payment / Installment
router.post('/:id/payments', protect, transaction(addInvoicePayment));

// Update Quantity / Items
router.put('/:id/items', protect, transaction(updateInvoiceItems));

router.route('/')
  .post(protect, invoiceValidation, createInvoice)
  .get(protect, getInvoices);

router.route('/:id')
  .get(protect, getInvoice)
  .put(protect, transaction(updateInvoiceItems))
  .delete(protect, authorize(), transaction(deleteInvoice));

router.put('/:id/status', protect, transaction(updateInvoiceStatus));

module.exports = router;