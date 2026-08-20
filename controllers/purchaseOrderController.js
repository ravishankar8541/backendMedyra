// controllers/purchaseOrderController.js
const PurchaseOrder = require('../models/PurchaseOrder');
const Product = require('../models/Product');

// ============================================
// CREATE PURCHASE ORDER
// ============================================
exports.createPurchaseOrder = async (req, res) => {
  try {
    const { 
      supplier, 
      supplierId,
      supplierName,
      supplierAddress, 
      supplierGST, 
      supplierContact, 
      supplierEmail,
      ccEmail,
      items, 
      notes, 
      date,
      expectedDate,
      gstType,
      currency,
      exchangeRate,
      subtotal,
      totalTax,
      igst,
      cgst,
      sgst,
      total
    } = req.body;

    // Validate items
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item required' });
    }

    // Process & Map Items with Item-Level GST & Batch Info
    const formattedItems = items.map(item => {
      const qty = parseFloat(item.quantity) || 0;
      const rate = parseFloat(item.unitPrice) || 0;
      const taxRate = parseFloat(item.taxRate) || 0;
      const itemSubtotal = qty * rate;
      const itemTax = itemSubtotal * (taxRate / 100);
      const itemTotalWithTax = itemSubtotal + itemTax;

      return {
        product: item.product || item.productId || 'N/A',
        productId: item.productId || null,
        productName: item.productName || item.name || '',
        name: item.productName || item.name || '',
        batchNumber: item.batchNumber || 'N/A',
        description: item.description || '',
        sku: item.sku || '',
        hsn: item.hsn || '',
        quantity: qty,
        unit: item.unit || 'Strips',
        unitPrice: rate,
        taxRate: taxRate,
        total: itemSubtotal,
        totalWithTax: item.totalWithTax ? parseFloat(item.totalWithTax) : itemTotalWithTax,
        isBatchProduct: item.isBatchProduct !== undefined ? item.isBatchProduct : true
      };
    });

    // Compute or Fallback Order Totals
    const calcSubtotal = subtotal !== undefined ? parseFloat(subtotal) : formattedItems.reduce((sum, i) => sum + i.total, 0);
    const calcTotalTax = totalTax !== undefined ? parseFloat(totalTax) : formattedItems.reduce((sum, i) => sum + (i.totalWithTax - i.total), 0);
    const calcGrandTotal = total !== undefined ? parseFloat(total) : (calcSubtotal + calcTotalTax);

    let calcIgst = 0, calcCgst = 0, calcSgst = 0;
    if (gstType === 'cgst_sgst') {
      calcCgst = cgst !== undefined ? parseFloat(cgst) : (calcTotalTax / 2);
      calcSgst = sgst !== undefined ? parseFloat(sgst) : (calcTotalTax / 2);
    } else {
      calcIgst = igst !== undefined ? parseFloat(igst) : calcTotalTax;
    }

    // Safe PO Number Generation
    const year = new Date().getFullYear();
    const lastOrder = await PurchaseOrder.findOne({
      poNumber: new RegExp(`^PO-${year}/`)
    }).sort({ createdAt: -1 });

    let nextNumber = 1;
    if (lastOrder && lastOrder.poNumber) {
      const parts = lastOrder.poNumber.split('/');
      if (parts.length === 2) {
        const lastSeq = parseInt(parts[1], 10);
        if (!isNaN(lastSeq)) {
          nextNumber = lastSeq + 1;
        }
      }
    }

    let poNumber = `PO-${year}/${String(nextNumber).padStart(3, '0')}`;

    while (await PurchaseOrder.exists({ poNumber })) {
      nextNumber++;
      poNumber = `PO-${year}/${String(nextNumber).padStart(3, '0')}`;
    }

    const purchaseOrder = new PurchaseOrder({
      poNumber,
      supplier: supplier || supplierName || 'N/A',
      supplierId: supplierId || null,
      supplierName: supplierName || supplier || '',
      supplierAddress: supplierAddress || 'N/A',
      supplierGST: supplierGST || 'N/A',
      supplierContact: supplierContact || 'N/A',
      supplierEmail: supplierEmail || '',
      ccEmail: ccEmail || '',
      date: date || new Date().toISOString().split('T')[0],
      expectedDate: expectedDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      items: formattedItems,
      currency: currency || 'INR',
      exchangeRate: parseFloat(exchangeRate) || 1,
      subtotal: calcSubtotal,
      gstType: gstType || 'igst',
      totalTax: calcTotalTax,
      igst: calcIgst,
      cgst: calcCgst,
      sgst: calcSgst,
      total: calcGrandTotal,
      status: 'pending',
      notes: notes || 'No notes',
      createdFromAlert: req.body.fromAlert || false,
      alertId: req.body.alertId || null,
      createdBy: req.user?.id || req.user?._id,
      emailSent: false
    });

    await purchaseOrder.save();

    console.log(`✅ Purchase Order ${poNumber} created successfully`);

    res.status(201).json({
      success: true,
      data: purchaseOrder,
      message: `Purchase Order ${poNumber} created successfully`
    });
  } catch (error) {
    console.error('❌ Create purchase order error:', error);
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
        { supplier: { $regex: search, $options: 'i' } },
        { supplierName: { $regex: search, $options: 'i' } }
      ];
    }

    const orders = await PurchaseOrder.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await PurchaseOrder.countDocuments(query);

    const pending = await PurchaseOrder.countDocuments({ status: 'pending' });
    const shipped = await PurchaseOrder.countDocuments({ status: 'shipped' });
    const delivered = await PurchaseOrder.countDocuments({ status: 'delivered' });
    const cancelled = await PurchaseOrder.countDocuments({ status: 'cancelled' });

    res.json({
      success: true,
      data: orders,
      stats: { total, pending, shipped, delivered, cancelled },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ Get purchase orders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET SINGLE PURCHASE ORDER
// ============================================
exports.getPurchaseOrder = async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id)
      .populate('createdBy', 'name email');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }

    res.json({ success: true, data: order });
  } catch (error) {
    console.error('❌ Get purchase order error:', error);
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
    console.error('❌ Update order status error:', error);
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
    console.error('❌ Delete purchase order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};