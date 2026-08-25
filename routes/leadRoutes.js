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
  deleteProforma,
  createProformaRevision          // ← NEW
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

router.use(protect);

router.get('/stats', getLeadStats);

router.route('/')
  .post(leadValidation, createLead)
  .get(getLeads);

router.route('/:id')
  .get(getLead)
  .put(updateLead)
  .delete(deleteLead);

router.put('/:id/status', updateLeadStatus);

// Proforma routes
router.delete('/:id/proforma', 
  restrictTo('telecaller', 'admin', 'manager'), 
  deleteProforma
);

router.post('/:id/proforma', 
  restrictTo('telecaller', 'admin', 'manager'), 
  proformaValidation, 
  generateProforma
);

// ✅ NEW – Create Revision
router.post('/:id/proforma/revise', 
  restrictTo('telecaller', 'admin', 'manager'), 
  createProformaRevision
);

router.post('/:id/convert-invoice', 
  restrictTo('accountant', 'admin'), 
  convertProformaToInvoice
);

module.exports = router;