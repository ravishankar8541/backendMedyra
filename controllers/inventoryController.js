const Inventory = require('../models/Inventory');
const Product = require('../models/Product');

// ============================================
// GET INVENTORY STATS
// ============================================
exports.getInventoryStats = async (req, res) => {
  try {
    const totalProducts = await Product.countDocuments();
    const totalStock = await Inventory.aggregate([
      { $group: { _id: null, total: { $sum: '$quantity' } } }
    ]);
    const totalValue = await Inventory.aggregate([
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'productData'
        }
      },
      { $unwind: '$productData' },
      {
        $group: {
          _id: null,
          total: { $sum: { $multiply: ['$quantity', '$productData.pricing.sellingPrice'] } }
        }
      }
    ]);
    const lowStock = await Inventory.countDocuments({
      $expr: { $lte: ['$quantity', '$minStock'] }
    });
    const criticalStock = await Inventory.countDocuments({
      $expr: { $lte: ['$quantity', { $multiply: ['$minStock', 0.5] }] }
    });

    res.json({
      success: true,
      data: {
        totalProducts,
        totalStock: totalStock[0]?.total || 0,
        totalValue: totalValue[0]?.total || 0,
        lowStock,
        criticalStock
      }
    });
  } catch (error) {
    console.error('Get inventory stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET LOW STOCK ALERTS
// ============================================
exports.getLowStockAlerts = async (req, res) => {
  try {
    const alerts = await Inventory.find({
      $expr: { $lte: ['$quantity', '$minStock'] }
    }).populate('product', 'name sku pricing.sellingPrice');

    res.json({ success: true, data: alerts });
  } catch (error) {
    console.error('Get low stock alerts error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET INVENTORY BY CATEGORY
// ============================================
exports.getInventoryByCategory = async (req, res) => {
  try {
    const categories = await Inventory.aggregate([
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'productData'
        }
      },
      { $unwind: '$productData' },
      {
        $group: {
          _id: '$productData.category',
          count: { $sum: 1 },
          stock: { $sum: '$quantity' },
          value: { $sum: { $multiply: ['$quantity', '$productData.pricing.sellingPrice'] } }
        }
      },
      { $sort: { stock: -1 } }
    ]);

    res.json({ success: true, data: categories });
  } catch (error) {
    console.error('Get inventory by category error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET ALL INVENTORY
// ============================================
exports.getAllInventory = async (req, res) => {
  try {
    const { page = 1, limit = 10, warehouse, search } = req.query;

    const query = {};
    if (warehouse) query.warehouse = warehouse;
    
    const inventory = await Inventory.find(query)
      .populate('product', 'name sku category pricing.sellingPrice')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Inventory.countDocuments(query);

    res.json({
      success: true,
      data: inventory,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get all inventory error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET SINGLE INVENTORY ITEM
// ============================================
exports.getInventoryItem = async (req, res) => {
  try {
    const inventory = await Inventory.findById(req.params.id)
      .populate('product', 'name sku category pricing');

    if (!inventory) {
      return res.status(404).json({ success: false, message: 'Inventory item not found' });
    }

    res.json({ success: true, data: inventory });
  } catch (error) {
    console.error('Get inventory item error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// CREATE INVENTORY ITEM
// ============================================
exports.createInventory = async (req, res) => {
  try {
    const { product, warehouse, quantity, minStock, maxStock, reorderLevel } = req.body;

    // Check if product exists
    const productExists = await Product.findById(product);
    if (!productExists) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Check if inventory already exists for this product and warehouse
    const existing = await Inventory.findOne({ product, warehouse });
    if (existing) {
      return res.status(400).json({ 
        success: false, 
        message: 'Inventory already exists for this product and warehouse' 
      });
    }

    const inventory = new Inventory({
      product,
      warehouse,
      quantity: quantity || 0,
      minStock: minStock || 0,
      maxStock,
      reorderLevel
    });

    await inventory.save();

    res.status(201).json({
      success: true,
      data: inventory,
      message: 'Inventory created successfully'
    });
  } catch (error) {
    console.error('Create inventory error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// UPDATE INVENTORY
// ============================================
exports.updateInventory = async (req, res) => {
  try {
    const { quantity, minStock, maxStock, reorderLevel } = req.body;
    const inventory = await Inventory.findById(req.params.id);

    if (!inventory) {
      return res.status(404).json({ success: false, message: 'Inventory not found' });
    }

    if (quantity !== undefined) inventory.quantity = quantity;
    if (minStock !== undefined) inventory.minStock = minStock;
    if (maxStock !== undefined) inventory.maxStock = maxStock;
    if (reorderLevel !== undefined) inventory.reorderLevel = reorderLevel;

    await inventory.save();

    res.json({
      success: true,
      data: inventory,
      message: 'Inventory updated successfully'
    });
  } catch (error) {
    console.error('Update inventory error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ADD STOCK MOVEMENT
// ============================================
exports.addStockMovement = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, quantity, reason, reference } = req.body;

    const inventory = await Inventory.findById(id);
    if (!inventory) {
      return res.status(404).json({ success: false, message: 'Inventory not found' });
    }

    // Validate quantity
    if (type === 'out' && inventory.quantity < quantity) {
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient stock' 
      });
    }

    // Update quantity
    if (type === 'in') {
      inventory.quantity += quantity;
    } else if (type === 'out') {
      inventory.quantity -= quantity;
    } else if (type === 'adjustment') {
      inventory.quantity = quantity; // Set to exact quantity
    }

    // Add movement record
    inventory.movements.push({
      type,
      quantity,
      reason,
      reference,
      user: req.user?.id,
      date: new Date()
    });

    inventory.lastRestocked = new Date();

    await inventory.save();

    res.json({
      success: true,
      data: inventory,
      message: 'Stock movement added successfully'
    });
  } catch (error) {
    console.error('Add stock movement error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET STOCK MOVEMENTS
// ============================================
exports.getStockMovements = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50 } = req.query;

    const inventory = await Inventory.findById(id);
    if (!inventory) {
      return res.status(404).json({ success: false, message: 'Inventory not found' });
    }

    const movements = inventory.movements
      .sort((a, b) => b.date - a.date)
      .slice(0, parseInt(limit));

    res.json({
      success: true,
      data: movements
    });
  } catch (error) {
    console.error('Get stock movements error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// DELETE INVENTORY
// ============================================
exports.deleteInventory = async (req, res) => {
  try {
    const inventory = await Inventory.findById(req.params.id);
    if (!inventory) {
      return res.status(404).json({ success: false, message: 'Inventory not found' });
    }

    await inventory.deleteOne();

    res.json({
      success: true,
      message: 'Inventory deleted successfully'
    });
  } catch (error) {
    console.error('Delete inventory error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};