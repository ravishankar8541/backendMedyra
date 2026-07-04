const Revenue = require('../models/Revenue');

// ============================================
// GET REVENUE DATA
// ============================================
exports.getRevenue = async (req, res) => {
  try {
    const { period, year, periodKey } = req.query;

    const query = {};
    if (period) query.period = period;
    if (year) query.year = parseInt(year);
    if (periodKey) query.periodKey = periodKey;

    if (req.user.role === 'telecaller') {
      query.assignedTo = req.user.id;
    }

    const revenue = await Revenue.find(query)
      .sort({ year: 1, periodKey: 1 })
      .populate('assignedTo', 'name email');

    res.json({
      success: true,
      data: revenue
    });
  } catch (error) {
    console.error('Get revenue error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET REVENUE STATISTICS
// ============================================
exports.getRevenueStats = async (req, res) => {
  try {
    const query = req.user.role === 'telecaller'
      ? { assignedTo: req.user.id }
      : {};

    const stats = await Revenue.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$revenue' },
          totalTarget: { $sum: '$target' },
          totalIncentive: { $sum: '$incentive' },
          totalLeads: { $sum: '$leads' },
          totalConverted: { $sum: '$converted' },
          avgProfit: { $avg: '$profit' }
        }
      }
    ]);

    const result = stats[0] || {
      totalRevenue: 0,
      totalTarget: 0,
      totalIncentive: 0,
      totalLeads: 0,
      totalConverted: 0,
      avgProfit: 0
    };

    const conversionRate = result.totalLeads > 0
      ? ((result.totalConverted / result.totalLeads) * 100).toFixed(1)
      : 0;

    res.json({
      success: true,
      data: {
        ...result,
        conversionRate: parseFloat(conversionRate),
        achievementRate: result.totalTarget > 0
          ? ((result.totalRevenue / result.totalTarget) * 100).toFixed(1)
          : 0
      }
    });
  } catch (error) {
    console.error('Get revenue stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET REVENUE BY PERIOD
// ============================================
exports.getRevenueByPeriod = async (req, res) => {
  try {
    const { period } = req.query;

    if (!period || !['monthly', 'quarterly', 'yearly'].includes(period)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid period. Must be monthly, quarterly, or yearly'
      });
    }

    const query = {
      period,
      ...(req.user.role === 'telecaller' && { assignedTo: req.user.id })
    };

    const revenues = await Revenue.find(query)
      .sort({ year: 1, periodKey: 1 })
      .populate('assignedTo', 'name email');

    const formattedData = revenues.map(r => ({
      name: r.periodKey,
      year: r.year,
      revenue: r.revenue,
      target: r.target,
      leads: r.leads,
      converted: r.converted,
      profit: r.profit,
      incentive: r.incentive
    }));

    res.json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    console.error('Get revenue by period error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};