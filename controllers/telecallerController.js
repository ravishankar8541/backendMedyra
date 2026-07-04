const Lead = require('../models/Lead');
const CallLog = require('../models/CallLog');
const Followup = require('../models/FollowUp'); 
const Revenue = require('../models/Revenue');   



exports.getTelecallerStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalLeads = await Lead.countDocuments({ assignedTo: userId });
    const newLeads = await Lead.countDocuments({ assignedTo: userId, status: 'new' });
    const convertedLeads = await Lead.countDocuments({ assignedTo: userId, status: 'converted' });
    const todayCalls = await CallLog.countDocuments({ agent: userId, date: { $gte: today } });
    const pendingFollowups = await Followup.countDocuments({ assignedTo: userId, status: 'pending' });

    // ✅ Revenue from converted leads
    const revenueData = await Lead.aggregate([
      { $match: { assignedTo: userId, status: 'converted' } },
      { 
        $group: { 
          _id: null, 
          totalRevenue: { $sum: '$value' },
          totalIncentive: { $sum: '$incentive' },
          avgProfit: { $avg: '$profit' }
        } 
      }
    ]);

    // ✅ Get total target from Revenue model
    const targetData = await Revenue.aggregate([
      { $match: { assignedTo: userId } },
      { $group: { _id: null, totalTarget: { $sum: '$target' } } }
    ]);

    const totalRevenue = revenueData[0]?.totalRevenue || 0;
    const totalIncentive = revenueData[0]?.totalIncentive || 0;
    const avgProfit = revenueData[0]?.avgProfit || 0;
    const totalTarget = targetData[0]?.totalTarget || 0;

    res.json({
      success: true,
      data: {
        totalLeads,
        newLeads,
        convertedLeads,
        todayCalls,
        pendingFollowups,
        totalRevenue,
        revenue: totalRevenue, // For backward compatibility
        totalIncentive,
        avgProfit,
        totalTarget
      }
    });
  } catch (error) {
    console.error('Get telecaller stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
// ============================================
// CREATE CALL LOG
// ============================================
exports.createCallLog = async (req, res) => {
  try {
    const callData = req.body;
    callData.agent = req.user.id;
    callData.agentName = req.user.name;

    // Get lead details
    if (callData.lead) {
      const lead = await Lead.findById(callData.lead);
      if (lead) {
        callData.leadName = lead.name;
        callData.leadPhone = lead.phone;
      }
    }

    const callLog = new CallLog(callData);
    await callLog.save();

    // Update lead status if needed
    if (callData.lead && callData.status === 'completed') {
      await Lead.findByIdAndUpdate(callData.lead, {
        status: 'contacted',
        lastContact: new Date(),
        notes: callData.notes
      });
    }

    res.status(201).json({
      success: true,
      data: callLog,
      message: 'Call logged successfully'
    });
  } catch (error) {
    console.error('Create call log error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET CALL LOGS
// ============================================
exports.getCallLogs = async (req, res) => {
  try {
    const { page = 1, limit = 10, startDate, endDate } = req.query;

    const query = { agent: req.user.id };
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const callLogs = await CallLog.find(query)
      .populate('lead', 'name phone')
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await CallLog.countDocuments(query);

    res.json({
      success: true,
      data: callLogs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get call logs error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};