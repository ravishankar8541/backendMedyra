const Supplier = require('../models/Supplier');

// ============================================
// HELPER: Map frontend data to backend schema
// ============================================
const mapFrontendToBackend = (data) => {
  return {
    companyName: data.companyName,
    contactPerson: data.contactPerson,
    email: data.email,
    phone: data.phone,
    alternativePhone: data.alternativePhone || '',
    website: data.website || '',
    address: {
      street: data.address || '',
      city: data.city || '',
      state: data.state || '',
      country: data.country || 'Pakistan',
      postalCode: data.postalCode || ''
    },
    businessType: data.businessType || 'distributor',
    gstNumber: data.gstNumber || '',
    ntfnNumber: data.ntfnNumber || '',
    bankName: data.bankName || '',
    accountTitle: data.accountTitle || '',
    accountNumber: data.accountNumber || '',
    branchCode: data.branchCode || '',
    paymentTerms: data.paymentTerms || 'net_30',
    currency: data.currency || 'PKR',
    notes: data.notes || '',
    status: data.status || 'active',
    creditLimit: data.creditLimit || 0,
    taxRate: data.taxRate || 0,
    discountRate: data.discountRate || 0,
    deliveryTime: data.deliveryTime || '3-5 days',
    industry: data.industry || 'pharmaceutical'
  };
};

// ============================================
// CREATE SUPPLIER
// ============================================
exports.createSupplier = async (req, res) => {
  try {
    // ✅ Map frontend data to backend schema
    const mappedData = mapFrontendToBackend(req.body);
    mappedData.createdBy = req.user.id;

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

    // ✅ Return flat structure for frontend
    const flatData = {
      _id: supplier._id,
      companyName: supplier.companyName,
      contactPerson: supplier.contactPerson,
      email: supplier.email,
      phone: supplier.phone,
      alternativePhone: supplier.alternativePhone || '',
      website: supplier.website || '',
      address: supplier.address?.street || '',
      city: supplier.address?.city || '',
      state: supplier.address?.state || '',
      country: supplier.address?.country || 'Pakistan',
      postalCode: supplier.address?.postalCode || '',
      businessType: supplier.businessType || 'distributor',
      gstNumber: supplier.gstNumber || '',
      ntfnNumber: supplier.ntfnNumber || '',
      bankName: supplier.bankName || '',
      accountTitle: supplier.accountTitle || '',
      accountNumber: supplier.accountNumber || '',
      branchCode: supplier.branchCode || '',
      paymentTerms: supplier.paymentTerms || 'net_30',
      currency: supplier.currency || 'PKR',
      notes: supplier.notes || '',
      status: supplier.status || 'active',
      creditLimit: supplier.creditLimit || 0,
      taxRate: supplier.taxRate || 0,
      discountRate: supplier.discountRate || 0,
      deliveryTime: supplier.deliveryTime || '3-5 days',
      industry: supplier.industry || 'pharmaceutical',
      rating: supplier.rating || 0,
      totalOrders: supplier.totalOrders || 0,
      totalSpent: supplier.totalSpent || 0,
      createdAt: supplier.createdAt,
      updatedAt: supplier.updatedAt
    };

    res.json({ 
      success: true, 
      data: flatData 
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
    const supplierId = req.params.id;
    
    // ✅ Map frontend data to backend schema
    const mappedData = mapFrontendToBackend(req.body);
    
    // Remove fields that shouldn't be updated
    delete mappedData._id;
    delete mappedData.createdAt;
    delete mappedData.__v;
    delete mappedData.createdBy;

    console.log('📦 Updating supplier with mapped data:', mappedData);

    const supplier = await Supplier.findByIdAndUpdate(
      supplierId,
      mappedData,
      { 
        new: true, 
        runValidators: true,
        context: 'query'
      }
    );

    if (!supplier) {
      return res.status(404).json({ 
        success: false, 
        message: 'Supplier not found' 
      });
    }

    console.log('✅ Supplier updated:', supplier._id);

    // ✅ Return flat structure for frontend
    const flatData = {
      _id: supplier._id,
      companyName: supplier.companyName,
      contactPerson: supplier.contactPerson,
      email: supplier.email,
      phone: supplier.phone,
      alternativePhone: supplier.alternativePhone || '',
      website: supplier.website || '',
      address: supplier.address?.street || '',
      city: supplier.address?.city || '',
      state: supplier.address?.state || '',
      country: supplier.address?.country || 'Pakistan',
      postalCode: supplier.address?.postalCode || '',
      businessType: supplier.businessType || 'distributor',
      gstNumber: supplier.gstNumber || '',
      ntfnNumber: supplier.ntfnNumber || '',
      bankName: supplier.bankName || '',
      accountTitle: supplier.accountTitle || '',
      accountNumber: supplier.accountNumber || '',
      branchCode: supplier.branchCode || '',
      paymentTerms: supplier.paymentTerms || 'net_30',
      currency: supplier.currency || 'PKR',
      notes: supplier.notes || '',
      status: supplier.status || 'active',
      creditLimit: supplier.creditLimit || 0,
      taxRate: supplier.taxRate || 0,
      discountRate: supplier.discountRate || 0,
      deliveryTime: supplier.deliveryTime || '3-5 days',
      industry: supplier.industry || 'pharmaceutical',
      rating: supplier.rating || 0,
      totalOrders: supplier.totalOrders || 0,
      totalSpent: supplier.totalSpent || 0,
      createdAt: supplier.createdAt,
      updatedAt: supplier.updatedAt
    };

    res.json({ 
      success: true, 
      data: flatData,
      message: 'Supplier updated successfully!'
    });
  } catch (error) {
    console.error('❌ Update supplier error:', error);
    
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