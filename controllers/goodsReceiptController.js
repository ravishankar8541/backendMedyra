// controllers/goodsReceiptController.js
const mongoose = require('mongoose');
const { GoodsReceipt, ConsolidatedInvoice } = require('../models/GoodsReceipt');
const PurchaseOrder = require('../models/PurchaseOrder');
const Product = require('../models/Product');

// ============================================
// GENERATE UNIQUE GRN NUMBER
// ============================================
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

// ============================================
// GENERATE UNIQUE PURCHASE INVOICE NUMBER (PI)
// ============================================
const generateConsolidatedInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const last = await ConsolidatedInvoice.findOne({
    invoiceNumber: new RegExp(`^(PI|CI)-${year}/`)
  }).sort({ createdAt: -1 });

  let next = 1;
  if (last?.invoiceNumber) {
    const parts = last.invoiceNumber.split('/');
    if (parts[1]) next = parseInt(parts[1], 10) + 1;
  }

  let invoiceNumber = `PI-${year}/${String(next).padStart(3, '0')}`;
  while (await ConsolidatedInvoice.exists({ invoiceNumber })) {
    next++;
    invoiceNumber = `PI-${year}/${String(next).padStart(3, '0')}`;
  }
  return invoiceNumber;
};

// ============================================
// CREATE OR UPDATE GRN (Consolidate into 1 GRN per PO)
// ============================================
exports.createGRN = async (req, res) => {
  try {
    const {
      purchaseOrderId,
      poNumber,
      supplierId,
      supplierName,
      supplierGST,
      supplierAddress,
      supplierContact,
      supplierEmail,
      receivedDate,
      receivedBy,
      warehouse,
      items,
      notes,
      currency,
      exchangeRate,
      freight,
      insurance,
      inventoryCharges,
      gstType,
      initialPayment
    } = req.body;

    if (!purchaseOrderId || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Purchase Order and at least one item are required'
      });
    }

    const po = await PurchaseOrder.findById(purchaseOrderId);
    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase Order not found'
      });
    }

    // Check if an existing GRN already exists for this PO
    let existingGRN = await GoodsReceipt.findOne({ purchaseOrder: purchaseOrderId });
    const isFirstReceipt = !existingGRN;

    let subtotal = 0;
    let totalTax = 0;
    const processedItems = [];

    // ===== PROCESS ITEMS & UPDATE STOCK =====
    for (const item of items) {
      const receivedQty = Number(item.receivedQty) || Number(item.acceptedQty) || 0;
      if (receivedQty <= 0) continue;

      let product = null;
      if (mongoose.isValidObjectId(item.productId)) {
        product = await Product.findById(item.productId);
      } else if (item.productId) {
        product = await Product.findOne({
          $or: [
            { productId: item.productId },
            { sku: item.productId },
            { productCode: item.productId },
            { code: item.productId }
          ]
        });
      }

      if (!product && item.productName) {
        product = await Product.findOne({
          $or: [
            { name: item.productName },
            { title: item.productName }
          ]
        });
      }

      const rate = Number(item.unitPrice) || 0;
      const taxRate = Number(item.taxRate) || 0;
      const itemSubtotal = receivedQty * rate;
      const itemTax = itemSubtotal * (taxRate / 100);

      subtotal += itemSubtotal;
      totalTax += itemTax;

      // Update stock & batches
      if (product) {
        if (product.productType === 'batch' || Array.isArray(product.batches)) {
          if (!product.batches) product.batches = [];

          const batchNumber = item.batchNumber || `BATCH-${Date.now().toString().slice(-6)}`;
          const existingBatch = product.batches.find((b) => b.batchNumber && b.batchNumber.toLowerCase() === batchNumber.trim().toLowerCase());

          if (existingBatch) {
            existingBatch.quantity = (existingBatch.quantity || 0) + receivedQty;
            if (item.mfgDate) existingBatch.mfgDate = item.mfgDate;
            if (item.expDate) existingBatch.expDate = item.expDate;
          } else {
            product.batches.push({
              batchNumber: batchNumber.trim(),
              mfgDate: item.mfgDate || '',
              expDate: item.expDate || '',
              quantity: receivedQty,
              addedDate: new Date().toISOString().split('T')[0],
              addedBy: req.user?.name || 'System',
              reason: `Received via GRN ${existingGRN?.grnNumber || po.poNumber}`
            });
          }
          product.stock = product.batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
        } else {
          product.stock = (product.stock || 0) + receivedQty;
        }

        if (product.stock > (product.minStock || 0)) {
          product.status = 'active';
        } else if (product.stock > 0) {
          product.status = 'low_stock';
        } else {
          product.status = 'critical';
        }

        await product.save();
      }

      const orderedQty = Number(item.orderedQty) || 0;
      const alreadyReceived = Number(item.alreadyReceived) || 0;
      const remainingQty = Math.max(0, orderedQty - alreadyReceived - receivedQty);

      const validProductId = product?._id
        ? product._id
        : (mongoose.isValidObjectId(item.productId) ? item.productId : null);

      processedItems.push({
        productId: validProductId,
        productName: item.productName || product?.name || '',
        sku: item.sku || product?.sku || '',
        hsn: item.hsn || product?.hsn || '',
        unit: item.unit || product?.unit || 'Strips',
        orderedQty,
        alreadyReceived,
        receivedQty,
        acceptedQty: receivedQty,
        rejectedQty: 0,
        remainingQty,
        batchNumber: item.batchNumber || 'N/A',
        mfgDate: item.mfgDate || '',
        expDate: item.expDate || '',
        unitPrice: rate,
        taxRate,
        subtotal: itemSubtotal,
        tax: itemTax,
        totalWithTax: itemSubtotal + itemTax,
        remarks: item.remarks || ''
      });
    }

    if (processedItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid items with received quantity found'
      });
    }

    // ===== PAYMENT DATA =====
    let payAmt = 0;
    let paymentEntry = null;
    if (initialPayment && Number(initialPayment.amount) > 0) {
      payAmt = Number(initialPayment.amount);
      paymentEntry = {
        date: initialPayment.date || new Date().toISOString().split('T')[0],
        amount: payAmt,
        method: initialPayment.method || 'bank',
        reference: initialPayment.reference || '',
        notes: initialPayment.notes || 'Payment on GRN',
        receivedBy: req.user?.name || 'System'
      };
    }

    let grn;
    let overpaymentCredit = 0;

    if (isFirstReceipt) {
      // ===== 1ST RECEIPT: CREATE NEW GRN =====
      const grnNumber = await generateGRNNumber();

      const freightData = {
        amount: Number(freight?.amount) || 0,
        taxRate: Number(freight?.taxRate) || 0,
        taxAmount: ((Number(freight?.amount) || 0) * (Number(freight?.taxRate) || 0)) / 100
      };
      const insuranceData = {
        amount: Number(insurance?.amount) || 0,
        taxRate: Number(insurance?.taxRate) || 0,
        taxAmount: ((Number(insurance?.amount) || 0) * (Number(insurance?.taxRate) || 0)) / 100
      };
      const inventoryData = {
        amount: Number(inventoryCharges?.amount) || 0,
        taxRate: Number(inventoryCharges?.taxRate) || 0,
        taxAmount: ((Number(inventoryCharges?.amount) || 0) * (Number(inventoryCharges?.taxRate) || 0)) / 100
      };

      const chargesSubtotal = freightData.amount + insuranceData.amount + inventoryData.amount;
      const chargesTax = freightData.taxAmount + insuranceData.taxAmount + inventoryData.taxAmount;
      const exactTotal = subtotal + totalTax + chargesSubtotal + chargesTax;
      const grandTotal = Math.round(exactTotal);
      const roundOff = Number((grandTotal - exactTotal).toFixed(2));

      grn = new GoodsReceipt({
        grnNumber,
        purchaseOrder: purchaseOrderId,
        poNumber: poNumber || po.poNumber,
        supplierId: supplierId || po.supplierId,
        supplierName: supplierName || po.supplierName || '',
        supplierGST: supplierGST || po.supplierGST || '',
        supplierAddress: supplierAddress || po.supplierAddress || '',
        supplierContact: supplierContact || po.supplierContact || '',
        supplierEmail: supplierEmail || po.supplierEmail || '',
        receivedDate: receivedDate || new Date().toISOString().split('T')[0],
        receivedBy: receivedBy || req.user?.name || '',
        warehouse: warehouse || 'Main Warehouse',
        items: processedItems,
        notes: notes || '',
        status: 'completed',
        createdBy: req.user?.id || req.user?._id,
        currency: currency || po.currency || 'INR',
        exchangeRate: exchangeRate || po.exchangeRate || 1,
        subtotal,
        totalTax,
        chargesSubtotal,
        chargesTax,
        roundOff,
        grandTotal,
        freight: freightData,
        insurance: insuranceData,
        inventoryCharges: inventoryData,
        gstType: gstType || po.gstType || 'igst',
        chargesApplied: true,
        paidAmount: payAmt,
        payments: paymentEntry ? [paymentEntry] : [],
        invoiceGenerated: false
      });

      if (payAmt > grandTotal) {
        overpaymentCredit = payAmt - grandTotal;
      }
    } else {
      // ===== SUBSEQUENT RECEIPT: UPDATE THE SAME EXISTING GRN =====
      grn = existingGRN;

      const mergedItems = [...(grn.items || [])];
      processedItems.forEach(newItem => {
        const existingIdx = mergedItems.findIndex(
          item =>
            (item.productId && newItem.productId && item.productId.toString() === newItem.productId.toString()) ||
            (item.productName && item.productName === newItem.productName)
        );

        if (existingIdx > -1) {
          const ex = mergedItems[existingIdx];
          ex.receivedQty = (ex.receivedQty || 0) + (newItem.receivedQty || 0);
          ex.acceptedQty = (ex.acceptedQty || 0) + (newItem.receivedQty || 0);
          ex.remainingQty = Math.max(0, (ex.orderedQty || 0) - (ex.receivedQty || 0));
          ex.subtotal = (ex.receivedQty || 0) * (ex.unitPrice || 0);
          ex.tax = (ex.subtotal || 0) * ((ex.taxRate || 0) / 100);
          ex.totalWithTax = (ex.subtotal || 0) + (ex.tax || 0);
          if (newItem.batchNumber && newItem.batchNumber !== 'N/A') ex.batchNumber = newItem.batchNumber;
          if (newItem.mfgDate) ex.mfgDate = newItem.mfgDate;
          if (newItem.expDate) ex.expDate = newItem.expDate;
        } else {
          mergedItems.push(newItem);
        }
      });

      let newSubtotal = 0;
      let newTotalTax = 0;
      mergedItems.forEach(item => {
        newSubtotal += (item.subtotal || 0);
        newTotalTax += (item.tax || 0);
      });

      grn.items = mergedItems;
      grn.subtotal = newSubtotal;
      grn.totalTax = newTotalTax;
      
      const exactTotal = newSubtotal + newTotalTax + (grn.chargesSubtotal || 0) + (grn.chargesTax || 0);
      grn.grandTotal = Math.round(exactTotal);
      grn.roundOff = Number((grn.grandTotal - exactTotal).toFixed(2));

      if (paymentEntry) {
        if (!Array.isArray(grn.payments)) grn.payments = [];
        grn.payments.push(paymentEntry);
        grn.paidAmount = (grn.paidAmount || 0) + payAmt;
      }

      if (grn.paidAmount > grn.grandTotal) {
        overpaymentCredit = grn.paidAmount - grn.grandTotal;
      }

      grn.receivedDate = receivedDate || grn.receivedDate;
      grn.notes = notes ? `${grn.notes ? grn.notes + ' | ' : ''}${notes}` : grn.notes;
    }

    await grn.save();

    // ===== UPDATE PO =====
    const totalOrdered = po.items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
    let totalReceived = 0;

    po.items.forEach((poItem) => {
      const receivedItem = processedItems.find(
        (i) =>
          (i.productId && poItem.productId && i.productId.toString() === poItem.productId.toString()) ||
          (i.productId && poItem.product && i.productId.toString() === poItem.product.toString()) ||
          (i.productName && (i.productName === poItem.productName || i.productName === poItem.name))
      );

      if (receivedItem) {
        poItem.receivedQty = (Number(poItem.receivedQty) || 0) + Number(receivedItem.receivedQty);
        poItem.remainingQty = Math.max(
          0,
          (Number(poItem.quantity) || 0) - Number(poItem.receivedQty)
        );
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

    if (overpaymentCredit > 0) {
      po.creditAmount = (Number(po.creditAmount) || 0) + overpaymentCredit;
    }

    await po.save();

    // ===== HANDLE PURCHASE INVOICE (PI) =====
    let existingInvoice = await ConsolidatedInvoice.findOne({
      purchaseOrder: purchaseOrderId,
      status: { $in: ['draft', 'generated'] }
    });

    if (!existingInvoice) {
      const invoiceNumber = await generateConsolidatedInvoiceNumber();
      existingInvoice = new ConsolidatedInvoice({
        invoiceNumber,
        grnIds: [grn._id],
        poNumber: poNumber || po.poNumber,
        purchaseOrder: purchaseOrderId,
        supplierId: supplierId || po.supplierId,
        supplierName: supplierName || po.supplierName || '',
        supplierGST: supplierGST || po.supplierGST || '',
        supplierAddress: supplierAddress || po.supplierAddress || '',
        supplierContact: supplierContact || po.supplierContact || '',
        supplierEmail: supplierEmail || po.supplierEmail || '',
        invoiceDate: receivedDate || new Date().toISOString().split('T')[0],
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        items: [...grn.items],
        subtotal: grn.subtotal,
        totalTax: grn.totalTax,
        chargesSubtotal: grn.chargesSubtotal,
        chargesTax: grn.chargesTax,
        roundOff: grn.roundOff,
        grandTotal: grn.grandTotal,
        freight: grn.freight,
        insurance: grn.insurance,
        inventoryCharges: grn.inventoryCharges,
        gstType: gstType || po.gstType || 'igst',
        currency: currency || po.currency || 'INR',
        exchangeRate: exchangeRate || po.exchangeRate || 1,
        paidAmount: grn.paidAmount || 0,
        payments: grn.payments || [],
        remainingAmount: Math.max(0, grn.grandTotal - (grn.paidAmount || 0)),
        paymentStatus: (grn.paidAmount || 0) >= grn.grandTotal ? 'paid' : (grn.paidAmount > 0 ? 'partial' : 'pending'),
        status: 'generated',
        notes: notes || '',
        createdBy: req.user?.id || req.user?._id,
        receiptCount: 1
      });
      await existingInvoice.save();
    } else {
      existingInvoice.items = grn.items;
      existingInvoice.subtotal = grn.subtotal;
      existingInvoice.totalTax = grn.totalTax;
      existingInvoice.roundOff = grn.roundOff;
      existingInvoice.grandTotal = grn.grandTotal;
      existingInvoice.paidAmount = grn.paidAmount || 0;
      existingInvoice.remainingAmount = Math.max(0, grn.grandTotal - (grn.paidAmount || 0));
      existingInvoice.paymentStatus = (grn.paidAmount || 0) >= grn.grandTotal ? 'paid' : (grn.paidAmount > 0 ? 'partial' : 'pending');
      existingInvoice.payments = grn.payments || [];
      existingInvoice.receiptCount = (existingInvoice.receiptCount || 0) + 1;
      await existingInvoice.save();
    }

    grn.consolidatedInvoiceId = existingInvoice._id;
    grn.invoiceGenerated = true;
    grn.invoiceId = existingInvoice._id;
    await grn.save();

    res.status(201).json({
      success: true,
      data: grn,
      consolidatedInvoice: existingInvoice,
      poStatus: po.status,
      receivedPercentage: po.receivedPercentage,
      remainingQuantity: totalOrdered - totalReceived,
      overpaymentCredit: overpaymentCredit > 0 ? overpaymentCredit : 0,
      isFirstReceipt,
      message: isFirstReceipt
        ? `GRN ${grn.grnNumber} created with charges.`
        : `Updated GRN ${grn.grnNumber} with newly received items.`
    });
  } catch (error) {
    console.error('❌ Create GRN error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ADD PAYMENT (FIXED: ACCEPTS BOTH GRN ID & INVOICE ID)
// ============================================
exports.addPayment = async (req, res) => {
  try {
    const id = req.params.id || req.params.grnId || req.params.invoiceId;
    const { date, paymentDate, amount, method, paymentMethod, reference, transactionId, notes } = req.body;

    const paymentAmount = Number(amount) || 0;
    if (paymentAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be greater than 0'
      });
    }

    let grn = null;
    let invoice = null;

    if (mongoose.isValidObjectId(id)) {
      grn = await GoodsReceipt.findById(id);
      if (grn) {
        if (grn.consolidatedInvoiceId) {
          invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
        }
        if (!invoice) {
          invoice = await ConsolidatedInvoice.findOne({ purchaseOrder: grn.purchaseOrder });
        }
      } else {
        invoice = await ConsolidatedInvoice.findById(id);
        if (invoice) {
          grn = await GoodsReceipt.findOne({ consolidatedInvoiceId: invoice._id });
        }
      }
    }

    if (!grn && !invoice) {
      return res.status(404).json({
        success: false,
        message: 'Goods Receipt or Invoice record not found'
      });
    }

    const paymentEntry = {
      date: date || paymentDate || new Date().toISOString().split('T')[0],
      amount: paymentAmount,
      method: method || paymentMethod || 'bank',
      reference: reference || transactionId || '',
      notes: notes || '',
      receivedBy: req.user?.name || 'System'
    };

    // Update GRN Record
    if (grn) {
      if (!Array.isArray(grn.payments)) grn.payments = [];
      grn.payments.push(paymentEntry);
      grn.paidAmount = (Number(grn.paidAmount) || 0) + paymentAmount;
      await grn.save();
    }

    // Update Consolidated Invoice Record
    if (invoice) {
      if (!Array.isArray(invoice.payments)) invoice.payments = [];
      invoice.payments.push(paymentEntry);
      invoice.paidAmount = (Number(invoice.paidAmount) || 0) + paymentAmount;
      invoice.remainingAmount = Math.max(0, (invoice.grandTotal || 0) - invoice.paidAmount);
      invoice.paymentStatus = invoice.remainingAmount <= 0 ? 'paid' : (invoice.paidAmount > 0 ? 'partial' : 'pending');
      invoice.status = invoice.paymentStatus;
      await invoice.save();
    }

    return res.json({
      success: true,
      data: grn || invoice,
      message: `✅ Payment of ${paymentAmount} recorded successfully!`
    });
  } catch (error) {
    console.error('❌ Add payment error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Aliased to ensure both /payment and /invoices/:id/payment work
exports.addConsolidatedPayment = exports.addPayment;

// ============================================
// GET ALL CONSOLIDATED INVOICES
// ============================================
exports.getConsolidatedInvoices = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 15,
      search,
      supplierId,
      paymentStatus,
      startDate,
      endDate
    } = req.query;

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

    if (startDate || endDate) {
      query.invoiceDate = {};
      if (startDate) query.invoiceDate.$gte = startDate;
      if (endDate) query.invoiceDate.$lte = endDate;
    }

    const invoices = await ConsolidatedInvoice.find(query)
      .populate('createdBy', 'name')
      .populate('supplierId', 'companyName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await ConsolidatedInvoice.countDocuments(query);

    const stats = await ConsolidatedInvoice.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalInvoices: { $sum: 1 },
          totalValue: { $sum: '$grandTotal' },
          totalPaid: { $sum: '$paidAmount' },
          totalRemaining: { $sum: '$remainingAmount' },
          totalReceipts: { $sum: '$receiptCount' }
        }
      }
    ]);

    res.json({
      success: true,
      data: invoices,
      stats: stats[0] || {
        totalInvoices: 0,
        totalValue: 0,
        totalPaid: 0,
        totalRemaining: 0,
        totalReceipts: 0
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ Get consolidated invoices error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET SINGLE CONSOLIDATED INVOICE
// ============================================
exports.getConsolidatedInvoice = async (req, res) => {
  try {
    const invoice = await ConsolidatedInvoice.findById(req.params.invoiceId)
      .populate('createdBy', 'name email')
      .populate('supplierId', 'companyName gstNumber phone email address')
      .populate('purchaseOrder', 'poNumber status expectedDate creditAmount');

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const grns = await GoodsReceipt.find({
      consolidatedInvoiceId: invoice._id
    }).select('grnNumber receivedDate items subtotal grandTotal status');

    res.json({
      success: true,
      data: {
        ...invoice.toObject(),
        grns: grns
      }
    });
  } catch (error) {
    console.error('❌ Get consolidated invoice error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET ALL GRNs
// ============================================
exports.getGRNs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 15,
      search,
      startDate,
      endDate,
      supplierId,
      status
    } = req.query;

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
      .populate('consolidatedInvoiceId', 'invoiceNumber paymentStatus')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await GoodsReceipt.countDocuments(query);

    const stats = await GoodsReceipt.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalGRNs: { $sum: 1 },
          totalItems: { $sum: { $size: '$items' } },
          totalValue: { $sum: '$grandTotal' },
          avgValue: { $avg: '$grandTotal' }
        }
      }
    ]);

    res.json({
      success: true,
      data: grns,
      stats: stats[0] || {
        totalGRNs: 0,
        totalItems: 0,
        totalValue: 0,
        avgValue: 0
      },
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

// ============================================
// GET SINGLE GRN
// ============================================
exports.getGRN = async (req, res) => {
  try {
    const grn = await GoodsReceipt.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('purchaseOrder', 'poNumber status expectedDate items total creditAmount')
      .populate('supplierId', 'companyName gstNumber phone email address')
      .populate('consolidatedInvoiceId', 'invoiceNumber paymentStatus payments grandTotal paidAmount remainingAmount');

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
        paidAmount: grn.paidAmount || 0,
        payments: grn.payments || [],
        poSummary: {
          totalOrdered,
          totalReceived,
          remainingQty: totalOrdered - totalReceived,
          receivedPercentage: totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0,
          poGrandTotal: po?.total || 0,
          creditAmount: po?.creditAmount || 0
        }
      }
    });
  } catch (error) {
    console.error('❌ Get GRN error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// DELETE GRN
// ============================================
exports.deleteGRN = async (req, res) => {
  try {
    const grn = await GoodsReceipt.findById(req.params.id);
    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    // Reverse stock
    for (const item of grn.items) {
      const receivedQty = Number(item.receivedQty) || Number(item.acceptedQty) || 0;
      if (receivedQty <= 0) continue;

      let product = null;
      if (mongoose.isValidObjectId(item.productId)) {
        product = await Product.findById(item.productId);
      } else if (item.productId) {
        product = await Product.findOne({
          $or: [
            { productId: item.productId },
            { sku: item.productId },
            { productCode: item.productId },
            { code: item.productId }
          ]
        });
      }

      if (!product && item.productName) {
        product = await Product.findOne({
          $or: [
            { name: item.productName },
            { title: item.productName }
          ]
        });
      }

      if (product) {
        if (product.productType === 'batch' && product.batches) {
          const batch = product.batches.find((b) => b.batchNumber === item.batchNumber);
          if (batch) {
            batch.quantity = Math.max(0, (batch.quantity || 0) - receivedQty);
            if (batch.quantity === 0) {
              product.batches = product.batches.filter((b) => b.batchNumber !== item.batchNumber);
            }
          }
          product.stock = product.batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
        } else {
          product.stock = Math.max(0, (product.stock || 0) - receivedQty);
        }

        await product.save();
      }
    }

    // Update PO
    const po = await PurchaseOrder.findById(grn.purchaseOrder);
    if (po) {
      po.items.forEach((poItem) => {
        poItem.receivedQty = 0;
        poItem.remainingQty = Number(poItem.quantity) || 0;
      });
      po.receivedPercentage = 0;
      po.partiallyReceived = false;
      po.status = 'pending';
      await po.save();
    }

    await grn.deleteOne();

    res.json({
      success: true,
      message: 'GRN deleted successfully with stock reversal'
    });
  } catch (error) {
    console.error('❌ Delete GRN error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// DASHBOARD STATS
// ============================================
exports.getReceiptDashboard = async (req, res) => {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [
      totalGRNs,
      weeklyGRNs,
      bySupplier,
      recentGRNs,
      poStatus,
      invoiceStats,
      consolidatedInvoices
    ] = await Promise.all([
      GoodsReceipt.countDocuments(),
      GoodsReceipt.countDocuments({ receivedDate: { $gte: weekAgo } }),
      GoodsReceipt.aggregate([
        {
          $group: {
            _id: '$supplierName',
            count: { $sum: 1 },
            total: { $sum: '$grandTotal' }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      GoodsReceipt.find().sort({ createdAt: -1 }).limit(10).populate('supplierId', 'companyName'),
      PurchaseOrder.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            avgReceived: { $avg: '$receivedPercentage' }
          }
        }
      ]),
      ConsolidatedInvoice.aggregate([
        {
          $group: {
            _id: '$paymentStatus',
            count: { $sum: 1 },
            total: { $sum: '$grandTotal' }
          }
        }
      ]),
      ConsolidatedInvoice.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            totalValue: { $sum: '$grandTotal' },
            avgReceipts: { $avg: '$receiptCount' }
          }
        }
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
        invoiceStats,
        consolidatedInvoices: consolidatedInvoices[0] || { total: 0, totalValue: 0, avgReceipts: 0 }
      }
    });
  } catch (error) {
    console.error('❌ Dashboard error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// LEGACY COMPATIBILITY
// ============================================
exports.generatePurchaseInvoice = async (req, res) => {
  res.status(400).json({
    success: false,
    message: 'Use consolidated invoice system instead'
  });
};

exports.getInvoice = async (req, res) => {
  return exports.getConsolidatedInvoice(req, res);
};

exports.getInvoices = async (req, res) => {
  return exports.getConsolidatedInvoices(req, res);
};