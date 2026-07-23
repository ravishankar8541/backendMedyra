// controllers/leadController.js - COMPLETE FIXED VERSION

const Lead = require('../models/Lead');
const Revenue = require('../models/Revenue');
const User = require('../models/User');
const Product = require('../models/Product');
const Invoice = require('../models/Invoice');

// ============================================
// ✅ INCENTIVE CALCULATION (Google Sheets Formula)
// ============================================
const calculateIncentive = (revenue, profitPercentage) => {
  if (profitPercentage >= 35) {
    return revenue * 0.02;
  } else if (profitPercentage >= 25 && profitPercentage < 35) {
    return revenue * 0.0185;
  } else if (profitPercentage >= 20 && profitPercentage < 25) {
    return revenue * 0.0165;
  } else if (profitPercentage >= 15 && profitPercentage < 20) {
    return revenue * 0.0125;
  } else if (profitPercentage >= 10 && profitPercentage < 15) {
    return revenue * 0.004;
  } else {
    return 0;
  }
};

// ✅ Calculate item totals with incentive
const calculateItemTotals = (item) => {
  const qty = item.quantity || 1;
  const sellingPrice = item.sellingPrice || item.rate || 0;
  const costPrice = item.costPrice || 0;

  const totalValue = sellingPrice * qty;
  const totalCost = costPrice * qty;
  const profitAmount = totalValue - totalCost;
  const profitPercentage = totalCost > 0 ? (profitAmount / totalCost) * 100 : 0;
  const incentive = calculateIncentive(totalValue, profitPercentage);

  return {
    ...item,
    totalValue,
    profitAmount,
    profitPercentage,
    incentive
  };
};

// ============================================
// ✅ CREATE LEAD (Auto-assign Salesman)
// ============================================
exports.createLead = async (req, res) => {
  try {
    const leadData = req.body;

    leadData.createdBy = req.user.id;
    leadData.assignedTo = req.user.id;
    leadData.assignedToName = req.user.name;

    if (leadData.items && leadData.items.length > 0) {
      for (let item of leadData.items) {
        if (item.productId) {
          const product = await Product.findById(item.productId);
          if (product) {
            item.productName = product.name;
            item.productSku = product.sku;
            if (!item.costPrice) {
              item.costPrice = product.pricing?.costPrice || 0;
            }
          }
        }
        const calculatedItem = calculateItemTotals(item);
        Object.assign(item, calculatedItem);
      }

      let totalValue = 0, totalProfit = 0, totalIncentive = 0;
      leadData.items.forEach(item => {
        totalValue += item.totalValue || 0;
        totalProfit += item.profitAmount || 0;
        totalIncentive += item.incentive || 0;
      });

      leadData.totalValue = totalValue;
      leadData.totalProfit = totalProfit;
      leadData.totalIncentive = totalIncentive;
      leadData.value = totalValue;
      leadData.profit = totalProfit;
      leadData.incentive = totalIncentive;
    }

    const lead = new Lead(leadData);
    await lead.save();

    await lead.populate('assignedTo', 'name email');
    await lead.populate('createdBy', 'name');

    res.status(201).json({
      success: true,
      data: lead,
      message: '✅ Lead created successfully with salesman auto-assigned'
    });
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ UPDATE LEAD - NEW FUNCTION
// ============================================
exports.updateLead = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // ✅ Find the lead
    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found'
      });
    }

    // ✅ Allowed fields to update
    const allowedFields = [
      'name', 'phone', 'email', 'address', 'gst', 
      'drugLicense', 'state', 'stateCode', 'source', 'notes'
    ];

    // ✅ Only update allowed fields
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        lead[field] = updateData[field];
      }
    });

    // ✅ Save the lead
    await lead.save();

    // ✅ Populate for response
    await lead.populate('assignedTo', 'name email');
    await lead.populate('createdBy', 'name');

    res.json({
      success: true,
      data: lead,
      message: '✅ Lead updated successfully'
    });
  } catch (error) {
    console.error('Update lead error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// ============================================
// ✅ GENERATE PROFORMA INVOICE
// ============================================
exports.generateProforma = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const {
      type = 'domestic',
      taxType = 'cgst_sgst',
      poNumber = '',
      items = [],
      validUntil,
      paymentTerms = '100% Advance',
      deliveryTerms = '3-5 working days after payment',
      placeOfSupply = 'Gujarat (24)',
      notes = '',
      terms = 'This is a proforma invoice. Prices are valid for 7 days.',
      totalInWords = '',
      
      portOfLoading = '',
      portOfDischarge = '',
      destinationCountry = '',
      grossWeight = '',
      netWeight = '',
      volumetricWeight = '',
      countryOfOriginGoods = 'India',
      totalBoxes = '',
      shippingMark = '',
      vesselNo = ''
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: '⚠️ At least one product item is required for Proforma Invoice'
      });
    }

    let subtotal = 0;
    const proformaItems = [];

    for (const item of items) {
      const quantity = parseInt(item.quantity) || 1;
      const rate = parseFloat(item.rate) || 0;
      const taxRate = parseFloat(item.taxRate) || 18;
      const total = quantity * rate;
      subtotal += total;

      let productName = item.productName || 'Product';
      let hsCode = item.hsCode || '';
      let unit = item.unit || 'Vial';
      let batchNumber = item.batch || '';
      let mfgDate = item.mfgDate || '';
      let expiryDate = item.expiryDate || '';
      let countryOfOrigin = item.countryOfOrigin || 'India';
      let costPrice = item.costPrice || 0;
      let description = item.description || '';

      if (item.productId) {
        try {
          const product = await Product.findById(item.productId);
          if (product) {
            productName = product.name || productName;
            hsCode = product.hsnCode || hsCode;
            unit = product.unit || unit;
            countryOfOrigin = product.countryOfOrigin || countryOfOrigin;
            costPrice = product.pricing?.costPrice || costPrice;
            description = product.description || description;

            if (product.batches && product.batches.length > 0) {
              const firstBatch = product.batches[0];
              batchNumber = firstBatch.batchNumber || batchNumber;
              mfgDate = firstBatch.mfgDate || mfgDate;
              expiryDate = firstBatch.expDate || expiryDate;
            }
          }
        } catch (err) {
          console.warn('⚠️ Product not found:', item.productId);
        }
      }

      proformaItems.push({
        productId: item.productId || null,
        productName: productName,
        description: description || '',
        quantity: quantity,
        unit: unit,
        rate: rate,
        sellingPrice: rate,
        taxRate: taxRate,
        total: total,
        totalValue: total,
        batch: batchNumber,
        hsCode: hsCode,
        mfgDate: mfgDate,
        expiryDate: expiryDate,
        countryOfOrigin: countryOfOrigin,
        costPrice: costPrice,
        profitAmount: 0,
        profitPercentage: 0,
        incentive: 0
      });
    }

    let tax = 0;
    const firstTaxRate = proformaItems[0]?.taxRate || 18;
    tax = (subtotal * firstTaxRate) / 100;

    const total = subtotal + tax;
    const rounding = Math.round(total * 100) / 100 - total;
    const finalTotal = Math.round((total + rounding) * 100) / 100;

    const year = new Date().getFullYear();
    const prefix = type === 'domestic' ? 'PF' : 'PFI';
    
    const allProformas = lead.proformas || [];
    const count = allProformas.length + 1;
    const proformaNumber = `${prefix}-${year}/${String(count).padStart(4, '0')}`;

    const newProforma = {
      number: proformaNumber,
      sentDate: new Date(),
      amount: finalTotal,
      type: type,
      taxType: taxType,
      poNumber: poNumber || '',
      items: proformaItems,
      subtotal: subtotal,
      tax: tax,
      total: finalTotal,
      validUntil: validUntil ? new Date(validUntil) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      paymentTerms: paymentTerms || '100% Advance',
      deliveryTerms: deliveryTerms || '3-5 working days after payment',
      placeOfSupply: placeOfSupply || 'Gujarat (24)',
      notes: notes || '',
      terms: terms || 'This is a proforma invoice. Prices are valid for 7 days.',
      document: `Proforma ${proformaNumber}`,
      totalInWords: totalInWords || `${type === 'domestic' ? 'Indian Rupee' : 'United States Dollar'} ${Math.round(finalTotal)} Only`,
      
      portOfLoading,
      portOfDischarge,
      destinationCountry,
      grossWeight,
      netWeight,
      volumetricWeight,
      countryOfOriginGoods,
      totalBoxes,
      shippingMark,
      vesselNo
    };

    if (!lead.proformas) {
      lead.proformas = [];
    }
    lead.proformas.push(newProforma);
    lead.proforma = newProforma;

    lead.status = 'proforma_sent';
    lead.quotation = {
      sentDate: new Date(),
      amount: finalTotal,
      document: `Proforma ${proformaNumber}`,
      followUpDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      notes: `Proforma ${proformaNumber} sent`
    };

    await lead.save();
    await lead.populate('assignedTo', 'name email');

    const proformaData = {
      ...newProforma,
      lead: lead,
      customer: {
        name: lead.name,
        phone: lead.phone,
        email: lead.email || '',
        address: lead.address || 'N/A',
        gst: lead.gst || '',
        drugLicense: lead.drugLicense || '',
        state: lead.state || '',
        stateCode: lead.stateCode || ''
      }
    };

    res.status(200).json({
      success: true,
      data: {
        lead,
        proforma: proformaData
      },
      message: `✅ Proforma ${proformaNumber} generated successfully!`
    });
  } catch (error) {
    console.error('Generate proforma error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ CONVERT PROFORMA TO INVOICE (WITH INCENTIVE)
// ============================================
exports.convertProformaToInvoice = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).populate('assignedTo', 'name email role');
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const proforma = lead.proforma;
    if (!proforma || !proforma.number) {
      return res.status(400).json({
        success: false,
        message: '⚠️ No proforma found for this lead. Please generate proforma first.'
      });
    }

    const existingInvoice = await Invoice.findOne({ proformaNumber: proforma.number });
    if (existingInvoice) {
      return res.status(400).json({
        success: false,
        message: `⚠️ Invoice already exists for proforma ${proforma.number}`
      });
    }

    let totalIncentive = 0;
    let totalProfit = 0;
    let totalValue = 0;
    let totalCost = 0;
    let overallProfitPercentage = 0;

    const invoiceItems = proforma.items.map(item => {
      const quantity = item.quantity || 1;
      const sellingPrice = item.sellingPrice || item.rate || 0;
      const costPrice = item.costPrice || 0;
      
      const totalValueItem = sellingPrice * quantity;
      const totalCostItem = costPrice * quantity;
      const profitAmountItem = totalValueItem - totalCostItem;
      const profitPercentageItem = totalCostItem > 0 ? (profitAmountItem / totalCostItem) * 100 : 0;
      
      const incentive = calculateIncentive(totalValueItem, profitPercentageItem);

      totalIncentive += incentive;
      totalProfit += profitAmountItem;
      totalValue += totalValueItem;
      totalCost += totalCostItem;

      return {
        description: item.productName || item.description || 'Product',
        quantity: item.quantity,
        rate: item.rate || item.sellingPrice || 0,
        taxRate: item.taxRate || 18,
        amount: item.total || (item.quantity * (item.rate || item.sellingPrice || 0)),
        batch: item.batch || '',
        hsCode: item.hsCode || '',
        mfgDate: item.mfgDate || '',
        expiryDate: item.expiryDate || '',
        unit: item.unit || 'Vial',
        countryOfOrigin: item.countryOfOrigin || 'India',
        costPrice: costPrice,
        sellingPrice: sellingPrice,
        profitAmount: profitAmountItem,
        profitPercentage: profitPercentageItem,
        incentive: incentive
      };
    });

    overallProfitPercentage = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    lead._skipAutoCalculate = true;

    lead.totalIncentive = totalIncentive;
    lead.totalProfit = totalProfit;
    lead.totalValue = totalValue;
    lead.incentive = totalIncentive;
    lead.profit = totalProfit;
    lead.value = totalValue;

    if (lead.items && lead.items.length > 0) {
      lead.items.forEach((item, index) => {
        if (invoiceItems[index]) {
          item.incentive = invoiceItems[index].incentive || 0;
          item.profitAmount = invoiceItems[index].profitAmount || 0;
          item.profitPercentage = invoiceItems[index].profitPercentage || 0;
        }
      });
    }

    const year = new Date().getFullYear();
    const invoiceCount = await Invoice.countDocuments();
    const invoiceNumber = `MPDMS${year}/${String(invoiceCount + 1).padStart(3, '0')}`;

    const invoiceData = {
      invoiceNumber,
      type: proforma.type || 'domestic',
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      placeOfSupply: proforma.placeOfSupply || 'Gujarat (24)',
      paymentTerms: proforma.paymentTerms || '100% Advance',

      customer: {
        name: lead.name,
        phone: lead.phone,
        email: lead.email || '',
        address: lead.address || 'N/A',
        gst: lead.gst || '',
        drugLicense: lead.drugLicense || '',
        state: lead.state || '',
        stateCode: lead.stateCode || ''
      },

      items: invoiceItems,

      subtotal: proforma.subtotal || 0,
      tax: proforma.tax || 0,
      total: proforma.total || 0,
      rounding: 0,
      totalInWords: proforma.totalInWords || '',

      notes: proforma.notes || 'Thanks for your business.',
      terms: proforma.terms || '"NOT COVER UNDER NARCOTICS & SCOMET LIST."',

      portOfLoading: proforma.portOfLoading || '',
      portOfDischarge: proforma.portOfDischarge || '',
      destinationCountry: proforma.destinationCountry || '',
      grossWeight: proforma.grossWeight || '',
      netWeight: proforma.netWeight || '',
      volumetricWeight: proforma.volumetricWeight || '',
      countryOfOriginGoods: proforma.countryOfOriginGoods || 'India',
      totalBoxes: proforma.totalBoxes || '',

      proformaNumber: proforma.number,
      leadId: lead._id,

      status: 'draft',
      createdBy: req.user.id,
      
      incentive: totalIncentive,
      profit: totalProfit,
      profitPercentage: overallProfitPercentage,
      assignedTo: lead.assignedTo?._id || lead.assignedTo,
      assignedToName: lead.assignedToName || lead.assignedTo?.name || 'Unassigned',
      totalValue: totalValue,
      totalCost: totalCost
    };

    const invoice = new Invoice(invoiceData);
    await invoice.save();

    lead.status = 'converted';
    lead.conversionDate = new Date();
    
    lead.statusHistory.push({
      status: 'converted',
      date: new Date(),
      notes: `✅ Converted to invoice ${invoiceNumber} | Incentive: ₹${totalIncentive.toFixed(2)} | Profit: ${overallProfitPercentage.toFixed(2)}%`,
      updatedBy: req.user.id
    });

    await lead.save();
    await lead.populate('assignedTo', 'name email');

    if (lead.assignedTo) {
      try {
        const salesman = await User.findById(lead.assignedTo._id);
        if (salesman) {
          salesman.totalIncentiveEarned = (salesman.totalIncentiveEarned || 0) + totalIncentive;
          salesman.totalSalesValue = (salesman.totalSalesValue || 0) + totalValue;
          salesman.totalConversions = (salesman.totalConversions || 0) + 1;
          salesman.totalProfitGenerated = (salesman.totalProfitGenerated || 0) + totalProfit;
          
          if (!salesman.incentiveHistory) salesman.incentiveHistory = [];
          salesman.incentiveHistory.push({
            leadId: lead._id,
            leadName: lead.name,
            invoiceNumber: invoiceNumber,
            amount: totalIncentive,
            value: totalValue,
            profit: totalProfit,
            profitPercentage: overallProfitPercentage,
            date: new Date(),
            status: 'credited'
          });
          
          await salesman.save();
          console.log(`✅ Incentive ₹${totalIncentive.toFixed(2)} credited to ${salesman.name}`);
        }
      } catch (err) {
        console.error('Error updating salesman incentive:', err);
      }
    }

    await invoice.populate('createdBy', 'name');

    res.status(201).json({
      success: true,
      data: {
        invoice,
        lead: lead,
        incentive: {
          total: totalIncentive,
          profit: totalProfit,
          value: totalValue,
          profitPercentage: overallProfitPercentage,
          salesman: lead.assignedTo?.name || lead.assignedToName || 'Unassigned'
        }
      },
      message: `✅ Invoice ${invoiceNumber} created from proforma ${proforma.number} | Incentive: ₹${totalIncentive.toFixed(2)}`
    });

  } catch (error) {
    console.error('Convert proforma to invoice error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ GET ALL LEADS
// ============================================
exports.getLeads = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      source,
      assignedTo,
      search,
      sortBy = '-createdAt'
    } = req.query;

    const query = {};
    if (status && status !== 'all') query.status = status;
    if (source && source !== 'all') query.source = source;
    if (assignedTo) query.assignedTo = assignedTo;

    if (req.user.role === 'telecaller') {
      query.assignedTo = req.user.id;
    }

    if (search) {
      query.$text = { $search: search };
    }

    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email role')
      .populate('createdBy', 'name')
      .sort(sortBy)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Lead.countDocuments(query);

    let stats = null;
    if (['accountant', 'admin', 'manager'].includes(req.user.role)) {
      stats = await Lead.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            totalValue: { $sum: '$value' },
            totalIncentive: { $sum: '$incentive' },
            converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
            new: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } },
            contacted: { $sum: { $cond: [{ $eq: ['$status', 'contacted'] }, 1, 0] } },
            qualified: { $sum: { $cond: [{ $eq: ['$status', 'qualified'] }, 1, 0] } },
            proforma_sent: { $sum: { $cond: [{ $eq: ['$status', 'proforma_sent'] }, 1, 0] } }
          }
        }
      ]);
      stats = stats[0] || null;
    }

    res.json({
      success: true,
      data: leads,
      stats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ GET SINGLE LEAD
// ============================================
exports.getLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name');

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    res.json({
      success: true,
      data: lead
    });
  } catch (error) {
    console.error('Get lead error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ UPDATE LEAD STATUS
// ============================================
exports.updateLeadStatus = async (req, res) => {
  try {
    const { status, notes } = req.body;
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    if (req.user.role === 'telecaller' &&
        lead.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const validTransitions = {
      'new': ['contacted', 'lost'],
      'contacted': ['qualified', 'lost'],
      'qualified': ['proforma_sent', 'lost'],
      'proforma_sent': ['order_confirmed', 'lost'],
      'order_confirmed': ['payment_pending', 'lost'],
      'payment_pending': ['converted', 'lost'],
      'converted': [],
      'lost': []
    };

    if (!validTransitions[lead.status]?.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from '${lead.status}' to '${status}'`
      });
    }

    const oldStatus = lead.status;
    lead.status = status;
    if (notes) lead.notes = notes;

    switch(status) {
      case 'order_confirmed':
        lead.orderConfirmedAt = new Date();
        break;

      case 'payment_pending':
        if (req.body.paymentDetails) {
          lead.payment = {
            status: 'pending',
            amount: req.body.paymentDetails.amount || lead.value,
            method: req.body.paymentDetails.method || 'advance',
            dueDate: req.body.paymentDetails.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            notes: req.body.paymentDetails.notes || 'Awaiting payment'
          };
        }
        break;

      case 'converted':
        lead.conversionDate = new Date();
        if (lead.payment) {
          lead.payment.status = 'paid';
          lead.payment.date = new Date();
        }
        break;
    }

    lead.statusHistory.push({
      status: status,
      date: new Date(),
      notes: notes || `Status updated from ${oldStatus} to ${status}`,
      updatedBy: req.user.id
    });

    await lead.save();
    await lead.populate('assignedTo', 'name email');

    const statusMessages = {
      'new': 'Lead added successfully',
      'contacted': 'Lead marked as contacted',
      'qualified': 'Lead qualified successfully',
      'proforma_sent': '📄 Proforma invoice sent successfully',
      'order_confirmed': '✅ Order confirmed by customer',
      'payment_pending': '💰 Waiting for customer payment',
      'converted': '🎉 Lead converted successfully!',
      'lost': '❌ Lead marked as lost'
    };

    res.json({
      success: true,
      data: lead,
      message: statusMessages[status] || `Status updated to ${status}`
    });
  } catch (error) {
    console.error('Update lead status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ DELETE LEAD
// ============================================
exports.deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    if (req.user.role === 'telecaller' &&
        lead.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await lead.deleteOne();

    res.json({
      success: true,
      message: 'Lead deleted successfully'
    });
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ GET LEAD STATS
// ============================================
exports.getLeadStats = async (req, res) => {
  try {
    const query = req.user.role === 'telecaller'
      ? { assignedTo: req.user.id }
      : {};

    const stats = await Lead.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          new: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } },
          contacted: { $sum: { $cond: [{ $eq: ['$status', 'contacted'] }, 1, 0] } },
          qualified: { $sum: { $cond: [{ $eq: ['$status', 'qualified'] }, 1, 0] } },
          proforma_sent: { $sum: { $cond: [{ $eq: ['$status', 'proforma_sent'] }, 1, 0] } },
          order_confirmed: { $sum: { $cond: [{ $eq: ['$status', 'order_confirmed'] }, 1, 0] } },
          payment_pending: { $sum: { $cond: [{ $eq: ['$status', 'payment_pending'] }, 1, 0] } },
          converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
          totalValue: { $sum: { $ifNull: ['$totalValue', '$value'] } },
          totalIncentive: { $sum: { $ifNull: ['$totalIncentive', '$incentive'] } },
          avgValue: { $avg: { $ifNull: ['$totalValue', '$value'] } }
        }
      }
    ]);

    const result = stats[0] || {
      total: 0,
      new: 0,
      contacted: 0,
      qualified: 0,
      proforma_sent: 0,
      order_confirmed: 0,
      payment_pending: 0,
      converted: 0,
      lost: 0,
      totalValue: 0,
      totalIncentive: 0,
      avgValue: 0
    };

    result.conversionRate = result.total > 0
      ? ((result.converted / result.total) * 100).toFixed(1)
      : 0;

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get lead stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};