const Followup = require('../models/FollowUp'); 
const Lead = require('../models/Lead');


exports.getFollowups = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 100,
      status,
      priority,
      date,
      search
    } = req.query;

    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }

    if (priority && priority !== 'all') {
      query.priority = priority;
    }

    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      query.date = { $gte: startDate, $lte: endDate };
    }

    // ✅ Filter by assigned user for telecallers
    if (req.user.role === 'telecaller') {
      query.assignedTo = req.user.id;
    }

    if (search) {
      query.$or = [
        { customer: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const followups = await Followup.find(query)
      .populate('assignedTo', 'name email')
      .populate('leadId', 'name phone email')
      .sort({ date: 1, time: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Followup.countDocuments(query);

    res.json({
      success: true,
      data: followups,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get followups error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// CREATE FOLLOWUP
// ============================================
exports.createFollowup = async (req, res) => {
  try {
    const { customer, phone, email, date, time, priority, notes, leadId } = req.body;

    let lead;
    if (leadId) {
      lead = await Lead.findById(leadId);
      if (!lead) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }
    }

    const followup = await Followup.create({
      customer: lead ? lead.name : customer,
      phone: lead ? lead.phone : phone,
      email: lead ? lead.email : email,
      date: new Date(date),
      time,
      priority: priority || 'medium',
      notes,
      leadId: lead ? lead._id : null,
      assignedTo: req.user.id,
      assignedToName: req.user.name
    });

    if (lead) {
      lead.followUpDate = new Date(date);
      await lead.save();
    }

    await followup.populate('assignedTo', 'name email');

    res.status(201).json({
      success: true,
      data: followup,
      message: 'Follow-up created successfully'
    });
  } catch (error) {
    console.error('Create followup error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// UPDATE FOLLOWUP
// ============================================
exports.updateFollowup = async (req, res) => {
  try {
    const followup = await Followup.findById(req.params.id);
    if (!followup) {
      return res.status(404).json({ success: false, message: 'Followup not found' });
    }

    // ✅ Check authorization
    if (req.user.role === 'telecaller' &&
        followup.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const { customer, phone, email, date, time, priority, notes, status } = req.body;

    const updatedFollowup = await Followup.findByIdAndUpdate(
      req.params.id,
      {
        customer: customer || followup.customer,
        phone: phone || followup.phone,
        email: email || followup.email,
        date: date ? new Date(date) : followup.date,
        time: time || followup.time,
        priority: priority || followup.priority,
        notes: notes || followup.notes,
        status: status || followup.status
      },
      { new: true, runValidators: true }
    ).populate('assignedTo', 'name email');

    res.json({
      success: true,
      data: updatedFollowup,
      message: 'Follow-up updated successfully'
    });
  } catch (error) {
    console.error('Update followup error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// COMPLETE FOLLOWUP
// ============================================
exports.completeFollowup = async (req, res) => {
  try {
    const followup = await Followup.findById(req.params.id);
    if (!followup) {
      return res.status(404).json({ success: false, message: 'Followup not found' });
    }

    // ✅ Check authorization
    if (req.user.role === 'telecaller' &&
        followup.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    followup.status = 'completed';
    followup.completedAt = new Date();
    await followup.save();

    // ✅ Update lead last contact
    if (followup.leadId) {
      await Lead.findByIdAndUpdate(followup.leadId, {
        lastContact: new Date()
      });
    }

    await followup.populate('assignedTo', 'name email');

    res.json({
      success: true,
      data: followup,
      message: 'Follow-up marked as completed'
    });
  } catch (error) {
    console.error('Complete followup error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// DELETE FOLLOWUP
// ============================================
exports.deleteFollowup = async (req, res) => {
  try {
    const followup = await Followup.findById(req.params.id);
    if (!followup) {
      return res.status(404).json({ success: false, message: 'Followup not found' });
    }

    // ✅ Check authorization
    if (req.user.role === 'telecaller' &&
        followup.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await followup.deleteOne();

    res.json({
      success: true,
      message: 'Follow-up deleted successfully'
    });
  } catch (error) {
    console.error('Delete followup error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET FOLLOWUP STATISTICS
// ============================================
exports.getFollowupStats = async (req, res) => {
  try {
    const query = req.user.role === 'telecaller'
      ? { assignedTo: req.user.id }
      : {};

    const stats = await Followup.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          },
          highPriority: {
            $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] }
          },
          mediumPriority: {
            $sum: { $cond: [{ $eq: ['$priority', 'medium'] }, 1, 0] }
          },
          lowPriority: {
            $sum: { $cond: [{ $eq: ['$priority', 'low'] }, 1, 0] }
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: stats[0] || {
        total: 0,
        pending: 0,
        completed: 0,
        cancelled: 0,
        highPriority: 0,
        mediumPriority: 0,
        lowPriority: 0
      }
    });
  } catch (error) {
    console.error('Get followup stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};