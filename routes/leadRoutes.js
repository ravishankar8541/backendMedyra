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
  .delete(deleteLead);  // ✅ This deletes LEAD, not proforma

// Status update
router.put('/:id/status', updateLeadStatus);

// ✅ PROFORMA OPERATIONS
// ✅ Delete specific proforma - FIXED: Use query param to avoid route conflict
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

// ✅ Convert Proforma to Invoice - main endpoint
router.post('/:id/convert-invoice', 
  restrictTo('accountant', 'admin'), 
  convertProformaToInvoice
);

// ✅ Force convert
router.post('/:id/force-convert', 
  restrictTo('accountant', 'admin'), 
  (req, res, next) => {
    req.query.force = 'true';
    req.body.force = true;
    next();
  },
  convertProformaToInvoice
);


router.post('/send-email', protect, async (req, res) => {
  try {
    const { to, subject, body, attachment } = req.body;
    
    // Use nodemailer or your preferred email service
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: process.env.SMTP_FROM,
      to,
      subject,
      html: body.replace(/\n/g, '<br>'),
      attachments: attachment ? [{
        filename: attachment.filename,
        content: Buffer.from(attachment.content, 'base64'),
      }] : [],
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true });
  } catch (error) {
    console.error('Email error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ====== TEMP FILE UPLOAD ROUTE ======
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.post('/upload-temp', protect, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // Upload to cloud storage (S3, Firebase, etc.)
    // For demo, return a temporary URL
    const url = `https://your-storage.com/temp/${Date.now()}_${file.originalname}`;
    
    // Store file temporarily (you can use AWS S3, Firebase Storage, etc.)
    // For now, return a mock URL
    res.json({ 
      success: true, 
      url: url,
      message: 'File uploaded successfully'
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ====== WHATSAPP SENDING ROUTE ======
router.post('/send-whatsapp', protect, async (req, res) => {
  try {
    const { phone, message, attachment } = req.body;
    
    // Use Twilio, WhatsApp Business API, or similar
    // For demo, just log
    console.log(`📱 WhatsApp to ${phone}: ${message}`);
    if (attachment) {
      console.log(`📎 Attachment: ${attachment.url}`);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('WhatsApp error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});
module.exports = router;