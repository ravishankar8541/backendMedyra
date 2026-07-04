const CurrencyRate = require('../models/CurrencyRate');
const axios = require('axios');

// @desc    Get currency rates
// @route   GET /api/currency/rates
// @access  Private
exports.getCurrencyRates = async (req, res) => {
  try {
    let rates = await CurrencyRate.getLatest();

    if (!rates || rates.isStale()) {
      // Fetch from external API
      rates = await fetchLatestRates();
    }

    res.json({
      success: true,
      data: rates
    });
  } catch (error) {
    console.error('Get currency rates error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update currency rates (manual)
// @route   PUT /api/currency/rates
// @access  Private (Admin)
exports.updateCurrencyRates = async (req, res) => {
  try {
    const { rates } = req.body;

    const currencyRate = new CurrencyRate({
      baseCurrency: 'USD',
      rates: rates,
      timestamp: new Date(),
      provider: 'Manual'
    });

    await currencyRate.save();

    res.json({
      success: true,
      data: currencyRate
    });
  } catch (error) {
    console.error('Update currency rates error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Refresh currency rates from API
// @route   POST /api/currency/refresh
// @access  Private (Admin)
exports.refreshRates = async (req, res) => {
  try {
    const rates = await fetchLatestRates();

    res.json({
      success: true,
      data: rates,
      message: 'Rates refreshed successfully'
    });
  } catch (error) {
    console.error('Refresh rates error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Helper function to fetch rates from external API
async function fetchLatestRates() {
  try {
    const apiKey = process.env.CURRENCY_API_KEY;
    const url = `https://openexchangerates.org/api/latest.json?app_id=${apiKey}`;
    
    const response = await axios.get(url);
    const rates = new CurrencyRate({
      baseCurrency: 'USD',
      rates: response.data.rates,
      timestamp: new Date(response.data.timestamp * 1000),
      provider: 'OpenExchangeRates'
    });

    await rates.save();
    return rates;
  } catch (error) {
    console.error('Fetch rates error:', error);
    // Return cached rates or default
    const cached = await CurrencyRate.getLatest();
    if (cached) return cached;
    
    // Default rates
    const defaultRates = new CurrencyRate({
      baseCurrency: 'USD',
      rates: {
        USD: 1,
        INR: 83.42,
        EUR: 0.92,
        GBP: 0.79,
        AED: 3.67,
        SAR: 3.75,
        JPY: 154.32,
        CNY: 7.24,
        CAD: 1.37,
        AUD: 1.52
      },
      timestamp: new Date(),
      provider: 'Default'
    });
    await defaultRates.save();
    return defaultRates;
  }
}

// @desc    Convert currency
// @route   POST /api/currency/convert
// @access  Private
exports.convertCurrency = async (req, res) => {
  try {
    const { amount, from, to } = req.body;

    const rates = await CurrencyRate.getLatest();
    if (!rates) {
      return res.status(404).json({ message: 'Currency rates not available' });
    }

    const rateMap = rates.rates;
    const fromRate = rateMap.get(from) || 1;
    const toRate = rateMap.get(to) || 1;

    const convertedAmount = (amount / fromRate) * toRate;

    res.json({
      success: true,
      data: {
        amount,
        from,
        to,
        rate: toRate / fromRate,
        convertedAmount
      }
    });
  } catch (error) {
    console.error('Convert currency error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};