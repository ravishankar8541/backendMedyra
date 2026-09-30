// routes/authRoutes.js - Make sure this is correct
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { 
  register, 
  login, 
  getMe, 
  changePassword,
  logout
} = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');

// Validation rules
const registerValidation = [
  body('name').notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').notEmpty().withMessage('Phone number required')
];

const loginValidation = [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required')
];

// Routes
const recovery = require('../controllers/passwordRecoveryController');
router.post('/forgot-password', recovery.limit, recovery.forgot);
router.post('/reset-password', recovery.limit, recovery.reset);
router.post('/register', protect, authorize(), registerValidation, require('../controllers/userController').createUser);
router.post('/login', loginValidation, login);
router.get('/me', protect, getMe);
router.put('/change-password', protect, changePassword);
router.post('/logout', protect, logout);

// ✅ Make sure this exports the router
module.exports = router;
