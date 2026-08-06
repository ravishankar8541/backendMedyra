const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  createSupplier,
  getSuppliers,
  getSupplier,
  updateSupplier,
  deleteSupplier
} = require('../controllers/supplierController');
const { protect, restrictTo } = require('../middleware/auth');

// ===== VALIDATION RULES =====
const supplierValidation = [
  body('companyName').notEmpty().withMessage('Company name is required'),
  body('contactPerson').notEmpty().withMessage('Contact person is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').notEmpty().withMessage('Phone number is required')
];

// ============================================
// ALL ROUTES - PROTECTED
// ============================================
router.use(protect);

// ============================================
// GET ALL SUPPLIERS - Anyone logged in
// ============================================
router.get('/', getSuppliers);

// ============================================
// GET SINGLE SUPPLIER - Anyone logged in
// ============================================
router.get('/:id', getSupplier);

// ============================================
// CREATE SUPPLIER - Admin & Manager
// ============================================
router.post('/', 
  restrictTo('admin', 'manager'),
  supplierValidation, 
  createSupplier
);

// ============================================
// UPDATE SUPPLIER - Admin & Manager
// ============================================
router.put('/:id', 
  restrictTo('admin', 'manager'),
  supplierValidation,
  updateSupplier
);

// ============================================
// DELETE SUPPLIER - Admin only
// ============================================
router.delete('/:id', 
  restrictTo('admin'), 
  deleteSupplier
);

module.exports = router;