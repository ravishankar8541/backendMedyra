const Delivery = require('../models/Delivery');
const Order = require('../models/Order');

// @desc    Create delivery
// @route   POST /api/deliveries
// @access  Private (Admin, Manager)
exports.createDelivery = async (req, res) => {
  try {
    const deliveryData = req.body;
    deliveryData.createdBy = req.user.id;

    // Get order details
    const order = await Order.findById(deliveryData.order);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    deliveryData.orderNumber = order.orderNumber;
    deliveryData.customer = order.customer;

    const delivery = new Delivery(deliveryData);
    await delivery.save();

    // Update order status
    order.orderStatus = 'assigned';
    order.assignedTo = deliveryData.assignedTo;
    order.assignedDate = new Date();
    await order.save();

    res.status(201).json({
      success: true,
      data: delivery
    });
  } catch (error) {
    console.error('Create delivery error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get deliveries
// @route   GET /api/deliveries
// @access  Private
exports.getDeliveries = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, assignedTo, search } = req.query;

    const query = {};
    if (status) query.status = status;
    if (assignedTo) query.assignedTo = assignedTo;
    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { 'customer.name': { $regex: search, $options: 'i' } }
      ];
    }

    const deliveries = await Delivery.find(query)
      .populate('assignedTo', 'name phone')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Delivery.countDocuments(query);

    res.json({
      success: true,
      data: deliveries,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get deliveries error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update delivery status
// @route   PUT /api/deliveries/:id/status
// @access  Private
exports.updateDeliveryStatus = async (req, res) => {
  try {
    const { status, deliveryNote, proofImage } = req.body;
    const delivery = await Delivery.findById(req.params.id);

    if (!delivery) {
      return res.status(404).json({ message: 'Delivery not found' });
    }

    delivery.status = status;
    if (status === 'in_transit') {
      delivery.startedAt = new Date();
    }
    if (status === 'delivered') {
      delivery.completedAt = new Date();
      delivery.deliveryDate = new Date();
      delivery.deliveryNote = deliveryNote || delivery.deliveryNote;
      delivery.proofImage = proofImage || delivery.proofImage;

      // Update order status
      await Order.findByIdAndUpdate(delivery.order, {
        orderStatus: 'delivered',
        deliveredDate: new Date(),
        deliveryNote: deliveryNote,
        proofImage: proofImage
      });
    }

    await delivery.save();
    res.json({ success: true, data: delivery });
  } catch (error) {
    console.error('Update delivery status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get delivery stats
// @route   GET /api/deliveries/stats
// @access  Private
exports.getDeliveryStats = async (req, res) => {
  try {
    const total = await Delivery.countDocuments();
    const assigned = await Delivery.countDocuments({ status: 'assigned' });
    const inTransit = await Delivery.countDocuments({ status: 'in_transit' });
    const delivered = await Delivery.countDocuments({ status: 'delivered' });
    const delayed = await Delivery.countDocuments({ status: 'delayed' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDeliveries = await Delivery.countDocuments({
      createdAt: { $gte: today }
    });

    res.json({
      success: true,
      data: {
        total,
        assigned,
        inTransit,
        delivered,
        delayed,
        todayDeliveries,
        completionRate: total ? ((delivered / total) * 100).toFixed(1) : 0
      }
    });
  } catch (error) {
    console.error('Get delivery stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};