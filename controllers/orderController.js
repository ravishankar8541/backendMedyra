const Order = require('../models/Order');
const Product = require('../models/Product');

// @desc    Create order
// @route   POST /api/orders
// @access  Private
exports.createOrder = async (req, res) => {
  try {
    const orderData = req.body;
    orderData.createdBy = req.user.id;

    // Validate and calculate totals
    let subtotal = 0;
    const items = [];

    for (const item of orderData.items) {
      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(404).json({ 
          message: `Product ${item.product} not found` 
        });
      }

      const price = product.pricing.sellingPrice;
      const total = item.quantity * price;
      subtotal += total;

      items.push({
        product: item.product,
        name: product.name,
        quantity: item.quantity,
        price: price,
        total: total
      });
    }

    orderData.items = items;
    orderData.subtotal = subtotal;
    orderData.total = subtotal + (orderData.tax || 0) + (orderData.deliveryCharges || 0);

    // Check stock availability
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (product.inventory.stock < item.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for ${product.name}. Available: ${product.inventory.stock}`
        });
      }
    }

    // Create order
    const order = new Order(orderData);
    await order.save();

    // Reduce stock
    for (const item of items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { 'inventory.stock': -item.quantity }
      });
    }

    res.status(201).json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private
exports.getOrders = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      priority,
      assignedTo,
      startDate,
      endDate,
      search 
    } = req.query;

    const query = {};
    if (status) query.orderStatus = status;
    if (priority) query.priority = priority;
    if (assignedTo) query.assignedTo = assignedTo;
    if (startDate && endDate) {
      query.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { 'customer.name': { $regex: search, $options: 'i' } },
        { 'customer.phone': { $regex: search, $options: 'i' } }
      ];
    }

    const orders = await Order.find(query)
      .populate('assignedTo', 'name')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, deliveryNote, proofImage } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    order.orderStatus = status;

    if (status === 'delivered') {
      order.deliveredDate = new Date();
      order.deliveryNote = deliveryNote || order.deliveryNote;
      order.proofImage = proofImage || order.proofImage;
    }

    await order.save();

    res.json({ success: true, data: order });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Assign delivery agent
// @route   PUT /api/orders/:id/assign
// @access  Private
exports.assignOrder = async (req, res) => {
  try {
    const { assignedTo } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    order.assignedTo = assignedTo;
    order.assignedDate = new Date();
    order.orderStatus = 'assigned';

    await order.save();

    res.json({ success: true, data: order });
  } catch (error) {
    console.error('Assign order error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};