const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getRevenue,
  getRevenueStats,
  getRevenueByPeriod
} = require('../controllers/revenueController');

router.use(protect);

router.get('/', getRevenue);
router.get('/stats', getRevenueStats);
router.get('/by-period', getRevenueByPeriod);

module.exports = router;