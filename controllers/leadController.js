const Lead = require('../models/Lead');
const Revenue = require('../models/Revenue');
const User = require('../models/User');

// ✅ Incentive Calculation Function (Matches Frontend)
const calculateIncentive = (revenue, profitPercentage) => {
  if (profitPercentage < 10) return 0;
  if (profitPercentage >= 10 && profitPercentage < 15) return revenue * 0.004;
  if (profitPercentage >= 15 && profitPercentage < 20) return revenue * 0.0125;
  if (profitPercentage >= 20 && profitPercentage < 25) return revenue * 0.0165;
  if (profitPercentage >= 25 && profitPercentage < 35) return revenue * 0.0185;
  if (profitPercentage >= 35) return revenue * 0.02;
  return 0;
};

// ✅ Update Revenue Helper
const updateRevenue = async (lead, action) => {
  try {
    const date = new Date(lead.date || Date.now());
    const month = date.toLocaleString('default', { month: 'short' });
    const year = date.getFullYear();
    const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`;

    const profitPercentage = lead.value > 0 ? (lead.profit / lead.value) * 100 : 0;
    const incentive = calculateIncentive(lead.value, profitPercentage);

    // Update monthly
    await Revenue.findOneAndUpdate(
      {
        period: 'monthly',
        periodKey: month,
        year: year,
        assignedTo: lead.assignedTo
      },
      {
        $inc: {
          revenue: action === 'add' ? lead.value : 0,
          converted: action === 'add' && lead.status === 'converted' ? 1 : 0,
          leads: action === 'add' ? 1 : 0
        },
        $set: {
          target: 50000,
          profit: profitPercentage,
          incentive: incentive
        }
      },
      { upsert: true, new: true }
    );

    // Update quarterly
    await Revenue.findOneAndUpdate(
      {
        period: 'quarterly',
        periodKey: quarter,
        year: year,
        assignedTo: lead.assignedTo
      },
      {
        $inc: {
          revenue: action === 'add' ? lead.value : 0,
          converted: action === 'add' && lead.status === 'converted' ? 1 : 0,
          leads: action === 'add' ? 1 : 0
        },
        $set: {
          target: 150000,
          profit: profitPercentage,
          incentive: incentive
        }
      },
      { upsert: true, new: true }
    );

    // Update yearly
    await Revenue.findOneAndUpdate(
      {
        period: 'yearly',
        periodKey: year.toString(),
        year: year,
        assignedTo: lead.assignedTo
      },
      {
        $inc: {
          revenue: action === 'add' ? lead.value : 0,
          converted: action === 'add' && lead.status === 'converted' ? 1 : 0,
          leads: action === 'add' ? 1 : 0
        },
        $set: {
          target: 500000,
          profit: profitPercentage,
          incentive: incentive
        }
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('Update revenue error:', error);
  }
};

// ============================================
// CREATE LEAD
// ============================================
exports.createLead = async (req, res) => {
  try {
    const leadData = req.body;
    leadData.createdBy = req.user.id;
    leadData.assignedTo = leadData.assignedTo || req.user.id;

    // ✅ Get assigned user name
    if (leadData.assignedTo) {
      const user = await User.findById(leadData.assignedTo);
      if (user) leadData.assignedToName = user.name;
    }

    // ✅ Calculate profit and incentive
    if (leadData.value) {
      leadData.profit = leadData.value * 0.2; // 20% profit margin
      leadData.incentive = calculateIncentive(leadData.value, 20);
    }

    const lead = new Lead(leadData);
    await lead.save();

    // ✅ Update revenue if converted
    if (leadData.status === 'converted') {
      await updateRevenue(lead, 'add');
    }

    await lead.populate('assignedTo', 'name email');

    res.status(201).json({
      success: true,
      data: lead,
      message: 'Lead created successfully'
    });
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET ALL LEADS
// ============================================
exports.getLeads = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 100,
      status,
      source,
      assignedTo,
      search,
      sortBy = '-createdAt'
    } = req.query;

    const query = {};
    if (status && status !== 'all') query.status = status;
    if (source && source !== 'all') query.source = source;
    if (assignedTo) query.assignedTo = assignedTo;

    // ✅ Filter by assigned user for telecallers
    if (req.user.role === 'telecaller') {
      query.assignedTo = req.user.id;
    }

    if (search) {
      query.$text = { $search: search };
    }

    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name')
      .sort(sortBy)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Lead.countDocuments(query);

    res.json({
      success: true,
      data: leads,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// UPDATE LEAD STATUS
// ============================================
exports.updateLeadStatus = async (req, res) => {
  try {
    const { status, notes } = req.body;
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    // ✅ Check authorization
    if (req.user.role === 'telecaller' &&
        lead.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    lead.status = status;
    if (notes) lead.notes = notes;
    if (status === 'converted') {
      lead.conversionDate = new Date();

      // ✅ Calculate profit and incentive if not set
      if (lead.value && !lead.profit) {
        lead.profit = lead.value * 0.2;
        lead.incentive = calculateIncentive(lead.value, 20);
      }

      await lead.save();
      await updateRevenue(lead, 'add');
    } else {
      await lead.save();
    }

    await lead.populate('assignedTo', 'name email');

    res.json({
      success: true,
      data: lead,
      message: `Lead status updated to ${status}`
    });
  } catch (error) {
    console.error('Update lead status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ASSIGN LEAD
// ============================================
exports.assignLead = async (req, res) => {
  try {
    const { assignedTo } = req.body;
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const user = await User.findById(assignedTo);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    lead.assignedTo = assignedTo;
    lead.assignedToName = user.name;
    await lead.save();

    await lead.populate('assignedTo', 'name email');

    res.json({
      success: true,
      data: lead,
      message: 'Lead assigned successfully'
    });
  } catch (error) {
    console.error('Assign lead error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// DELETE LEAD
// ============================================
exports.deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    // ✅ Check authorization
    if (req.user.role === 'telecaller' &&
        lead.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await lead.deleteOne();

    res.json({
      success: true,
      message: 'Lead deleted successfully'
    });
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET LEAD STATISTICS
// ============================================
exports.getLeadStats = async (req, res) => {
  try {
    const query = req.user.role === 'telecaller'
      ? { assignedTo: req.user.id }
      : {};

    const stats = await Lead.aggregate([
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
          totalIncentive: { $sum: '$incentive' },
          avgValue: { $avg: '$value' }
        }
      }
    ]);

    res.json({
      success: true,
      data: stats[0] || {
        total: 0,
        new: 0,
        contacted: 0,
        qualified: 0,
        converted: 0,
        lost: 0,
        totalValue: 0,
        totalIncentive: 0,
        avgValue: 0
      }
    });
  } catch (error) {
    console.error('Get lead stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};