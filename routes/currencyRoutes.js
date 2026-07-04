const express = require('express');
const router = express.Router();
const {
  getCurrencyRates,
  updateCurrencyRates,
  refreshRates,
  convertCurrency
} = require('../controllers/currencyController');
const { protect, restrictTo } = require('../middleware/auth');

router.get('/rates', protect, getCurrencyRates);
router.put('/rates', protect, restrictTo('admin'), updateCurrencyRates);
router.post('/refresh', protect, restrictTo('admin'), refreshRates);
router.post('/convert', protect, convertCurrency);

module.exports = router;