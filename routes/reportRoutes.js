const express = require('express');
const router = express.Router();
const {
  getSalesReport,
  getInventoryReport,
  getUserReport
} = require('../controllers/reportController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

router.get('/sales', restrictTo('admin', 'manager', 'accountant'), getSalesReport);
router.get('/inventory', restrictTo('admin', 'manager'), getInventoryReport);
router.get('/users', restrictTo('admin'), getUserReport);

module.exports = router;