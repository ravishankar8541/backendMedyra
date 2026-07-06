const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  createLead,
  getLeads,
  getLead,          // ✅ NEW
  updateLeadStatus,
  assignLead,
  deleteLead,
  getLeadStats
} = require('../controllers/leadController');
const { protect, restrictTo } = require('../middleware/auth');

const leadValidation = [
  body('name').notEmpty().withMessage('Lead name required'),
  body('phone').notEmpty().withMessage('Phone number required'),
  body('email').optional().isEmail().withMessage('Invalid email')
];

router.use(protect);

router.get('/stats', getLeadStats);
router.route('/')
  .post(leadValidation, createLead)
  .get(getLeads);

router.get('/:id', getLead);  // ✅ NEW: Get single lead
router.put('/:id/status', updateLeadStatus);
router.put('/:id/assign', restrictTo('admin', 'manager'), assignLead);
router.delete('/:id', deleteLead);

module.exports = router;