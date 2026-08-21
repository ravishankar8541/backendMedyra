const mongoose = require('mongoose');
const PurchaseOrder = require('../models/PurchaseOrder');
const Product = require('../models/Product');

// ===== HELPER: Check valid MongoDB ObjectId =====
const isValidObjectId = (id) => {
  if (!id) return false;
  return mongoose.Types.ObjectId.isValid(id) && 
         String(new mongoose.Types.ObjectId(id)) === String(id);
};

// ============================================
// CREATE PURCHASE ORDER
// ============================================
exports.createPurchaseOrder = async (req, res) => {
  try {
    const { 
      supplier, supplierId, supplierName, supplierAddress, supplierGST, 
      supplierContact, supplierEmail, supplierCountry, channel,
      ccEmail, items, notes, date, expectedDate,
      gstType, currency, exchangeRate,
      subtotal, totalTax, igst, cgst, sgst, total,
      freight, insurance, inventoryCharges, chargesSubtotal, chargesTax,
      purchaserName
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item required' });
    }

    // ===== SANITIZE IDs =====
    const safeSupplierId = isValidObjectId(supplierId) ? supplierId : null;

    const formattedItems = items.map(item => {
      const qty = parseFloat(item.quantity) || 0;
      const rate = parseFloat(item.unitPrice) || 0;
      const taxRate = parseFloat(item.taxRate) || 0;
      const itemSubtotal = qty * rate;
      const itemTax = itemSubtotal * (taxRate / 100);

      return {
        product: item.product || item.productId || 'N/A',
        productId: isValidObjectId(item.productId) ? item.productId : null,
        productName: item.productName || item.name || '',
        name: item.productName || item.name || '',
        batchNumber: item.batchNumber || 'N/A',
        description: item.description || '',
        sku: item.sku || '',
        hsn: item.hsn || '',
        quantity: qty,
        receivedQty: 0,
        remainingQty: qty,
        unit: item.unit || 'Strips',
        unitPrice: rate,
        taxRate: taxRate,
        total: itemSubtotal,
        totalWithTax: itemSubtotal + itemTax,
        isBatchProduct: item.isBatchProduct !== undefined ? item.isBatchProduct : true
      };
    });

    const freightData = {
      amount: parseFloat(freight?.amount) || 0,
      taxRate: parseFloat(freight?.taxRate) || 0,
      taxAmount: parseFloat(freight?.taxAmount) || 0
    };
    const insuranceData = {
      amount: parseFloat(insurance?.amount) || 0,
      taxRate: parseFloat(insurance?.taxRate) || 0,
      taxAmount: parseFloat(insurance?.taxAmount) || 0
    };
    const inventoryData = {
      amount: parseFloat(inventoryCharges?.amount) || 0,
      taxRate: parseFloat(inventoryCharges?.taxRate) || 0,
      taxAmount: parseFloat(inventoryCharges?.taxAmount) || 0
    };

    const calcSubtotal = subtotal !== undefined ? parseFloat(subtotal) : 
      formattedItems.reduce((sum, i) => sum + i.total, 0);
    const calcChargesSubtotal = chargesSubtotal !== undefined ? parseFloat(chargesSubtotal) : 
      freightData.amount + insuranceData.amount + inventoryData.amount;
    const calcChargesTax = chargesTax !== undefined ? parseFloat(chargesTax) : 
      freightData.taxAmount + insuranceData.taxAmount + inventoryData.taxAmount;
    const calcTotalTax = totalTax !== undefined ? parseFloat(totalTax) : 
      formattedItems.reduce((sum, i) => sum + (i.totalWithTax - i.total), 0) + calcChargesTax;
    const calcGrandTotal = total !== undefined ? parseFloat(total) : 
      calcSubtotal + calcChargesSubtotal + calcTotalTax;

    let calcIgst = 0, calcCgst = 0, calcSgst = 0;
    if (gstType === 'cgst_sgst') {
      calcCgst = cgst !== undefined ? parseFloat(cgst) : (calcTotalTax / 2);
      calcSgst = sgst !== undefined ? parseFloat(sgst) : (calcTotalTax / 2);
    } else {
      calcIgst = igst !== undefined ? parseFloat(igst) : calcTotalTax;
    }

    // Generate unique PO number
    const year = new Date().getFullYear();
    const lastOrder = await PurchaseOrder.findOne({
      poNumber: new RegExp(`^PO-${year}/`)
    }).sort({ createdAt: -1 });

    let nextNumber = 1;
    if (lastOrder && lastOrder.poNumber) {
      const parts = lastOrder.poNumber.split('/');
      if (parts.length === 2) {
        const lastSeq = parseInt(parts[1], 10);
        if (!isNaN(lastSeq)) nextNumber = lastSeq + 1;
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
      supplierId: safeSupplierId,
      supplierName: supplierName || supplier || '',
      supplierAddress: supplierAddress || 'N/A',
      supplierGST: supplierGST || 'N/A',
      supplierContact: supplierContact || 'N/A',
      supplierEmail: supplierEmail || '',
      supplierCountry: supplierCountry || 'India',
      channel: channel || 'domestic',
      ccEmail: ccEmail || '',
      date: date || new Date().toISOString().split('T')[0],
      expectedDate: expectedDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      items: formattedItems,
      purchaserName: purchaserName || req.body.purchaserName || '',
      currency: currency || 'INR',
      exchangeRate: parseFloat(exchangeRate) || 1,
      subtotal: calcSubtotal,
      gstType: gstType || 'igst',
      totalTax: calcTotalTax,
      igst: calcIgst,
      cgst: calcCgst,
      sgst: calcSgst,
      total: calcGrandTotal,
      freight: freightData,
      insurance: insuranceData,
      inventoryCharges: inventoryData,
      chargesSubtotal: calcChargesSubtotal,
      chargesTax: calcChargesTax,
      status: 'pending',
      notes: notes || 'No notes',
      createdFromAlert: req.body.fromAlert || false,
      alertId: req.body.alertId || null,
      createdBy: req.user?.id || req.user?._id,
      emailSent: false,
      partiallyReceived: false,
      receivedPercentage: 0
    });

    await purchaseOrder.save();

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

exports.getPurchaseOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const query = {};

    if (status && status !== 'all') {
      const statuses = status.split(',').map(s => s.trim());
      if (statuses.length === 1) {
        query.status = statuses[0];
      } else {
        query.status = { $in: statuses };
      }
    }

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
    const partiallyReceived = await PurchaseOrder.countDocuments({ status: 'partially_received' });

    // Calculate total received quantities
    const ordersWithReceipts = orders.map(order => {
      const totalOrdered = order.items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
      const totalReceived = order.items.reduce((sum, i) => sum + (Number(i.receivedQty) || 0), 0);
      return {
        ...order.toObject(),
        totalOrdered,
        totalReceived,
        remainingQty: totalOrdered - totalReceived,
        receivedPercentage: totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0
      };
    });

    res.json({
      success: true,
      data: ordersWithReceipts,
      stats: { total, pending, shipped, delivered, cancelled, partiallyReceived },
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

exports.getPurchaseOrder = async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id)
      .populate('createdBy', 'name email');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }

    const totalOrdered = order.items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
    const totalReceived = order.items.reduce((sum, i) => sum + (Number(i.receivedQty) || 0), 0);

    res.json({
      success: true,
      data: {
        ...order.toObject(),
        totalOrdered,
        totalReceived,
        remainingQty: totalOrdered - totalReceived,
        receivedPercentage: totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0
      }
    });
  } catch (error) {
    console.error('❌ Get purchase order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

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