const Lead = require('../models/Lead');
const Revenue = require('../models/Revenue');
const User = require('../models/User');
const Product = require('../models/Product');

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

// ✅ Calculate item totals
const calculateItemTotals = (item) => {
  const qty = item.quantity || 1;
  const sellingPrice = item.sellingPrice || 0;
  const costPrice = item.costPrice || 0;
  
  const totalValue = sellingPrice * qty;
  const totalCost = costPrice * qty;
  const profitAmount = totalValue - totalCost;
  const profitPercentage = totalCost > 0 ? (profitAmount / totalCost) * 100 : 0;
  const incentive = calculateIncentive(profitPercentage, totalValue);
  
  return {
    ...item,
    totalValue,
    profitAmount,
    profitPercentage,
    incentive
  };
};

// ✅ Update Revenue Helper
const updateRevenue = async (lead, action) => {
  try {
    const date = new Date(lead.date || Date.now());
    const month = date.toLocaleString('default', { month: 'short' });
    const year = date.getFullYear();
    const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`;

    const totalValue = lead.totalValue || lead.value || 0;
    const totalProfit = lead.totalProfit || lead.profit || 0;
    const profitPercentage = totalValue > 0 ? (totalProfit / totalValue) * 100 : 0;
    const incentive = lead.totalIncentive || lead.incentive || 0;

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
          revenue: action === 'add' ? totalValue : 0,
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
          revenue: action === 'add' ? totalValue : 0,
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
          revenue: action === 'add' ? totalValue : 0,
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
// CREATE LEAD - Updated for multiple products
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

    // ✅ Process items if present
    if (leadData.items && leadData.items.length > 0) {
      // Get product details for each item
      for (let item of leadData.items) {
        if (item.productId) {
          const product = await Product.findById(item.productId);
          if (product) {
            item.productName = product.name;
            item.productSku = product.sku;
            // If cost price not provided, get from product
            if (!item.costPrice) {
              item.costPrice = product.pricing?.costPrice || 0;
            }
          }
        }
        // Calculate totals for each item
        const calculatedItem = calculateItemTotals(item);
        Object.assign(item, calculatedItem);
      }
      
      // Calculate totals
      let totalValue = 0;
      let totalProfit = 0;
      let totalIncentive = 0;
      leadData.items.forEach(item => {
        totalValue += item.totalValue || 0;
        totalProfit += item.profitAmount || 0;
        totalIncentive += item.incentive || 0;
      });
      
      leadData.totalValue = totalValue;
      leadData.totalProfit = totalProfit;
      leadData.totalIncentive = totalIncentive;
      
      // Legacy fields for compatibility
      leadData.value = totalValue;
      leadData.profit = totalProfit;
      leadData.incentive = totalIncentive;
    } else {
      // ✅ Legacy single product support
      if (leadData.value) {
        leadData.profit = leadData.value * 0.2;
        leadData.incentive = calculateIncentive(leadData.value, 20);
      }
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
// GET SINGLE LEAD - NEW
// ============================================
exports.getLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name');

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    res.json({
      success: true,
      data: lead
    });
  } catch (error) {
    console.error('Get lead error:', error);
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

    if (req.user.role === 'telecaller' &&
        lead.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    lead.status = status;
    if (notes) lead.notes = notes;
    if (status === 'converted') {
      lead.conversionDate = new Date();

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
          totalValue: { $sum: { $ifNull: ['$totalValue', '$value'] } },
          totalIncentive: { $sum: { $ifNull: ['$totalIncentive', '$incentive'] } },
          avgValue: { $avg: { $ifNull: ['$totalValue', '$value'] } }
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