// controllers/goodsReceiptController.js
const GoodsReceipt = require('../models/GoodsReceipt');
const PurchaseOrder = require('../models/PurchaseOrder');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const PurchaseInvoice = require('../models/PurchaseInvoice');

const generateGRNNumber = async () => {
  const year = new Date().getFullYear();
  const last = await GoodsReceipt.findOne({ 
    grnNumber: new RegExp(`^GRN-${year}/`) 
  }).sort({ createdAt: -1 });

  let next = 1;
  if (last?.grnNumber) {
    const parts = last.grnNumber.split('/');
    if (parts[1]) next = parseInt(parts[1], 10) + 1;
  }

  let grnNumber = `GRN-${year}/${String(next).padStart(3, '0')}`;
  while (await GoodsReceipt.exists({ grnNumber })) {
    next++;
    grnNumber = `GRN-${year}/${String(next).padStart(3, '0')}`;
  }
  return grnNumber;
};

exports.createGRN = async (req, res) => {
  try {
    const {
      purchaseOrderId, poNumber, supplierId, supplierName, supplierGST,
      receivedDate, receivedBy, warehouse, items, notes,
      currency, exchangeRate, freight, insurance, inventoryCharges, gstType
    } = req.body;

    if (!purchaseOrderId || !items || items.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Purchase Order and at least one item required' 
      });
    }

    const po = await PurchaseOrder.findById(purchaseOrderId);
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase Order not found' });
    }

    const grnNumber = await generateGRNNumber();
    let subtotal = 0;
    let totalTax = 0;
    const processedItems = [];

    for (const item of items) {
      const acceptedQty = Number(item.acceptedQty) || 0;
      const receivedQty = Number(item.receivedQty) || 0;
      const rejectedQty = Number(item.rejectedQty) || 0;
      
      if (acceptedQty <= 0 && receivedQty <= 0) continue;

      const product = await Product.findById(item.productId);
      if (!product) continue;

      const rate = Number(item.unitPrice) || 0;
      const taxRate = Number(item.taxRate) || 0;
      const itemSubtotal = acceptedQty * rate;
      const itemTax = itemSubtotal * (taxRate / 100);
      subtotal += itemSubtotal;
      totalTax += itemTax;

      // Update stock
      if (product.productType === 'batch' || product.batches) {
        if (!product.batches) product.batches = [];
        
        const batchNumber = item.batchNumber || `BATCH-${Date.now().toString().slice(-6)}`;
        const existingBatch = product.batches.find(b => b.batchNumber === batchNumber);

        if (existingBatch) {
          existingBatch.quantity = (existingBatch.quantity || 0) + acceptedQty;
          if (item.mfgDate) existingBatch.mfgDate = item.mfgDate;
          if (item.expDate) existingBatch.expDate = item.expDate;
        } else {
          product.batches.push({
            batchNumber: batchNumber,
            mfgDate: item.mfgDate || '',
            expDate: item.expDate || '',
            quantity: acceptedQty,
            addedDate: new Date().toISOString().split('T')[0],
            addedBy: req.user?.name || 'System',
            reason: `Received via GRN ${grnNumber}`
          });
        }
      } else {
        product.stock = (product.stock || 0) + acceptedQty;
      }

      await product.save();

      const orderedQty = Number(item.orderedQty) || 0;
      const alreadyReceived = Number(item.alreadyReceived) || 0;
      const remainingQty = Math.max(0, orderedQty - alreadyReceived - acceptedQty);

      processedItems.push({
        ...item,
        acceptedQty,
        receivedQty,
        rejectedQty,
        remainingQty,
        subtotal: itemSubtotal,
        tax: itemTax,
        totalWithTax: itemSubtotal + itemTax
      });
    }

    // Additional Charges
    const freightData = {
      amount: Number(freight?.amount) || 0,
      taxRate: Number(freight?.taxRate) || 0,
      taxAmount: (Number(freight?.amount) || 0) * (Number(freight?.taxRate) || 0) / 100
    };
    const insuranceData = {
      amount: Number(insurance?.amount) || 0,
      taxRate: Number(insurance?.taxRate) || 0,
      taxAmount: (Number(insurance?.amount) || 0) * (Number(insurance?.taxRate) || 0) / 100
    };
    const inventoryData = {
      amount: Number(inventoryCharges?.amount) || 0,
      taxRate: Number(inventoryCharges?.taxRate) || 0,
      taxAmount: (Number(inventoryCharges?.amount) || 0) * (Number(inventoryCharges?.taxRate) || 0) / 100
    };

    const chargesSubtotal = freightData.amount + insuranceData.amount + inventoryData.amount;
    const chargesTax = freightData.taxAmount + insuranceData.taxAmount + inventoryData.taxAmount;
    const grandTotal = subtotal + totalTax + chargesSubtotal + chargesTax;

    const grn = new GoodsReceipt({
      grnNumber,
      purchaseOrder: purchaseOrderId,
      poNumber: poNumber || po.poNumber,
      supplierId,
      supplierName: supplierName || po.supplierName || '',
      supplierGST: supplierGST || po.supplierGST || '',
      receivedDate: receivedDate || new Date().toISOString().split('T')[0],
      receivedBy: receivedBy || req.user?.name || '',
      warehouse: warehouse || 'Main Warehouse',
      items: processedItems,
      notes: notes || '',
      status: 'completed',
      createdBy: req.user?.id || req.user?._id,
      currency: currency || po.currency || 'INR',
      exchangeRate: exchangeRate || po.exchangeRate || 1,
      subtotal: subtotal,
      totalTax: totalTax,
      chargesSubtotal: chargesSubtotal,
      chargesTax: chargesTax,
      grandTotal: grandTotal,
      freight: freightData,
      insurance: insuranceData,
      inventoryCharges: inventoryData,
      gstType: gstType || po.gstType || 'igst',
      invoiceGenerated: false
    });

    await grn.save();

    // Update PO with received quantities
    const totalOrdered = po.items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
    let totalReceived = 0;

    po.items.forEach((poItem) => {
      const receivedItem = processedItems.find(i => 
        i.productId?.toString() === poItem.productId?.toString()
      );
      if (receivedItem) {
        poItem.receivedQty = (Number(poItem.receivedQty) || 0) + Number(receivedItem.acceptedQty);
        poItem.remainingQty = Math.max(0, (Number(poItem.quantity) || 0) - Number(poItem.receivedQty));
      }
      totalReceived += Number(poItem.receivedQty || 0);
    });

    po.receivedPercentage = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0;
    po.partiallyReceived = totalReceived > 0 && totalReceived < totalOrdered;

    if (totalReceived >= totalOrdered) {
      po.status = 'delivered';
      po.deliveryDate = receivedDate || new Date().toISOString().split('T')[0];
    } else if (totalReceived > 0) {
      po.status = 'partially_received';
    }

    await po.save();

    res.status(201).json({
      success: true,
      data: grn,
      poStatus: po.status,
      receivedPercentage: po.receivedPercentage,
      remainingQuantity: totalOrdered - totalReceived,
      message: `GRN ${grnNumber} created successfully & stock updated`
    });
  } catch (error) {
    console.error('❌ Create GRN error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getGRNs = async (req, res) => {
  try {
    const { page = 1, limit = 15, search, startDate, endDate, supplierId, status } = req.query;
    const query = {};
    
    if (search) {
      query.$or = [
        { grnNumber: { $regex: search, $options: 'i' } },
        { poNumber: { $regex: search, $options: 'i' } },
        { supplierName: { $regex: search, $options: 'i' } }
      ];
    }
    if (supplierId) query.supplierId = supplierId;
    if (status) query.status = status;
    if (startDate || endDate) {
      query.receivedDate = {};
      if (startDate) query.receivedDate.$gte = startDate;
      if (endDate) query.receivedDate.$lte = endDate;
    }

    const grns = await GoodsReceipt.find(query)
      .populate('createdBy', 'name')
      .populate('supplierId', 'companyName gstNumber phone email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await GoodsReceipt.countDocuments(query);

    const stats = await GoodsReceipt.aggregate([
      { $match: query },
      { $group: {
        _id: null,
        totalGRNs: { $sum: 1 },
        totalItems: { $sum: { $size: '$items' } },
        totalValue: { $sum: '$grandTotal' },
        avgValue: { $avg: '$grandTotal' }
      }}
    ]);

    // Get PO details for each GRN
    const grnsWithDetails = await Promise.all(grns.map(async (grn) => {
      const po = await PurchaseOrder.findById(grn.purchaseOrder);
      const totalOrdered = po?.items?.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0) || 0;
      const totalReceived = po?.items?.reduce((sum, i) => sum + (Number(i.receivedQty) || 0), 0) || 0;
      
      return {
        ...grn.toObject(),
        poDetails: {
          totalOrdered,
          totalReceived,
          remainingQty: totalOrdered - totalReceived,
          receivedPercentage: totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0
        }
      };
    }));

    res.json({
      success: true,
      data: grnsWithDetails,
      stats: stats[0] || { totalGRNs: 0, totalItems: 0, totalValue: 0, avgValue: 0 },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ Get GRNs error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getGRN = async (req, res) => {
  try {
    const grn = await GoodsReceipt.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('purchaseOrder', 'poNumber status expectedDate items')
      .populate('supplierId', 'companyName gstNumber phone email address');
      
    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    const po = grn.purchaseOrder;
    const totalOrdered = po?.items?.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0) || 0;
    const totalReceived = po?.items?.reduce((sum, i) => sum + (Number(i.receivedQty) || 0), 0) || 0;

    res.json({
      success: true,
      data: {
        ...grn.toObject(),
        poSummary: {
          totalOrdered,
          totalReceived,
          remainingQty: totalOrdered - totalReceived,
          receivedPercentage: totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteGRN = async (req, res) => {
  try {
    const grn = await GoodsReceipt.findById(req.params.id);
    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    // Reverse stock updates
    for (const item of grn.items) {
      if (Number(item.acceptedQty) <= 0) continue;
      const product = await Product.findById(item.productId);
      if (!product) continue;

      if (product.productType === 'batch' && product.batches) {
        const batch = product.batches.find(b => b.batchNumber === item.batchNumber);
        if (batch) {
          batch.quantity = Math.max(0, (batch.quantity || 0) - Number(item.acceptedQty));
          if (batch.quantity === 0) {
            product.batches = product.batches.filter(b => b.batchNumber !== item.batchNumber);
          }
        }
      } else {
        product.stock = Math.max(0, (product.stock || 0) - Number(item.acceptedQty));
      }
      await product.save();
    }

    // Update PO
    const po = await PurchaseOrder.findById(grn.purchaseOrder);
    if (po) {
      const allGRNs = await GoodsReceipt.find({ purchaseOrder: po._id, _id: { $ne: grn._id } });
      let totalReceived = 0;
      
      po.items.forEach(poItem => {
        let receivedQty = 0;
        allGRNs.forEach(g => {
          const grnItem = g.items.find(i => i.productId?.toString() === poItem.productId?.toString());
          if (grnItem) receivedQty += Number(grnItem.acceptedQty || 0);
        });
        poItem.receivedQty = receivedQty;
        poItem.remainingQty = Math.max(0, (Number(poItem.quantity) || 0) - receivedQty);
        totalReceived += receivedQty;
      });

      const totalOrdered = po.items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
      po.receivedPercentage = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0;
      po.partiallyReceived = totalReceived > 0 && totalReceived < totalOrdered;

      if (totalReceived >= totalOrdered) {
        po.status = 'delivered';
      } else if (totalReceived > 0) {
        po.status = 'partially_received';
      } else {
        po.status = 'pending';
      }
      await po.save();
    }

    await grn.deleteOne();
    res.json({ success: true, message: 'GRN deleted successfully with stock reversal' });
  } catch (error) {
    console.error('❌ Delete GRN error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.generatePurchaseInvoice = async (req, res) => {
  try {
    const { grnId } = req.params;
    const { paymentTerms, dueDate, notes } = req.body;

    const grn = await GoodsReceipt.findById(grnId)
      .populate('supplierId', 'companyName gstNumber phone email address')
      .populate('purchaseOrder', 'poNumber');

    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    const existingInvoice = await PurchaseInvoice.findOne({ grnId });
    if (existingInvoice) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invoice already exists for this GRN',
        data: existingInvoice 
      });
    }

    const year = new Date().getFullYear();
    const lastInvoice = await PurchaseInvoice.findOne({
      invoiceNumber: new RegExp(`^PI-${year}/`)
    }).sort({ createdAt: -1 });

    let next = 1;
    if (lastInvoice?.invoiceNumber) {
      const parts = lastInvoice.invoiceNumber.split('/');
      if (parts[1]) next = parseInt(parts[1], 10) + 1;
    }

    const invoiceNumber = `PI-${year}/${String(next).padStart(3, '0')}`;

    const invoice = new PurchaseInvoice({
      invoiceNumber,
      grnId: grn._id,
      grnNumber: grn.grnNumber,
      purchaseOrder: grn.purchaseOrder,
      poNumber: grn.poNumber,
      supplierId: grn.supplierId,
      supplierName: grn.supplierName,
      supplierGST: grn.supplierGST,
      invoiceDate: new Date().toISOString().split('T')[0],
      dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      items: grn.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        hsn: item.hsn,
        unit: item.unit,
        orderedQty: item.orderedQty || 0,
        receivedQty: item.receivedQty || 0,
        quantity: item.acceptedQty || 0,
        unitPrice: item.unitPrice || 0,
        taxRate: item.taxRate || 0,
        subtotal: item.subtotal || 0,
        tax: item.tax || 0,
        totalWithTax: item.totalWithTax || 0,
        batchNumber: item.batchNumber || 'N/A'
      })),
      subtotal: grn.subtotal || 0,
      totalTax: grn.totalTax || 0,
      chargesSubtotal: grn.chargesSubtotal || 0,
      chargesTax: grn.chargesTax || 0,
      grandTotal: grn.grandTotal || 0,
      freight: grn.freight || { amount: 0, taxRate: 0, taxAmount: 0 },
      insurance: grn.insurance || { amount: 0, taxRate: 0, taxAmount: 0 },
      inventoryCharges: grn.inventoryCharges || { amount: 0, taxRate: 0, taxAmount: 0 },
      currency: grn.currency || 'INR',
      exchangeRate: grn.exchangeRate || 1,
      gstType: grn.gstType || 'igst',
      paymentTerms: paymentTerms || 'net_30',
      paidAmount: 0,
      remainingAmount: grn.grandTotal || 0,
      paymentStatus: 'pending',
      status: 'pending',
      notes: notes || grn.notes || '',
      createdBy: req.user?.id || req.user?._id
    });

    await invoice.save();

    // Update GRN with invoice reference
    grn.invoiceGenerated = true;
    grn.invoiceId = invoice._id;
    await grn.save();

    res.status(201).json({
      success: true,
      data: invoice,
      message: `Purchase Invoice ${invoiceNumber} generated successfully`
    });
  } catch (error) {
    console.error('❌ Generate invoice error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Add Payment to Invoice
exports.addPayment = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { date, amount, method, reference, notes } = req.body;

    const invoice = await PurchaseInvoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (invoice.paymentStatus === 'paid') {
      return res.status(400).json({ success: false, message: 'Invoice is already fully paid' });
    }

    const paymentAmount = Number(amount) || 0;
    if (paymentAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Payment amount must be greater than 0' });
    }

    if (paymentAmount > invoice.remainingAmount) {
      return res.status(400).json({ 
        success: false, 
        message: `Payment amount exceeds remaining balance of ${invoice.remainingAmount}` 
      });
    }

    invoice.payments.push({
      date: date || new Date().toISOString().split('T')[0],
      amount: paymentAmount,
      method: method || 'bank',
      reference: reference || '',
      notes: notes || '',
      receivedBy: req.user?.name || 'System'
    });

    invoice.paidAmount += paymentAmount;
    invoice.remainingAmount = invoice.grandTotal - invoice.paidAmount;

    if (invoice.remainingAmount <= 0) {
      invoice.paymentStatus = 'paid';
      invoice.status = 'paid';
    } else if (invoice.paidAmount > 0) {
      invoice.paymentStatus = 'partial';
    }

    await invoice.save();

    res.json({
      success: true,
      data: invoice,
      message: `Payment of ${paymentAmount} recorded successfully`
    });
  } catch (error) {
    console.error('❌ Add payment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Invoice Details
exports.getInvoice = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const invoice = await PurchaseInvoice.findById(invoiceId)
      .populate('supplierId', 'companyName gstNumber phone email address')
      .populate('createdBy', 'name');

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    res.json({ success: true, data: invoice });
  } catch (error) {
    console.error('❌ Get invoice error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get All Invoices
exports.getInvoices = async (req, res) => {
  try {
    const { page = 1, limit = 15, search, supplierId, paymentStatus } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { poNumber: { $regex: search, $options: 'i' } },
        { supplierName: { $regex: search, $options: 'i' } }
      ];
    }
    if (supplierId) query.supplierId = supplierId;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    const invoices = await PurchaseInvoice.find(query)
      .populate('supplierId', 'companyName')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await PurchaseInvoice.countDocuments(query);

    const stats = await PurchaseInvoice.aggregate([
      { $match: query },
      { $group: {
        _id: null,
        totalInvoices: { $sum: 1 },
        totalValue: { $sum: '$grandTotal' },
        totalPaid: { $sum: '$paidAmount' },
        totalRemaining: { $sum: '$remainingAmount' }
      }}
    ]);

    res.json({
      success: true,
      data: invoices,
      stats: stats[0] || { totalInvoices: 0, totalValue: 0, totalPaid: 0, totalRemaining: 0 },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ Get invoices error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getReceiptDashboard = async (req, res) => {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [totalGRNs, weeklyGRNs, bySupplier, recentGRNs, poStatus, invoiceStats] = await Promise.all([
      GoodsReceipt.countDocuments(),
      GoodsReceipt.countDocuments({ receivedDate: { $gte: weekAgo } }),
      GoodsReceipt.aggregate([
        { $group: { _id: '$supplierName', count: { $sum: 1 }, total: { $sum: '$grandTotal' } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      GoodsReceipt.find().sort({ createdAt: -1 }).limit(10).populate('supplierId', 'companyName'),
      PurchaseOrder.aggregate([
        { $group: { 
          _id: '$status', 
          count: { $sum: 1 },
          avgReceived: { $avg: '$receivedPercentage' }
        } }
      ]),
      PurchaseInvoice.aggregate([
        { $group: {
          _id: '$paymentStatus',
          count: { $sum: 1 },
          total: { $sum: '$grandTotal' }
        } }
      ])
    ]);

    const totalValue = await GoodsReceipt.aggregate([
      { $group: { _id: null, total: { $sum: '$grandTotal' } } }
    ]);

    res.json({
      success: true,
      data: {
        totalGRNs,
        weeklyGRNs,
        totalValue: totalValue[0]?.total || 0,
        topSuppliers: bySupplier,
        recentGRNs,
        poStatus,
        invoiceStats
      }
    });
  } catch (error) {
    console.error('❌ Dashboard error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};