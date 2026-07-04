const Supplier = require('../models/Supplier');
const Product = require('../models/Product');

// ============================================
// CREATE SUPPLIER
// ============================================
exports.createSupplier = async (req, res) => {
  try {
    const supplierData = req.body;
    supplierData.createdBy = req.user.id;

    console.log('📦 Creating supplier:', supplierData);

    const supplier = new Supplier(supplierData);
    await supplier.save();

    console.log('✅ Supplier created:', supplier._id);

    res.status(201).json({
      success: true,
      data: supplier,
      message: 'Supplier created successfully!'
    });
  } catch (error) {
    console.error('❌ Create supplier error:', error);
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
    const { page = 1, limit = 10, status, search } = req.query;

    const query = {};
    if (status && status !== 'all') query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { contactPerson: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { gst: { $regex: search, $options: 'i' } }
      ];
    }

    const suppliers = await Supplier.find(query)
      .populate('products', 'name sku')
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
      .populate('products', 'name sku pricing.sellingPrice')
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

    // Remove supplier reference from products
    await Product.updateMany(
      { supplier: supplier._id },
      { $unset: { supplier: '' } }
    );

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