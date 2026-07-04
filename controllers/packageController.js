const Package = require('../models/Package');
const Order = require('../models/Order');

// @desc    Create package
// @route   POST /api/packages
// @access  Private
exports.createPackage = async (req, res) => {
  try {
    const packageData = req.body;
    packageData.createdBy = req.user.id;

    // Get order details if provided
    if (packageData.order) {
      const order = await Order.findById(packageData.order);
      if (order) {
        packageData.customerName = order.customer.name;
        packageData.customerPhone = order.customer.phone;
        packageData.customerAddress = order.customer.address;
      }
    }

    const pkg = new Package(packageData);
    await pkg.save();

    // Update order status
    if (packageData.order) {
      await Order.findByIdAndUpdate(packageData.order, {
        orderStatus: 'packed'
      });
    }

    res.status(201).json({
      success: true,
      data: pkg
    });
  } catch (error) {
    console.error('Create package error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all packages
// @route   GET /api/packages
// @access  Private
exports.getPackages = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, priority, search } = req.query;

    const query = {};
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (search) {
      query.$or = [
        { orderId: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } }
      ];
    }

    const packages = await Package.find(query)
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Package.countDocuments(query);

    res.json({
      success: true,
      data: packages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get packages error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update package status
// @route   PUT /api/packages/:id/status
// @access  Private
exports.updatePackageStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const pkg = await Package.findById(req.params.id);

    if (!pkg) {
      return res.status(404).json({ message: 'Package not found' });
    }

    pkg.status = status;
    if (status === 'completed') {
      pkg.completedDate = new Date();
    }

    await pkg.save();
    res.json({ success: true, data: pkg });
  } catch (error) {
    console.error('Update package status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Mark label generated
// @route   PUT /api/packages/:id/label
// @access  Private
exports.markLabelGenerated = async (req, res) => {
  try {
    const pkg = await Package.findById(req.params.id);
    if (!pkg) {
      return res.status(404).json({ message: 'Package not found' });
    }

    pkg.labelGenerated = true;
    await pkg.save();

    res.json({ success: true, data: pkg });
  } catch (error) {
    console.error('Mark label generated error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Mark packing slip generated
// @route   PUT /api/packages/:id/slip
// @access  Private
exports.markSlipGenerated = async (req, res) => {
  try {
    const pkg = await Package.findById(req.params.id);
    if (!pkg) {
      return res.status(404).json({ message: 'Package not found' });
    }

    pkg.packingSlipGenerated = true;
    pkg.packingSlipGeneratedAt = new Date();
    await pkg.save();

    res.json({ success: true, data: pkg });
  } catch (error) {
    console.error('Mark slip generated error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};