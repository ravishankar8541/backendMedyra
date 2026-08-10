// routes/leadRoutes.js - FIXED
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  createLead,
  getLeads,
  getLead,
  updateLead,
  updateLeadStatus,
  deleteLead,
  getLeadStats,
  generateProforma,
  convertProformaToInvoice,
  deleteProforma
} = require('../controllers/leadController');
const { protect, restrictTo } = require('../middleware/auth');

const leadValidation = [
  body('name').notEmpty().withMessage('Lead name required'),
  body('phone').notEmpty().withMessage('Phone number required'),
  body('email').optional().isEmail().withMessage('Invalid email')
];

const proformaValidation = [
  body('items').isArray({ min: 1 }).withMessage('⚠️ At least one item required for proforma invoice'),
  body('validUntil').optional().isISO8601().withMessage('Valid date required')
];

// ✅ Protect all routes
router.use(protect);

// Stats
router.get('/stats', getLeadStats);

// Create & Get all leads
router.route('/')
  .post(leadValidation, createLead)
  .get(getLeads);

// ✅ SINGLE LEAD OPERATIONS
router.route('/:id')
  .get(getLead)
  .put(updateLead)
  .delete(deleteLead);

// Status update
router.put('/:id/status', updateLeadStatus);

// ✅ PROFORMA OPERATIONS
router.delete('/:id/proforma', 
  restrictTo('telecaller', 'admin', 'manager'), 
  deleteProforma
);

// ✅ Proforma Invoice routes
router.post('/:id/proforma', 
  restrictTo('telecaller', 'admin', 'manager'), 
  proformaValidation, 
  generateProforma
);

// ✅ Convert Proforma to Invoice
router.post('/:id/convert-invoice', 
  restrictTo('accountant', 'admin'), 
  convertProformaToInvoice
);

module.exports = router;