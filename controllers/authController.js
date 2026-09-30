// authController.js - Complete with Permissions Fix
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');

const migrateUserAccess = require('../utils/migrateUserAccess');
// Generate JWT Token
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role, v: user.authVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
exports.register = require('./userController').createUser;
// @desc    Login user with Strict Role Verification
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: errors.array()[0]?.msg || 'Validation error',
        errors: errors.array() 
      });
    }

    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // 1. Case-insensitive & trimmed search
    const cleanEmail = email.toLowerCase().trim();
    let user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials. User not found.' });
    }

    // 2. Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials. Incorrect password.' });
    }

    // 3. Check if user is active
    if (user.status !== 'active') {
      return res.status(403).json({ 
        message: `Account is ${user.status}. Please contact administrator.` 
      });
    }

    user = await migrateUserAccess(user);

    // 4. ✅ STRICT ROLE CHECK: Jo role select kiya hai wahi database me hona chahiye
    if (role && user.role !== role) {
      return res.status(403).json({ 
        message: `Role mismatch! This account is registered as '${user.role}', but you selected '${role}'.` 
      });
    }

    // Update last login
    user.lastLogin = new Date();
    if (!user.loginHistory) user.loginHistory = [];
    user.loginHistory.push({
      date: new Date(),
      ip: req.ip || 'Unknown',
      device: req.headers['user-agent'] || 'Unknown'
    });
    await user.save();

    // Remove password from response
    const userResponse = user.toObject();
    delete userResponse.password;

    // Generate token
    const token = generateToken(user);

    res.json({
      success: true,
      token,
      user: userResponse
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const result = user.toObject();
    delete result.password;
    res.json(result);
  } catch (error) {
    console.error('GetMe error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || !currentPassword) return res.status(400).json({ message: 'Enter your current password.' });
    const user = await User.findById(req.user.id);

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Update password
    if (typeof newPassword !== 'string' || newPassword.length < 8) return res.status(400).json({ message: 'Use a password of at least 8 characters.' });
    user.password = newPassword;
    user.forcePasswordChange = false;
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res) => {
  try {
    res.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
