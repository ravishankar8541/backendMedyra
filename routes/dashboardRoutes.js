const express = require('express');
const router = express.Router();
const {
  getOverview,
  getPerformance
} = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/overview', getOverview);
router.get('/performance', getPerformance);

module.exports = router;