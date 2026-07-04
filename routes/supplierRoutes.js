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

const supplierValidation = [
  body('name').notEmpty().withMessage('Supplier name required'),
  body('email').isEmail().withMessage('Valid email required'),
  body('phone').notEmpty().withMessage('Phone number required')
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
  restrictTo('admin', 'manager'),  // ✅ Added 'manager'
  supplierValidation, 
  createSupplier
);

// ============================================
// UPDATE SUPPLIER - Admin & Manager
// ============================================
router.put('/:id', 
  restrictTo('admin', 'manager'),  // ✅ Added 'manager'
  updateSupplier
);

// ============================================
// DELETE SUPPLIER - Admin only (safety)
// ============================================
router.delete('/:id', 
  restrictTo('admin'), 
  deleteSupplier
);

module.exports = router;