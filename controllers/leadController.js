// controllers/leadController.js - FINAL VERSION

const Lead = require('../models/Lead');
const Revenue = require('../models/Revenue');
const User = require('../models/User');
const Product = require('../models/Product');

// ✅ Incentive Calculation
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

// ✅ CREATE LEAD
exports.createLead = async (req, res) => {
  try {
    const leadData = req.body;
    leadData.createdBy = req.user.id;
    leadData.assignedTo = leadData.assignedTo || req.user.id;

    if (leadData.assignedTo) {
      const user = await User.findById(leadData.assignedTo);
      if (user) leadData.assignedToName = user.name;
    }

    if (leadData.items && leadData.items.length > 0) {
      for (let item of leadData.items) {
        if (item.productId) {
          const product = await Product.findById(item.productId);
          if (product) {
            item.productName = product.name;
            item.productSku = product.sku;
            if (!item.costPrice) {
              item.costPrice = product.pricing?.costPrice || 0;
            }
          }
        }
        const calculatedItem = calculateItemTotals(item);
        Object.assign(item, calculatedItem);
      }
      
      let totalValue = 0, totalProfit = 0, totalIncentive = 0;
      leadData.items.forEach(item => {
        totalValue += item.totalValue || 0;
        totalProfit += item.profitAmount || 0;
        totalIncentive += item.incentive || 0;
      });
      
      leadData.totalValue = totalValue;
      leadData.totalProfit = totalProfit;
      leadData.totalIncentive = totalIncentive;
      leadData.value = totalValue;
      leadData.profit = totalProfit;
      leadData.incentive = totalIncentive;
    } else {
      if (leadData.value) {
        leadData.profit = leadData.value * 0.2;
        leadData.incentive = calculateIncentive(leadData.value, 20);
      }
    }

    const lead = new Lead(leadData);
    await lead.save();

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

// ✅ GET ALL LEADS
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
      .populate('assignedTo', 'name email role')
      .populate('createdBy', 'name')
      .sort(sortBy)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Lead.countDocuments(query);

    let stats = null;
    if (['accountant', 'admin', 'manager'].includes(req.user.role)) {
      stats = await Lead.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            totalValue: { $sum: '$value' },
            totalIncentive: { $sum: '$incentive' },
            converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
            new: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } },
            contacted: { $sum: { $cond: [{ $eq: ['$status', 'contacted'] }, 1, 0] } },
            qualified: { $sum: { $cond: [{ $eq: ['$status', 'qualified'] }, 1, 0] } }
          }
        }
      ]);
      stats = stats[0] || null;
    }

    res.json({
      success: true,
      data: leads,
      stats,
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

// ✅ GET SINGLE LEAD
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

// ✅ UPDATE LEAD STATUS
exports.updateLeadStatus = async (req, res) => {
  try {
    const { status, notes, quotationAmount, paymentDetails } = req.body;
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    if (req.user.role === 'telecaller' &&
        lead.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const validTransitions = {
      'new': ['contacted', 'lost'],
      'contacted': ['qualified', 'lost'],
      'qualified': ['quotation_sent', 'lost'],
      'quotation_sent': ['order_confirmed', 'lost'],
      'order_confirmed': ['payment_pending', 'lost'],
      'payment_pending': ['converted', 'lost'],
      'converted': [],
      'lost': []
    };

    if (!validTransitions[lead.status]?.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from '${lead.status}' to '${status}'`
      });
    }

    const oldStatus = lead.status;
    lead.status = status;
    if (notes) lead.notes = notes;

    switch(status) {
      case 'quotation_sent':
        lead.quotation = {
          sentDate: new Date(),
          amount: quotationAmount || lead.value,
          notes: notes || 'Quotation sent',
          followUpDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
        };
        break;

      case 'order_confirmed':
        lead.orderConfirmedAt = new Date();
        break;

      case 'payment_pending':
        if (paymentDetails) {
          lead.payment = {
            status: 'pending',
            amount: paymentDetails.amount || lead.value,
            method: paymentDetails.method || 'advance',
            dueDate: paymentDetails.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            notes: paymentDetails.notes || 'Awaiting payment'
          };
        }
        break;

      case 'converted':
        lead.conversionDate = new Date();
        
        if (lead.value && !lead.profit) {
          lead.profit = lead.value * 0.2;
          lead.incentive = calculateIncentive(lead.value, 20);
        }
        
        if (lead.payment) {
          lead.payment.status = 'paid';
          lead.payment.date = new Date();
        }
        
        await updateRevenue(lead, 'add');
        break;
    }

    lead.statusHistory.push({
      status: status,
      date: new Date(),
      notes: notes || `Status updated from ${oldStatus} to ${status}`,
      updatedBy: req.user.id
    });

    await lead.save();
    await lead.populate('assignedTo', 'name email');
    await lead.populate('createdBy', 'name');

    const statusMessages = {
      'new': 'Lead added successfully',
      'contacted': 'Lead marked as contacted',
      'qualified': 'Lead qualified successfully',
      'quotation_sent': 'Quotation sent successfully',
      'order_confirmed': 'Order confirmed by customer',
      'payment_pending': 'Waiting for customer payment',
      'converted': '🎉 Lead converted successfully!',
      'lost': 'Lead marked as lost'
    };

    res.json({
      success: true,
      data: lead,
      message: statusMessages[status] || `Status updated to ${status}`
    });
  } catch (error) {
    console.error('Update lead status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ ASSIGN LEAD
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

// ✅ DELETE LEAD
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

// ✅ GET LEAD STATS
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
          quotation_sent: { $sum: { $cond: [{ $eq: ['$status', 'quotation_sent'] }, 1, 0] } },
          order_confirmed: { $sum: { $cond: [{ $eq: ['$status', 'order_confirmed'] }, 1, 0] } },
          payment_pending: { $sum: { $cond: [{ $eq: ['$status', 'payment_pending'] }, 1, 0] } },
          converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
          totalValue: { $sum: { $ifNull: ['$totalValue', '$value'] } },
          totalIncentive: { $sum: { $ifNull: ['$totalIncentive', '$incentive'] } },
          avgValue: { $avg: { $ifNull: ['$totalValue', '$value'] } }
        }
      }
    ]);

    const result = stats[0] || {
      total: 0,
      new: 0,
      contacted: 0,
      qualified: 0,
      quotation_sent: 0,
      order_confirmed: 0,
      payment_pending: 0,
      converted: 0,
      lost: 0,
      totalValue: 0,
      totalIncentive: 0,
      avgValue: 0
    };

    result.conversionRate = result.total > 0 
      ? ((result.converted / result.total) * 100).toFixed(1)
      : 0;

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get lead stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ CREATE INVOICE FROM LEAD
exports.createInvoiceFromLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    if (lead.status !== 'converted') {
      return res.status(400).json({ 
        success: false, 
        message: 'Only converted leads can be invoiced' 
      });
    }

    const invoiceData = {
      customer: {
        name: lead.name,
        phone: lead.phone,
        email: lead.email || '',
        address: lead.address || 'N/A',
        gst: lead.gst || '',
        state: lead.state || ''
      },
      items: lead.items && lead.items.length > 0 
        ? lead.items.map(item => ({
            description: item.productName || 'Product',
            quantity: item.quantity || 1,
            rate: item.sellingPrice || 0,
            taxRate: 18,
            amount: item.totalValue || 0,
            batch: item.batch || '',
            hsCode: item.hsCode || ''
          }))
        : [{
            description: lead.productName || 'Product',
            quantity: lead.quantity || 1,
            rate: (lead.value || 0) / (lead.quantity || 1) || 0,
            taxRate: 18,
            amount: lead.value || 0
          }],
      subtotal: lead.totalValue || lead.value || 0,
      tax: ((lead.totalValue || lead.value || 0) * 0.18),
      total: ((lead.totalValue || lead.value || 0) * 1.18),
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      type: 'domestic',
      status: 'draft',
      createdBy: req.user.id,
      leadId: lead._id
    };

    res.json({
      success: true,
      data: invoiceData,
      message: 'Invoice data prepared from lead'
    });
  } catch (error) {
    console.error('Create invoice from lead error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

