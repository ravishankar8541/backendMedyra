const Product = require('../models/Product');

// ============================================
// CREATE PRODUCT
// ============================================
exports.createProduct = async (req, res) => {
  try {
    const { basicInfo, pricing, media } = req.body;
    
    console.log('📦 Received product data:', JSON.stringify(req.body, null, 2));

    // Validate required fields
    if (!basicInfo || !basicInfo.name || !basicInfo.category) {
      return res.status(400).json({
        success: false,
        message: 'Product name and category are required'
      });
    }

    // Generate SKU if not provided
    let sku = basicInfo.sku;
    if (!sku || sku.trim() === '') {
      const prefix = basicInfo.name.substring(0, 3).toUpperCase();
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      sku = `${prefix}-${random}`;
    }

    // ✅ FIX: Handle images properly - filter out empty objects
    let imageUrls = [];
    let documentUrls = [];
    
    if (media && media.images && Array.isArray(media.images)) {
      // Filter out empty objects and keep only strings
      imageUrls = media.images.filter(img => img && typeof img === 'string');
    }
    
    if (media && media.documents && Array.isArray(media.documents)) {
      documentUrls = media.documents.filter(doc => doc && typeof doc === 'string');
    }

    // Transform frontend data
    const productData = {
      name: basicInfo.name.trim(),
      sku: sku,
      category: basicInfo.category,
      subCategory: basicInfo.subCategory || '',
      brand: basicInfo.brand || '',
      manufacturer: basicInfo.manufacturer || '',
      hsnCode: basicInfo.hsnCode || '',
      unit: basicInfo.unit || 'Pcs',
      productType: basicInfo.productType || 'batch',
      
      pricing: {
        mrp: parseFloat(pricing?.mrp) || 0,
        sellingPrice: parseFloat(pricing?.sellingPrice) || 0,
        costPrice: parseFloat(pricing?.costPrice) || 0,
        taxRate: parseFloat(pricing?.taxRate) || 18,
        discount: parseFloat(pricing?.discount) || 0,
        currency: pricing?.currency || 'INR'
      },
      
      minStock: parseInt(basicInfo.minStock) || 0,
      maxStock: parseInt(basicInfo.maxStock) || 0,
      reorderLevel: parseInt(basicInfo.reorderLevel) || 0,
      
      stock: 0,
      batches: [],
      
      images: imageUrls, // ✅ Will be empty array if no valid images
      documents: documentUrls,
      
      status: 'active',
      createdBy: req.user.id
    };

    console.log('📝 Saving product:', JSON.stringify(productData, null, 2));

    const product = new Product(productData);
    await product.save();

    console.log('✅ Product created successfully. ID:', product._id);

    res.status(201).json({
      success: true,
      data: product,
      message: 'Product created successfully!'
    });
  } catch (error) {
    console.error('❌ Create product error:', error);
    
    if (error.code === 11000 && error.keyPattern?.sku) {
      return res.status(400).json({
        success: false,
        message: 'SKU already exists. Please use a different SKU.'
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
// UPDATE BATCH - FULL EDIT
// ============================================
exports.updateBatch = async (req, res) => {
  try {
    const { batchIndex } = req.params;
    const { batchNumber, mfgDate, expDate, quantity, manufacturer, reason, action } = req.body;

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const index = parseInt(batchIndex);
    if (isNaN(index) || index >= product.batches.length) {
      return res.status(400).json({
        success: false,
        message: 'Batch not found'
      });
    }

    const batch = product.batches[index];
    
    if (action === 'edit') {
      // FULL EDIT - Update all fields
      batch.batchNumber = batchNumber || batch.batchNumber;
      batch.mfgDate = mfgDate || batch.mfgDate;
      batch.expDate = expDate || batch.expDate;
      batch.quantity = parseInt(quantity) || batch.quantity;
      batch.manufacturer = manufacturer || batch.manufacturer || 'N/A';
      batch.reason = reason || batch.reason || 'Batch updated';
      batch.addedDate = new Date().toISOString().split('T')[0];
      
      console.log(`✅ Batch ${batch.batchNumber} updated successfully`);
    } else if (action === 'add') {
      // ADD stock to existing batch
      const addQuantity = parseInt(quantity) || 0;
      if (addQuantity <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid quantity is required'
        });
      }
      
      batch.quantity += addQuantity;
      batch.reason = reason || `Stock addition (${addQuantity} units)`;
      batch.addedDate = new Date().toISOString().split('T')[0];
      
      console.log(`✅ Added ${addQuantity} to batch ${batch.batchNumber}. New quantity: ${batch.quantity}`);
    } else {
      // REMOVE stock from batch
      const removeQuantity = parseInt(quantity) || 0;
      if (removeQuantity <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid quantity is required'
        });
      }
      
      if (batch.quantity < removeQuantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock in batch. Available: ${batch.quantity}`
        });
      }
      
      batch.quantity -= removeQuantity;
      batch.reason = reason || `Stock removal (${removeQuantity} units)`;
      
      console.log(`✅ Removed ${removeQuantity} from batch ${batch.batchNumber}. New quantity: ${batch.quantity}`);
      
      // If batch quantity becomes 0, remove the batch
      if (batch.quantity === 0) {
        product.batches.splice(index, 1);
        console.log(`🗑️ Batch ${batch.batchNumber} removed`);
      }
    }

    await product.save();

    res.json({
      success: true,
      data: product,
      batch: product.batches[index] || null,
      message: `Batch updated successfully!`
    });
  } catch (error) {
    console.error('Update batch error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ============================================
// DELETE BATCH
// ============================================
exports.deleteBatch = async (req, res) => {
  try {
    const { batchIndex } = req.params;
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const index = parseInt(batchIndex);
    if (isNaN(index) || index >= product.batches.length) {
      return res.status(400).json({
        success: false,
        message: 'Batch not found'
      });
    }

    const batch = product.batches[index];
    const batchNumber = batch.batchNumber || 'N/A';
    
    // Remove the batch
    product.batches.splice(index, 1);
    await product.save();

    console.log(`🗑️ Batch ${batchNumber} deleted successfully`);

    res.json({
      success: true,
      message: `Batch ${batchNumber} deleted successfully!`,
      data: product
    });
  } catch (error) {
    console.error('Delete batch error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};
// ============================================
// GET ALL PRODUCTS
// ============================================
exports.getProducts = async (req, res) => {
  try {
    const { page = 1, limit = 10, category, status, search } = req.query;

    const query = {};
    if (category && category !== 'all') query.category = category;
    if (status && status !== 'all') query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } }
      ];
    }

    const products = await Product.find(query)
      .populate('createdBy', 'name email')
      .populate('supplier', 'name phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Product.countDocuments(query);

    const totalProducts = await Product.countDocuments();
    const activeProducts = await Product.countDocuments({ status: 'active' });
    const lowStock = await Product.countDocuments({ status: 'low_stock' });
    const critical = await Product.countDocuments({ status: 'critical' });

    res.json({
      success: true,
      data: products,
      stats: {
        total: totalProducts,
        active: activeProducts,
        lowStock: lowStock,
        critical: critical
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET SINGLE PRODUCT
// ============================================
exports.getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('supplier', 'name phone');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// UPDATE PRODUCT
// ============================================
exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const updateData = req.body;
    
    if (updateData.basicInfo) {
      Object.assign(product, {
        name: updateData.basicInfo.name || product.name,
        sku: updateData.basicInfo.sku || product.sku,
        category: updateData.basicInfo.category || product.category,
        subCategory: updateData.basicInfo.subCategory || product.subCategory,
        brand: updateData.basicInfo.brand || product.brand,
        manufacturer: updateData.basicInfo.manufacturer || product.manufacturer,
        hsnCode: updateData.basicInfo.hsnCode || product.hsnCode,
        unit: updateData.basicInfo.unit || product.unit,
        productType: updateData.basicInfo.productType || product.productType,
        minStock: parseInt(updateData.basicInfo.minStock) || product.minStock,
        maxStock: parseInt(updateData.basicInfo.maxStock) || product.maxStock,
        reorderLevel: parseInt(updateData.basicInfo.reorderLevel) || product.reorderLevel
      });
      
      if (updateData.pricing) {
        product.pricing = {
          mrp: parseFloat(updateData.pricing.mrp) || product.pricing.mrp,
          sellingPrice: parseFloat(updateData.pricing.sellingPrice) || product.pricing.sellingPrice,
          costPrice: parseFloat(updateData.pricing.costPrice) || product.pricing.costPrice,
          taxRate: parseFloat(updateData.pricing.taxRate) || product.pricing.taxRate,
          discount: parseFloat(updateData.pricing.discount) || product.pricing.discount,
          currency: updateData.pricing.currency || product.pricing.currency
        };
      }
      
      if (updateData.media) {
        if (updateData.media.images && Array.isArray(updateData.media.images)) {
          product.images = updateData.media.images.filter(img => img && typeof img === 'string');
        }
        if (updateData.media.documents && Array.isArray(updateData.media.documents)) {
          product.documents = updateData.media.documents.filter(doc => doc && typeof doc === 'string');
        }
      }
    } else {
      Object.assign(product, updateData);
    }

    await product.save();

    res.json({
      success: true,
      data: product,
      message: 'Product updated successfully!'
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// DELETE PRODUCT
// ============================================
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    await product.deleteOne();
    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ADD BATCH TO PRODUCT
// ============================================
exports.addBatch = async (req, res) => {
  try {
    const { batchNumber, mfgDate, expDate, quantity, packing, grossWeight, totalKg, dimension, storageCondition, shelfLife, reason } = req.body;

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (!quantity || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid quantity is required'
      });
    }

    const newBatch = {
      batchNumber: batchNumber || `BATCH-${Date.now().toString().slice(-6)}`,
      mfgDate: mfgDate || '',
      expDate: expDate || '',
      quantity: parseInt(quantity) || 0,
      packing: packing || 'N/A',
      grossWeight: parseFloat(grossWeight) || 0,
      totalKg: parseFloat(totalKg) || 0,
      dimension: dimension || 'N/A',
      storageCondition: storageCondition || 'Room temperature',
      shelfLife: shelfLife || 'N/A',
      addedDate: new Date().toISOString().split('T')[0],
      addedBy: req.user?.name || 'System',
      reason: reason || 'Stock addition'
    };

    product.batches.push(newBatch);
    await product.save();

    res.status(201).json({
      success: true,
      data: product,
      batch: newBatch,
      message: `Batch ${newBatch.batchNumber} added successfully!`
    });
  } catch (error) {
    console.error('Add batch error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// REMOVE BATCH STOCK
// ============================================
exports.removeBatchStock = async (req, res) => {
  try {
    const { batchIndex, quantity, reason } = req.body;
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (batchIndex >= product.batches.length) {
      return res.status(400).json({
        success: false,
        message: 'Batch not found'
      });
    }

    const batch = product.batches[batchIndex];
    if (quantity > batch.quantity) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient stock in batch'
      });
    }

    batch.quantity -= quantity;
    if (batch.quantity === 0) {
      product.batches.splice(batchIndex, 1);
    }

    await product.save();

    res.json({
      success: true,
      data: product,
      message: 'Stock removed successfully!'
    });
  } catch (error) {
    console.error('Remove batch stock error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// UPDATE STOCK
// ============================================
exports.updateStock = async (req, res) => {
  try {
    const { quantity, action, reason, batchIndex } = req.body;
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (batchIndex !== undefined && product.batches[batchIndex]) {
      const batch = product.batches[batchIndex];
      if (action === 'add') {
        batch.quantity += parseInt(quantity);
      } else {
        if (batch.quantity < quantity) {
          return res.status(400).json({
            success: false,
            message: 'Insufficient stock in batch'
          });
        }
        batch.quantity -= parseInt(quantity);
        if (batch.quantity === 0) {
          product.batches.splice(batchIndex, 1);
        }
      }
    } else {
      if (action === 'add') {
        product.stock += parseInt(quantity);
      } else {
        if (product.stock < quantity) {
          return res.status(400).json({
            success: false,
            message: 'Insufficient stock'
          });
        }
        product.stock -= parseInt(quantity);
      }
    }

    await product.save();

    res.json({
      success: true,
      data: product,
      message: 'Stock updated successfully!'
    });
  } catch (error) {
    console.error('Update stock error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET LOW STOCK PRODUCTS
// ============================================
exports.getLowStockProducts = async (req, res) => {
  try {
    const products = await Product.find({
      status: { $in: ['low_stock', 'critical'] }
    });

    const stats = {
      total: products.length,
      critical: products.filter(p => p.status === 'critical').length,
      low: products.filter(p => p.status === 'low_stock').length
    };

    res.json({
      success: true,
      data: products,
      stats
    });
  } catch (error) {
    console.error('Get low stock products error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};