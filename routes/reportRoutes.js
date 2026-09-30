const express = require('express');
const router = express.Router();
const {
  getSalesReport,
  getInventoryReport,
  getUserReport
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.get('/sales', authorize(), getSalesReport);
router.get('/inventory', authorize(), getInventoryReport);
router.get('/users', authorize(), getUserReport);

module.exports = router;