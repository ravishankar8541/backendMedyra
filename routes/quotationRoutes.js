// routes/quotationRoutes.js - CORRECTED WORKING VERSION

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  createQuotation,
  getQuotations,
  getQuotation,
  updateQuotationStatus,
  deleteQuotation
} = require('../controllers/quotationController');
const { protect } = require('../middleware/auth');

const quotationValidation = [
  body('leadId').notEmpty().withMessage('Lead ID required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item required'),
  body('validUntil').isISO8601().withMessage('Valid until date required')
];

// All routes require authentication
router.use(protect);

// Create & Get all quotations
router.post('/', quotationValidation, createQuotation);
router.get('/', getQuotations);

// Single quotation operations
router.get('/:id', getQuotation);
router.put('/:id/status', updateQuotationStatus);
router.delete('/:id', deleteQuotation);

module.exports = router;