const Package = require('../models/Package');
const mongoose = require('mongoose');
const { normalizePackage, statuses } = require('../utils/packageValidation');

// Helper to sanitize product items and prevent CastError on empty strings
const sanitizeItem = (item) => {
  if (!item) return item;
  let prodId = item.productId;
  if (!prodId || prodId === '' || typeof prodId !== 'string' || prodId.length !== 24 || !mongoose.Types.ObjectId.isValid(prodId)) {
    prodId = null;
  }
  return {
    ...item,
    productId: prodId
  };
};

// ============================================
// 1. GET ALL PACKAGES
// ============================================
exports.getPackages = async (req, res) => {
  try {
    const { search, status, priority, startDate, endDate } = req.query;
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const query = {};

    if (status && status !== 'all') query.status = status;
    if (priority && priority !== 'all') query.priority = priority;

    if (search) {
      const literalSearch = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        ...['orderId', 'customerName', 'invoiceNo', 'products.name', 'boxes.boxNumber', 'boxes.items.name', 'boxes.items.batchNo'].map(field => ({ [field]: { $regex: literalSearch, $options: 'i' } }))
      ];
    }

    if (startDate || endDate) {
      query.createdDate = {};
      if (startDate) query.createdDate.$gte = startDate;
      if (endDate) query.createdDate.$lte = endDate;
    }

    const packages = await Package.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    const total = await Package.countDocuments(query);

    res.json({ success: true, data: packages, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('getPackages error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// 2. GET SINGLE PACKAGE BY ID
// ============================================
exports.getPackageById = async (req, res) => {
  try {
    const pkg = await Package.findById(req.params.id).populate('createdBy', 'name email');
    if (!pkg) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }
    res.json({ success: true, data: pkg });
  } catch (error) {
    console.error('getPackageById error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// 3. CREATE NEW PACKAGE
// ============================================
exports.createPackage = async (req, res) => {
  try {
    const data = { ...req.body };
    data.createdBy = req.user?.id || req.user?._id || null;

    if (!data.orderId || !data.customerName || !data.customerAddress) {
      return res.status(400).json({
        success: false,
        message: 'Order ID, Customer Name, and Address are required'
      });
    }

    if (!data.createdDate) {
      data.createdDate = new Date().toISOString().split('T')[0];
    }
    if (!data.invoiceDate) {
      data.invoiceDate = data.createdDate;
    }

    // Sanitize products array
    if (data.products && Array.isArray(data.products)) {
      data.products = data.products.map(sanitizeItem);
    }

    // Sanitize boxes items array
    if (data.boxes && Array.isArray(data.boxes)) {
      data.boxes = data.boxes.map(box => ({
        ...box,
        items: (box.items || []).map(sanitizeItem)
      }));
    } else {
      data.boxes = [{
        boxIndex: 1,
        boxNumber: '1',
        totalBoxes: 1,
        netWeight: data.totalNetWeight || '',
        grossWeight: data.totalGrossWeight || '',
        dimension: data.boxDimension || '57*38*39',
        items: data.products || []
      }];
    }

    let normalized;
    try { normalized = normalizePackage(data); }
    catch (error) { return res.status(400).json({ success: false, message: error.message }); }
    const newPackage = new Package(normalized);
    await newPackage.save();

    res.status(201).json({
      success: true,
      data: newPackage,
      message: 'Package created successfully!'
    });
  } catch (error) {
    console.error('createPackage error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// 4. UPDATE PACKAGE
// ============================================
exports.updatePackage = async (req, res) => {
  try {
    const { id } = req.params;
    let updateData;
    try { updateData = normalizePackage(req.body); }
    catch (error) { return res.status(400).json({ success: false, message: error.message }); }
    // Changing carton contents invalidates previously generated documents.
    if (updateData.boxes) {
      updateData.labelGenerated = false;
      updateData.packingSlipGenerated = false;
      updateData.labelGeneratedAt = null;
      updateData.packingSlipGeneratedAt = null;
    }

    // Sanitize products array
    if (updateData.products && Array.isArray(updateData.products)) {
      updateData.products = updateData.products.map(sanitizeItem);
    }

    // Sanitize boxes items array
    if (updateData.boxes && Array.isArray(updateData.boxes)) {
      updateData.totalBoxesCount = updateData.boxes.length;
      updateData.boxNo = updateData.boxes.length > 1 
        ? `1/${updateData.boxes.length}` 
        : (updateData.boxNo || '1/1');

      updateData.boxes = updateData.boxes.map(box => ({
        ...box,
        items: (box.items || []).map(sanitizeItem)
      }));
    }

    const updatedPackage = await Package.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');

    if (!updatedPackage) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }

    res.json({
      success: true,
      data: updatedPackage,
      message: '✅ Package updated successfully!'
    });
  } catch (error) {
    console.error('updatePackage error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// 5. DELETE PACKAGE
// ============================================
exports.deletePackage = async (req, res) => {
  try {
    const { id } = req.params;
    const pkg = await Package.findByIdAndDelete(id);
    if (!pkg) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }

    res.json({
      success: true,
      message: `🗑️ Package "${pkg.orderId}" deleted successfully`
    });
  } catch (error) {
    console.error('deletePackage error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// 6. UPDATE STATUS
// ============================================
exports.updatePackageStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!statuses.includes(status)) return res.status(400).json({ success: false, message: 'Invalid package status.' });
    const updateData = { status, completedDate: '' };
    if (status === 'completed') {
      updateData.completedDate = new Date().toISOString().split('T')[0];
    }

    const pkg = await Package.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });
    
    res.json({ success: true, data: pkg, message: `Status updated to ${status}` });
  } catch (error) {
    console.error('updatePackageStatus error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// 7. MARK LABEL GENERATED
// ============================================
exports.markLabelGenerated = async (req, res) => {
  try {
    const pkg = await Package.findByIdAndUpdate(
      req.params.id,
      { labelGenerated: true, labelGeneratedAt: new Date() },
      { new: true }
    );
    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });
    res.json({ success: true, data: pkg });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// 8. MARK PACKING SLIP GENERATED
// ============================================
exports.markSlipGenerated = async (req, res) => {
  try {
    const pkg = await Package.findByIdAndUpdate(
      req.params.id,
      { packingSlipGenerated: true, packingSlipGeneratedAt: new Date() },
      { new: true }
    );
    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });
    res.json({ success: true, data: pkg });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
