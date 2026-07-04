const Lead = require('../models/Lead');
const Followup = require('../models/FollowUp');
const Revenue = require('../models/Revenue');

// ============================================
// GET DASHBOARD OVERVIEW
// ============================================
exports.getOverview = async (req, res) => {
  try {
    const query = req.user.role === 'telecaller'
      ? { assignedTo: req.user.id }
      : {};

    // ✅ Lead statistics
    const leadStats = await Lead.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          new: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } },
          contacted: { $sum: { $cond: [{ $eq: ['$status', 'contacted'] }, 1, 0] } },
          qualified: { $sum: { $cond: [{ $eq: ['$status', 'qualified'] }, 1, 0] } },
          converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
          totalValue: { $sum: '$value' },
          totalIncentive: { $sum: '$incentive' }
        }
      }
    ]);

    // ✅ Followup statistics
    const followupStats = await Followup.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          highPriority: { $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] } }
        }
      }
    ]);

    // ✅ Revenue statistics
    const revenueStats = await Revenue.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$revenue' },
          totalTarget: { $sum: '$target' },
          totalIncentive: { $sum: '$incentive' }
        }
      }
    ]);

    // ✅ Recent leads
    const recentLeads = await Lead.find(query)
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('assignedTo', 'name');

    // ✅ Today's followups
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todaysFollowups = await Followup.find({
      ...query,
      date: { $gte: today, $lt: tomorrow },
      status: 'pending'
    }).populate('assignedTo', 'name');

    const totalLeads = leadStats[0]?.total || 0;
    const convertedLeads = leadStats[0]?.converted || 0;
    const conversionRate = totalLeads > 0
      ? ((convertedLeads / totalLeads) * 100).toFixed(1)
      : 0;

    res.json({
      success: true,
      data: {
        stats: {
          totalLeads,
          convertedLeads,
          conversionRate: parseFloat(conversionRate),
          totalRevenue: revenueStats[0]?.totalRevenue || 0,
          totalTarget: revenueStats[0]?.totalTarget || 0,
          totalIncentive: revenueStats[0]?.totalIncentive || 0,
          pendingFollowups: followupStats[0]?.pending || 0,
          highPriorityFollowups: followupStats[0]?.highPriority || 0,
          leadBreakdown: {
            new: leadStats[0]?.new || 0,
            contacted: leadStats[0]?.contacted || 0,
            qualified: leadStats[0]?.qualified || 0,
            converted: leadStats[0]?.converted || 0,
            lost: leadStats[0]?.lost || 0
          }
        },
        recentLeads,
        todaysFollowups
      }
    });
  } catch (error) {
    console.error('Dashboard overview error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET PERFORMANCE METRICS
// ============================================
exports.getPerformance = async (req, res) => {
  try {
    const query = req.user.role === 'telecaller'
      ? { assignedTo: req.user.id }
      : {};

    const performance = await Lead.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$assignedTo',
          name: { $first: '$assignedToName' },
          totalLeads: { $sum: 1 },
          converted: {
            $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] }
          },
          totalValue: { $sum: '$value' },
          totalIncentive: { $sum: '$incentive' }
        }
      },
      {
        $project: {
          name: 1,
          totalLeads: 1,
          converted: 1,
          totalValue: 1,
          totalIncentive: 1,
          conversionRate: {
            $cond: [
              { $eq: ['$totalLeads', 0] },
              0,
              { $multiply: [{ $divide: ['$converted', '$totalLeads'] }, 100] }
            ]
          }
        }
      },
      { $sort: { totalValue: -1 } }
    ]);

    // ✅ Populate user details
    const User = require('../models/User.model');
    const populatedPerformance = await User.populate(performance, {
      path: '_id',
      select: 'name email'
    });

    res.json({
      success: true,
      data: populatedPerformance
    });
  } catch (error) {
    console.error('Performance metrics error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};