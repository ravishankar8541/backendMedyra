// routes/leadRoutes.js - COMPLETE UPDATED VERSION

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  createLead,
  getLeads,
  getLead,
  updateLeadStatus,
  assignLead,
  deleteLead,
  getLeadStats,
  createInvoiceFromLead
  // ✅ NEW
} = require('../controllers/leadController');
const { protect, restrictTo } = require('../middleware/auth');

const leadValidation = [
  body('name').notEmpty().withMessage('Lead name required'),
  body('phone').notEmpty().withMessage('Phone number required'),
  body('email').optional().isEmail().withMessage('Invalid email')
];

router.use(protect);

// Stats
router.get('/stats', getLeadStats);

// Create & Get all leads
router.route('/')
  .post(leadValidation, createLead)
  .get(getLeads);  // Accountant can view all leads

// Single lead operations
router.get('/:id', getLead);
router.put('/:id/status', updateLeadStatus);
router.put('/:id/assign', restrictTo('admin', 'manager'), assignLead);
router.delete('/:id', deleteLead);

// ✅ NEW: Create invoice from lead (Accountant only)
router.post('/:id/create-invoice', 
  restrictTo('accountant', 'admin'), 
  createInvoiceFromLead
);

module.exports = router;