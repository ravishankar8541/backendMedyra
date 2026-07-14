// controllers/quotationController.js - COMPLETE WORKING VERSION

const Quotation = require('../models/Quotation');
const Lead = require('../models/Lead');
const Product = require('../models/Product');

// controllers/quotationController.js - FIXED createQuotation function

exports.createQuotation = async (req, res) => {
  try {
    console.log('📝 Creating quotation...');

    const {
      leadId,
      type = 'domestic',
      items = [],
      validUntil,
      paymentTerms = '100% Advance',
      deliveryTerms = '3-5 working days after payment',
      placeOfSupply = 'Gujarat (24)',
      portOfLoading = '',
      portOfDischarge = '',
      shippingMark = '',
      vesselNo = '',
      billOfLading = '',
      letterOfCredit = '',
      destinationCountry = '',
      grossWeight = '',
      netWeight = '',
      volumetricWeight = '',
      countryOfOriginGoods = 'India',
      totalBoxes = '',
      notes = '',
      terms = 'This is a quotation. Prices are valid for 7 days.',
      totalInWords = ''
    } = req.body;

    // ✅ Validate lead
    if (!leadId) {
      return res.status(400).json({ success: false, message: 'Lead ID is required' });
    }

    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    // ✅ Validate items
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item is required' });
    }

    // ✅ Calculate totals
    let subtotal = 0;
    const quotationItems = [];

    for (const item of items) {
      const quantity = parseInt(item.quantity) || 1;
      const rate = parseFloat(item.rate) || 0;
      const taxRate = parseFloat(item.taxRate) || 18;
      const total = quantity * rate;
      subtotal += total;

      let productName = item.productName || 'Product';
      let hsCode = item.hsCode || '';
      let countryOfOrigin = item.countryOfOrigin || 'India';
      
      if (item.productId) {
        try {
          const product = await Product.findById(item.productId);
          if (product) {
            productName = product.name;
            hsCode = product.hsnCode || '';
            countryOfOrigin = product.countryOfOrigin || 'India';
          }
        } catch (err) {
          console.warn('Product not found:', item.productId);
        }
      }

      quotationItems.push({
        productId: item.productId || null,
        productName: productName,
        description: item.description || '',
        quantity: quantity,
        unit: item.unit || 'Pcs',
        rate: rate,
        taxRate: taxRate,
        total: total,
        batch: item.batch || '',
        hsCode: hsCode,
        mfgDate: item.mfgDate || '',
        expiryDate: item.expiryDate || '',
        countryOfOrigin: countryOfOrigin
      });
    }

    // ✅ Calculate tax and total
    const taxRate = items[0]?.taxRate || 18;
    const tax = (subtotal * taxRate) / 100;
    const total = subtotal + tax;
    const rounding = Math.round(total * 100) / 100 - total;
    const finalTotal = Math.round((total + rounding) * 100) / 100;

    // ✅ Generate quotation number
    const year = new Date().getFullYear();
    const prefix = type === 'domestic' ? 'QT' : 'QTI';
    const count = await Quotation.countDocuments() + 1;
    const quotationNumber = `${prefix}-${year}-${String(count).padStart(4, '0')}`;

    // ✅ Create quotation - FIXED: Provide default values for required fields
    const quotationData = {
      quotationNumber,
      leadId: lead._id,
      type: type,
      customer: {
        name: lead.name || 'Unknown Customer',
        phone: lead.phone || 'N/A',
        email: lead.email || '',
        address: lead.address || 'N/A',  // ✅ FIXED: Provide default
        gst: lead.gst || '',
        drugLicense: lead.drugLicense || '',
        state: lead.state || '',
        stateCode: lead.stateCode || '',
        country: lead.country || 'India',
        taxId: lead.taxId || '',
        passportNo: lead.passportNo || ''
      },
      items: quotationItems,
      subtotal: subtotal,
      tax: tax,
      total: finalTotal,
      rounding: rounding,
      totalInWords: totalInWords || `${type === 'domestic' ? 'Indian Rupee' : 'United States Dollar'} ${Math.round(finalTotal)} Only`,
      validUntil: validUntil ? new Date(validUntil) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      paymentTerms: paymentTerms || '100% Advance',
      deliveryTerms: deliveryTerms || '3-5 working days after payment',
      placeOfSupply: placeOfSupply || 'Gujarat (24)',
      notes: notes || '',
      terms: terms || 'This is a quotation. Prices are valid for 7 days.',
      createdBy: req.user.id,
      status: 'draft',
      portOfLoading: portOfLoading || '',
      portOfDischarge: portOfDischarge || '',
      shippingMark: shippingMark || '',
      vesselNo: vesselNo || '',
      billOfLading: billOfLading || '',
      letterOfCredit: letterOfCredit || '',
      destinationCountry: destinationCountry || '',
      grossWeight: grossWeight || '',
      netWeight: netWeight || '',
      volumetricWeight: volumetricWeight || '',
      countryOfOriginGoods: countryOfOriginGoods || 'India',
      totalBoxes: totalBoxes || ''
    };

    const quotation = new Quotation(quotationData);
    await quotation.save();

    // ✅ Update lead status
    lead.status = 'quotation_sent';
    lead.quotation = {
      sentDate: new Date(),
      amount: finalTotal,
      document: `Quotation ${quotationNumber}`,
      followUpDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      notes: `Quotation ${quotationNumber} created`
    };
    await lead.save();

    await quotation.populate('createdBy', 'name');

    res.status(201).json({
      success: true,
      data: quotation,
      message: `Quotation ${quotationNumber} created successfully`
    });
  } catch (error) {
    console.error('❌ Create quotation error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to create quotation'
    });
  }
};


exports.getQuotations = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, type, leadId, search } = req.query;

    const query = {};
    if (status && status !== 'all') query.status = status;
    if (type && type !== 'all') query.type = type;
    if (leadId) query.leadId = leadId;
    
    // Telecaller sees only their quotations
    if (req.user.role === 'telecaller') {
      query.createdBy = req.user.id;
    }

    if (search) {
      query.$or = [
        { 'customer.name': { $regex: search, $options: 'i' } },
        { quotationNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const quotations = await Quotation.find(query)
      .populate('leadId', 'name phone email status')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Quotation.countDocuments(query);

    // Stats
    const stats = await Quotation.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          draft: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
          sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          accepted: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          totalValue: { $sum: '$total' },
          avgValue: { $avg: '$total' }
        }
      }
    ]);

    res.json({
      success: true,
      data: quotations,
      stats: stats[0] || {
        total: 0,
        draft: 0,
        sent: 0,
        accepted: 0,
        rejected: 0,
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
    console.error('Get quotations error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET SINGLE QUOTATION
// ============================================
exports.getQuotation = async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id)
      .populate('leadId', 'name phone email status')
      .populate('createdBy', 'name');

    if (!quotation) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }

    res.json({
      success: true,
      data: quotation
    });
  } catch (error) {
    console.error('Get quotation error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// UPDATE QUOTATION STATUS
// ============================================
exports.updateQuotationStatus = async (req, res) => {
  try {
    const { status, sentVia = 'manual', rejectionReason, notes } = req.body;
    const quotation = await Quotation.findById(req.params.id);

    if (!quotation) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }

    // Authorization
    if (req.user.role === 'telecaller' &&
        quotation.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    quotation.status = status;
    
    switch(status) {
      case 'sent':
        quotation.sentDate = new Date();
        quotation.sentVia = sentVia;
        // Update lead status
        await Lead.findByIdAndUpdate(quotation.leadId, {
          status: 'quotation_sent',
          'quotation.sentDate': new Date(),
          'quotation.amount': quotation.total,
          'quotation.document': `Quotation ${quotation.quotationNumber}`
        });
        break;
        
      case 'accepted':
        quotation.acceptedDate = new Date();
        // Update lead status to order_confirmed
        await Lead.findByIdAndUpdate(quotation.leadId, {
          status: 'order_confirmed',
          orderConfirmedAt: new Date()
        });
        break;
        
      case 'rejected':
        quotation.rejectedDate = new Date();
        quotation.rejectionReason = rejectionReason || notes || 'No reason provided';
        break;
    }

    if (notes) quotation.notes = notes;
    await quotation.save();

    res.json({
      success: true,
      data: quotation,
      message: `Quotation status updated to ${status}`
    });
  } catch (error) {
    console.error('Update quotation status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// DELETE QUOTATION
// ============================================
exports.deleteQuotation = async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id);
    if (!quotation) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }

    // Only draft can be deleted
    if (quotation.status !== 'draft') {
      return res.status(400).json({ 
        success: false, 
        message: 'Only draft quotations can be deleted' 
      });
    }

    if (req.user.role === 'telecaller' &&
        quotation.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await quotation.deleteOne();

    res.json({
      success: true,
      message: 'Quotation deleted successfully'
    });
  } catch (error) {
    console.error('Delete quotation error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};