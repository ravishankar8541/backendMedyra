const Supplier = require('../models/Supplier');

// ============================================
// CREATE SUPPLIER
// ============================================
exports.createSupplier = async (req, res) => {
  try {
    const supplierData = req.body;
    supplierData.createdBy = req.user.id;

    // ✅ Map frontend field names to backend schema
    const mappedData = {
      companyName: supplierData.companyName,
      contactPerson: supplierData.contactPerson,
      email: supplierData.email,
      phone: supplierData.phone,
      alternativePhone: supplierData.alternativePhone || '',
      website: supplierData.website || '',
      address: {
        street: supplierData.address || '',
        city: supplierData.city || '',
        state: supplierData.state || '',
        country: supplierData.country || 'Pakistan',
        postalCode: supplierData.postalCode || ''
      },
      businessType: supplierData.businessType || 'distributor',
      gstNumber: supplierData.gstNumber || '',
      ntfnNumber: supplierData.ntfnNumber || '',
      bankName: supplierData.bankName || '',
      accountTitle: supplierData.accountTitle || '',
      accountNumber: supplierData.accountNumber || '',
      branchCode: supplierData.branchCode || '',
      paymentTerms: supplierData.paymentTerms || 'net_30',
      currency: supplierData.currency || 'PKR',
      notes: supplierData.notes || '',
      status: supplierData.status || 'active',
      createdBy: req.user.id
    };

    console.log('📦 Creating supplier with mapped data:', mappedData);

    const supplier = new Supplier(mappedData);
    await supplier.save();

    console.log('✅ Supplier created:', supplier._id);

    res.status(201).json({
      success: true,
      data: supplier,
      message: 'Supplier created successfully!'
    });
  } catch (error) {
    console.error('❌ Create supplier error:', error);
    
    // Handle duplicate email error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Supplier with this email already exists'
      });
    }

    res.status(500).json({ 
      success: false, 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// ============================================
// GET ALL SUPPLIERS
// ============================================
exports.getSuppliers = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;

    const query = {};
    if (status && status !== 'all') query.status = status;
    
    if (search) {
      query.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { contactPerson: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { gstNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const suppliers = await Supplier.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Supplier.countDocuments(query);

    res.json({
      success: true,
      data: suppliers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ Get suppliers error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ============================================
// GET SINGLE SUPPLIER
// ============================================
exports.getSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id)
      .populate('createdBy', 'name email');

    if (!supplier) {
      return res.status(404).json({ 
        success: false, 
        message: 'Supplier not found' 
      });
    }

    res.json({ 
      success: true, 
      data: supplier 
    });
  } catch (error) {
    console.error('❌ Get supplier error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ============================================
// UPDATE SUPPLIER
// ============================================
exports.updateSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!supplier) {
      return res.status(404).json({ 
        success: false, 
        message: 'Supplier not found' 
      });
    }

    console.log('✅ Supplier updated:', supplier._id);

    res.json({ 
      success: true, 
      data: supplier,
      message: 'Supplier updated successfully!'
    });
  } catch (error) {
    console.error('❌ Update supplier error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ============================================
// DELETE SUPPLIER
// ============================================
exports.deleteSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      return res.status(404).json({ 
        success: false, 
        message: 'Supplier not found' 
      });
    }

    await supplier.deleteOne();
    
    console.log('✅ Supplier deleted:', req.params.id);

    res.json({ 
      success: true, 
      message: 'Supplier deleted successfully' 
    });
  } catch (error) {
    console.error('❌ Delete supplier error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};