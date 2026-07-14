const Invoice = require('../models/Invoice');

// @desc    Create invoice
// @route   POST /api/invoices
// @access  Private
exports.createInvoice = async (req, res) => {
  try {
    const invoiceData = req.body;
    invoiceData.createdBy = req.user.id;

    if (!invoiceData.customer || !invoiceData.customer.name) {
      return res.status(400).json({
        success: false,
        message: 'Customer information required'
      });
    }

    // Calculate totals
    let subtotal = 0;
    let tax = 0;

    if (invoiceData.items && invoiceData.items.length > 0) {
      invoiceData.items.forEach(item => {
        const itemAmount = item.quantity * item.rate;
        const itemTax = (itemAmount * (item.taxRate || 0)) / 100;
        subtotal += itemAmount;
        tax += itemTax;
        item.amount = itemAmount;
      });
    }

    invoiceData.subtotal = subtotal;
    invoiceData.tax = tax;
    invoiceData.total = subtotal + tax;

    const invoice = new Invoice(invoiceData);
    await invoice.save();

    res.status(201).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get all invoices
// @route   GET /api/invoices
// @access  Private
exports.getInvoices = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, type, search } = req.query;

    const query = {};
    if (status) query.status = status;
    if (type) query.type = type;
    if (search) {
      query.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { 'customer.name': { $regex: search, $options: 'i' } }
      ];
    }

    const invoices = await Invoice.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Invoice.countDocuments(query);

    res.json({
      success: true,
      data: invoices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get single invoice
// @route   GET /api/invoices/:id
// @access  Private
exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('createdBy', 'name email');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    res.json({
      success: true,
      data: invoice
    });
  } catch (error) {
    console.error('Get invoice error:', error);
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Update invoice status
// @route   PUT /api/invoices/:id/status
// @access  Private
exports.updateInvoiceStatus = async (req, res) => {
  try {
    const { status, paymentDate } = req.body;
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    invoice.status = status;
    if (status === 'paid' && paymentDate) {
      invoice.paymentDate = paymentDate;
    }

    await invoice.save();

    res.json({
      success: true,
      data: invoice
    });
  } catch (error) {
    console.error('Update invoice status error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Delete invoice
// @route   DELETE /api/invoices/:id
// @access  Private (Admin)
exports.deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    await invoice.deleteOne();

    res.json({
      success: true,
      message: 'Invoice deleted successfully'
    });
  } catch (error) {
    console.error('Delete invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};



exports.createInvoiceFromQuotation = async (req, res) => {
  try {
    const { quotationId } = req.body;
    
    // 1️⃣ Get Quotation with all data
    const quotation = await Quotation.findById(quotationId)
      .populate('leadId', 'name phone email address');
    
    if (!quotation) {
      return res.status(404).json({ 
        success: false, 
        message: 'Quotation not found' 
      });
    }
    
    // 2️⃣ Check if invoice already exists
    const existingInvoice = await Invoice.findOne({ quotationId });
    if (existingInvoice) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invoice already exists for this quotation' 
      });
    }
    
    // 3️⃣ Generate invoice number
    const year = new Date().getFullYear();
    const count = await Invoice.countDocuments();
    const invoiceNumber = `MPDMS${year}/${String(count + 1).padStart(3, '0')}`;
    
    // 4️⃣ ✅ AUTO-FILL INVOICE FROM QUOTATION
    const invoiceData = {
      invoiceNumber,
      type: quotation.type || 'domestic',
      
      // ✅ Customer Details - Auto-filled from Quotation
      customer: {
        name: quotation.customer?.name || quotation.leadId?.name || 'N/A',
        phone: quotation.customer?.phone || quotation.leadId?.phone || 'N/A',
        email: quotation.customer?.email || quotation.leadId?.email || '',
        address: quotation.customer?.address || quotation.leadId?.address || 'N/A',
        gst: quotation.customer?.gst || '',
        drugLicense: quotation.customer?.drugLicense || '',
        state: quotation.customer?.state || '',
        stateCode: quotation.customer?.stateCode || '',
        country: quotation.customer?.country || 'India'
      },
      
      // ✅ Items - Auto-filled from Quotation
      items: quotation.items.map(item => ({
        description: item.productName || item.description,
        quantity: item.quantity,
        rate: item.rate,
        taxRate: item.taxRate || 18,
        amount: item.total || (item.quantity * item.rate),
        batch: item.batch || '',
        hsCode: item.hsCode || '',
        mfgDate: item.mfgDate || '',
        expiryDate: item.expiryDate || '',
        unit: item.unit || 'Vial'
      })),
      
      // ✅ Totals - Auto-filled from Quotation
      subtotal: quotation.subtotal || 0,
      tax: quotation.tax || 0,
      total: quotation.total || 0,
      rounding: quotation.rounding || 0,
      totalInWords: quotation.totalInWords || '',
      
      // ✅ Dates
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      
      // ✅ Terms
      paymentTerms: quotation.paymentTerms || '100% Advance',
      placeOfSupply: quotation.placeOfSupply || 'Gujarat (24)',
      notes: quotation.notes || 'Thanks for your business.',
      terms: quotation.terms || '"NOT COVER UNDER NARCOTICS & SCOMET LIST."',
      
      // ✅ International fields (if any)
      portOfLoading: quotation.portOfLoading || '',
      portOfDischarge: quotation.portOfDischarge || '',
      destinationCountry: quotation.destinationCountry || '',
      grossWeight: quotation.grossWeight || '',
      netWeight: quotation.netWeight || '',
      volumetricWeight: quotation.volumetricWeight || '',
      countryOfOriginGoods: quotation.countryOfOriginGoods || 'India',
      totalBoxes: quotation.totalBoxes || '',
      
      // ✅ References
      quotationId: quotation._id,
      leadId: quotation.leadId?._id || quotation.leadId,
      
      // ✅ Status
      status: 'draft',
      createdBy: req.user.id
    };
    
    // 5️⃣ Create Invoice
    const invoice = new Invoice(invoiceData);
    await invoice.save();
    
    // 6️⃣ Update Lead Status
    if (quotation.leadId) {
      await Lead.findByIdAndUpdate(quotation.leadId, {
        status: 'converted',
        conversionDate: new Date()
      });
    }
    
    // 7️⃣ Update Quotation Status
    quotation.status = 'invoiced';
    await quotation.save();
    
    // 8️⃣ Populate createdBy
    await invoice.populate('createdBy', 'name');
    
    res.status(201).json({
      success: true,
      data: invoice,
      message: `✅ Invoice ${invoiceNumber} created successfully from quotation!`
    });
    
  } catch (error) {
    console.error('❌ Create invoice from quotation error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to create invoice' 
    });
  }
};