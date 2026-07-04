// controllers/purchaseOrderController.js - FIXED VERSION
const PurchaseOrder = require('../models/PurchaseOrder');
const Product = require('../models/Product');

// ============================================
// CREATE PURCHASE ORDER
// ============================================
exports.createPurchaseOrder = async (req, res) => {
  try {
    const { 
      supplier, 
      supplierAddress, 
      supplierGST, 
      supplierContact, 
      supplierEmail,
      ccEmail,
      items, 
      notes, 
      expectedDate,
      gstType,
      igstRate,
      cgstRate,
      sgstRate
    } = req.body;

    // Validate items
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item required' });
    }

    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    
    let igst = 0, cgst = 0, sgst = 0;
    if (gstType === 'igst') {
      igst = (subtotal * (igstRate || 5)) / 100;
    } else {
      cgst = (subtotal * (cgstRate || 2.5)) / 100;
      sgst = (subtotal * (sgstRate || 2.5)) / 100;
    }
    
    const total = subtotal + igst + cgst + sgst;

    // Generate PO number
    const year = new Date().getFullYear();
    const count = await PurchaseOrder.countDocuments();
    const poNumber = `PO-${year}/${String(count + 1).padStart(3, '0')}`;

    const purchaseOrder = new PurchaseOrder({
      poNumber,
      supplier,
      supplierName: supplier,
      supplierAddress: supplierAddress || 'N/A',
      supplierGST: supplierGST || 'N/A',
      supplierContact: supplierContact || 'N/A',
      supplierEmail: supplierEmail || '',
      ccEmail: ccEmail || '',
      date: new Date().toISOString().split('T')[0],
      expectedDate: expectedDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      items: items.map(item => ({
        product: item.product,
        name: item.product,
        description: item.description || '',
        sku: item.sku || '',
        hsn: item.hsn || '',
        quantity: parseInt(item.quantity) || 0,
        unit: item.unit || 'Strips',
        unitPrice: parseFloat(item.unitPrice) || 0,
        total: (parseInt(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0)
      })),
      subtotal,
      gstType: gstType || 'igst',
      igst,
      igstRate: igstRate || 5,
      cgst,
      cgstRate: cgstRate || 2.5,
      sgst,
      sgstRate: sgstRate || 2.5,
      total,
      status: 'pending',
      notes: notes || 'No notes',
      createdFromAlert: req.body.fromAlert || false,
      alertId: req.body.alertId || null,
      createdBy: req.user.id,
      emailSent: false
    });

    await purchaseOrder.save();

    res.status(201).json({
      success: true,
      data: purchaseOrder,
      message: `Purchase Order ${poNumber} created successfully`
    });
  } catch (error) {
    console.error('Create purchase order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET ALL PURCHASE ORDERS
// ============================================
exports.getPurchaseOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;

    const query = {};
    if (status && status !== 'all') query.status = status;
    if (search) {
      query.$or = [
        { poNumber: { $regex: search, $options: 'i' } },
        { supplier: { $regex: search, $options: 'i' } }
      ];
    }

    const orders = await PurchaseOrder.find(query)
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await PurchaseOrder.countDocuments(query);

    // Stats
    const pending = await PurchaseOrder.countDocuments({ status: 'pending' });
    const shipped = await PurchaseOrder.countDocuments({ status: 'shipped' });
    const delivered = await PurchaseOrder.countDocuments({ status: 'delivered' });
    const cancelled = await PurchaseOrder.countDocuments({ status: 'cancelled' });

    res.json({
      success: true,
      data: orders,
      stats: { total: orders.length, pending, shipped, delivered, cancelled },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get purchase orders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET SINGLE PURCHASE ORDER
// ============================================
exports.getPurchaseOrder = async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id)
      .populate('createdBy', 'name');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }

    res.json({ success: true, data: order });
  } catch (error) {
    console.error('Get purchase order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// UPDATE PURCHASE ORDER STATUS
// ============================================
exports.updatePurchaseOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await PurchaseOrder.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }

    order.status = status;
    if (status === 'delivered') {
      order.deliveryDate = new Date().toISOString().split('T')[0];
    }

    await order.save();

    res.json({
      success: true,
      data: order,
      message: `Order status updated to ${status}`
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// DELETE PURCHASE ORDER
// ============================================
exports.deletePurchaseOrder = async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }

    await order.deleteOne();
    res.json({ success: true, message: 'Purchase order deleted successfully' });
  } catch (error) {
    console.error('Delete purchase order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};