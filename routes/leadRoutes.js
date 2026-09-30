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
const { protect, authorize } = require('../middleware/auth');
const proformaShare = require('../controllers/proformaShareController');
const multer = require('multer');
const uploadProforma = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, fieldSize: 64 * 1024 } }).single('pdf');
const proformaUpload = (req, res, next) => uploadProforma(req, res, error => {
  if (!error) return next();
  res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: 'Attach one proforma PDF up to 10 MB with its sharing details.' });
});

const leadValidation = [
  body('name').notEmpty().withMessage('Lead name required'),
  body('phone').notEmpty().withMessage('Phone number required'),
  body('email').optional().isEmail().withMessage('Invalid email')
];

const proformaValidation = [
  body('items').isArray({ min: 1 }).withMessage('⚠️ At least one item required for proforma invoice'),
  body('validUntil').optional().isISO8601().withMessage('Valid date required')
];

router.get('/proforma-document/:token', proformaShare.view);
router.use(protect);
router.post('/:id/proforma-share', authorize(), proformaUpload, proformaShare.share);
router.post('/:id/proforma-email', authorize(), proformaUpload, proformaShare.email);

router.get('/stats', getLeadStats);
router.get('/:id/ledger', authorize(), require('../controllers/clientLedgerController').getClientLedger);

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
  authorize(), 
  deleteProforma
);

router.post('/:id/proforma', 
  authorize(), 
  proformaValidation, 
  generateProforma
);

// ✅ NEW – Create Revision
router.post('/:id/proforma/revise', 
  authorize(), 
  createProformaRevision
);

router.post('/:id/convert-invoice', 
  authorize(), 
  require('../utils/receiptTransaction')(convertProformaToInvoice)
);

module.exports = router;
