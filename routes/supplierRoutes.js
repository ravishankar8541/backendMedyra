const express = require('express');
const router = express.Router();
const axios = require('axios');
const { body } = require('express-validator');
const {
  createSupplier,
  getSuppliers,
  getSupplier,
  updateSupplier,
  deleteSupplier
} = require('../controllers/supplierController');
const { protect, restrictTo } = require('../middleware/auth');
const { getVendorLedger } = require('../controllers/vendorLedgerController');

// Complete Indian State & UT Codes Map
const GST_STATE_MAP = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan",
  "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura",
  "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "25": "Daman and Diu", "26": "Dadra and Nagar Haveli", "27": "Maharashtra", "28": "Andhra Pradesh (Old)",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
  "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar", "36": "Telangana",
  "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction"
};

// PAN 4th Character Constitution Decoder
const PAN_CONSTITUTION_MAP = {
  'C': 'Company / Private Limited',
  'P': 'Individual / Sole Proprietorship',
  'H': 'Hindu Undivided Family (HUF)',
  'F': 'Partnership Firm / LLP',
  'A': 'Association of Persons (AOP)',
  'T': 'Trust',
  'B': 'Body of Individuals (BOI)',
  'L': 'Local Authority',
  'J': 'Artificial Juridical Person',
  'G': 'Government Agency'
};

// Supplier validation rules
const supplierValidation = [
  body('companyName').trim().notEmpty().withMessage('Company name is required'),
  body('contactPerson').trim().notEmpty().withMessage('Contact person is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required')
];

// Protect all routes with auth middleware
router.use(protect);

// ====================================================================
// GST VERIFICATION ROUTE
// GET /api/suppliers/verify-gst/:gstin
// ====================================================================
router.get('/verify-gst/:gstin', async (req, res) => {
  try {
    const gstin = (req.params.gstin || '').trim().toUpperCase();

    // 1. Format validation (15 alphanumeric characters)
    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z|z][0-9A-Z]{1}$/;
    if (!gstRegex.test(gstin)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid GSTIN format. Must be 15 characters (e.g. 07AAECJ2786K1Z5)',
      });
    }

    const stateCode = gstin.substring(0, 2);
    const pan = gstin.substring(2, 12);
    const stateName = GST_STATE_MAP[stateCode] || 'India';
    const panTypeChar = pan.charAt(3);
    const constitution = PAN_CONSTITUTION_MAP[panTypeChar] || 'Registered Business Entity';

    const apiKey = process.env.GSTIN_API_KEY;

    if (!apiKey) {
      console.error('❌ GSTIN_API_KEY is missing from environment variables (.env)');
      return res.status(500).json({
        success: false,
        message: 'GST verification service is not configured on server (Missing API Key).',
      });
    }

    const url = `https://sheet.gstincheck.co.in/check/${apiKey}/${gstin}`;

    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        Accept: 'application/json',
      },
    });

    const resBody = response.data;

    // Check if API returned a successful response
    const isSuccess = resBody && (
      resBody.flag === true || 
      resBody.flag === 'true' || 
      resBody.status === true || 
      resBody.status === 1
    );

    if (isSuccess && resBody.data) {
      const liveData = resBody.data;

      // Handle nested or flat address structures
      const addr = liveData.pradr?.addr || liveData.pradr || {};

      const fullAddress = [
        addr.bno,
        addr.bnm,
        addr.flno,
        addr.st,
        addr.loc,
        addr.dst,
      ]
        .filter(Boolean)
        .join(', ');

      return res.json({
        success: true,
        source: 'live',
        data: {
          gstin: liveData.gstin || gstin,
          pan: pan,
          legalName: liveData.lgnm || liveData.legalName || 'N/A',
          tradeName: liveData.tradeNam || liveData.tradeName || liveData.lgnm || 'N/A',
          status: liveData.sts || liveData.status || 'Active',
          taxpayerType: liveData.dty || liveData.taxpayerType || 'Regular',
          constitution: liveData.ctb || constitution,
          regDate: liveData.rgdt || 'N/A',
          address: fullAddress || liveData.address || '',
          city: addr.dst || addr.city || addr.loc || '',
          state: addr.stcd || stateName,
          stateCode: stateCode,
          pincode: addr.pncd || addr.pincode || '',
          stateJurisdiction: liveData.stj || '',
          centerJurisdiction: liveData.ctj || '',
          natureOfBusiness: Array.isArray(liveData.nba)
            ? liveData.nba.join(', ')
            : liveData.nba || '',
        },
      });
    }

    // Handled failure from third-party API
    return res.status(404).json({
      success: false,
      message: resBody?.message || 'GSTIN not found on Government GST Portal or API credits exhausted.',
    });

  } catch (err) {
    console.error('❌ GST Verification Error:', err.message);

    if (err.response?.status === 401 || err.response?.status === 403) {
      return res.status(502).json({
        success: false,
        message: 'Invalid or expired GSTIN API Key. Check server configuration.',
      });
    }

    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      return res.status(504).json({
        success: false,
        message: 'GST verification service request timed out. Please try again.',
      });
    }

    return res.status(500).json({
      success: false,
      message: err.response?.data?.message || err.message || 'Error occurred while verifying GST number.',
    });
  }
});

// ============================================
// CRUD SUPPLIER ROUTES
// ============================================
router.get('/', getSuppliers);
router.get('/:id/ledger', getVendorLedger);
router.get('/:id', getSupplier);
router.post('/', restrictTo('admin', 'manager'), supplierValidation, createSupplier);
router.put('/:id', restrictTo('admin', 'manager'), supplierValidation, updateSupplier);
router.delete('/:id', restrictTo('admin'), deleteSupplier);

module.exports = router;
