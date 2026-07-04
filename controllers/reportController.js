const Invoice = require('../models/Invoice');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const PurchaseOrder = require('../models/PurchaseOrder');

// @desc    Get sales report
// @route   GET /api/reports/sales
// @access  Private
exports.getSalesReport = async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'month' } = req.query;

    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    // Group sales by period
    const salesData = await Invoice.aggregate([
      { $match: { ...dateFilter, status: 'paid' } },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' },
            day: { $dayOfMonth: '$date' }
          },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Get top products
    const topProducts = await Invoice.aggregate([
      { $match: { ...dateFilter, status: 'paid' } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.description',
          totalSold: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.amount' }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      success: true,
      data: {
        salesData,
        topProducts,
        summary: {
          totalRevenue: salesData.reduce((sum, d) => sum + d.revenue, 0),
          totalOrders: salesData.reduce((sum, d) => sum + d.orders, 0),
          averageOrderValue: salesData.length ? 
            salesData.reduce((sum, d) => sum + d.revenue, 0) / 
            salesData.reduce((sum, d) => sum + d.orders, 0) : 0
        }
      }
    });
  } catch (error) {
    console.error('Get sales report error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get inventory report
// @route   GET /api/reports/inventory
// @access  Private
exports.getInventoryReport = async (req, res) => {
  try {
    const products = await Product.find()
      .populate('supplier', 'name')
      .sort({ 'inventory.stock': 1 });

    const lowStock = products.filter(p => p.inventory.stock <= p.inventory.minStock);
    const criticalStock = lowStock.filter(p => p.inventory.stock <= p.inventory.minStock * 0.5);

    // Category breakdown
    const categories = await Product.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          stock: { $sum: '$inventory.stock' },
          value: { 
            $sum: { $multiply: ['$inventory.stock', '$pricing.sellingPrice'] } 
          }
        }
      },
      { $sort: { stock: -1 } }
    ]);

    res.json({
      success: true,
      data: {
        products,
        summary: {
          totalProducts: products.length,
          totalValue: products.reduce((sum, p) => sum + (p.inventory.stock * p.pricing.sellingPrice), 0),
          lowStock: lowStock.length,
          criticalStock: criticalStock.length,
          categories
        }
      }
    });
  } catch (error) {
    console.error('Get inventory report error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get user report
// @route   GET /api/reports/users
// @access  Private (Admin)
exports.getUserReport = async (req, res) => {
  try {
    const users = await User.find().select('-password');

    const roleDistribution = {};
    const statusDistribution = {};
    users.forEach(user => {
      roleDistribution[user.role] = (roleDistribution[user.role] || 0) + 1;
      statusDistribution[user.status] = (statusDistribution[user.status] || 0) + 1;
    });

    // User activity (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activeUsers = await User.countDocuments({
      lastLogin: { $gte: thirtyDaysAgo }
    });

    res.json({
      success: true,
      data: {
        users,
        summary: {
          totalUsers: users.length,
          activeUsers,
          roleDistribution,
          statusDistribution,
          newThisMonth: await User.countDocuments({
            createdAt: { $gte: thirtyDaysAgo }
          })
        }
      }
    });
  } catch (error) {
    console.error('Get user report error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};