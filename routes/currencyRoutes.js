const express = require('express');
const router = express.Router();
const {
  getCurrencyRates,
  updateCurrencyRates,
  refreshRates,
  convertCurrency
} = require('../controllers/currencyController');
const { protect, authorize } = require('../middleware/auth');

router.get('/rates', protect, getCurrencyRates);
router.put('/rates', protect, authorize(), updateCurrencyRates);
router.post('/refresh', protect, authorize(), refreshRates);
router.post('/convert', protect, convertCurrency);

module.exports = router;