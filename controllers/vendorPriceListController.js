// controllers/vendorPriceListController.js
const VendorPriceList = require('../models/VendorPriceList');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const mongoose = require('mongoose');

const isValidId = (id) =>
  id && mongoose.Types.ObjectId.isValid(id) &&
  String(new mongoose.Types.ObjectId(id)) === String(id);

// GET all price lists (optional search / supplier filter)
exports.getPriceLists = async (req, res) => {
  try {
    const { search, supplierId, status } = req.query;
    const query = {};

    if (supplierId && isValidId(supplierId)) query.supplierId = supplierId;
    if (status && status !== 'all') query.status = status;
    if (search) {
      query.$or = [
        { supplierName: { $regex: search, $options: 'i' } },
        { 'items.productName': { $regex: search, $options: 'i' } },
        { 'items.sku': { $regex: search, $options: 'i' } }
      ];
    }

    // ✅ batches populated so front-end has all available batches
    const lists = await VendorPriceList.find(query)
      .populate('supplierId', 'companyName email phone currency')
      .populate('items.productId', 'name sku unit productType pricing stock status batches category subCategory hsnCode')
      .sort({ updatedAt: -1 });

    res.json({ success: true, data: lists });
  } catch (err) {
    console.error('getPriceLists error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET single price list by supplierId (used by Create PO)
exports.getPriceListBySupplier = async (req, res) => {
  try {
    const { supplierId } = req.params;
    if (!isValidId(supplierId)) {
      return res.status(400).json({ success: false, message: 'Invalid supplier id' });
    }

    const list = await VendorPriceList.findOne({ supplierId, status: 'active' })
      .populate('supplierId', 'companyName email phone currency')
      .populate('items.productId', 'name sku unit productType pricing stock status batches hsnCode category subCategory');

    if (!list) {
      return res.json({ success: true, data: null, message: 'No price list for this supplier' });
    }

    res.json({ success: true, data: list });
  } catch (err) {
    console.error('getPriceListBySupplier error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// CREATE or REPLACE full price list for a supplier
exports.upsertPriceList = async (req, res) => {
  try {
    const { supplierId, items = [], notes = '', status = 'active' } = req.body;

    if (!isValidId(supplierId)) {
      return res.status(400).json({ success: false, message: 'Valid supplierId required' });
    }

    const supplier = await Supplier.findById(supplierId);
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    // Sanitize & enrich items from Product
    const cleanItems = [];
    for (const raw of items) {
      const rawPid = typeof raw.productId === 'object' && raw.productId !== null
        ? (raw.productId._id || raw.productId.id)
        : raw.productId;

      if (!isValidId(rawPid)) continue;
      const product = await Product.findById(rawPid);
      if (!product) continue;

      const costPrice = parseFloat(raw.costPrice);
      if (isNaN(costPrice) || costPrice < 0) continue;

      const defaultQty = Math.max(1, parseInt(raw.defaultQty) || 1);
      const unit = (raw.unit || product.unit || 'Pcs').trim();
      const batchNo = (raw.batchNumber || '').trim();
      const isBatch = (product.productType || 'batch') !== 'non-batch';

      // ✅ AUTO-REGISTER NEW BATCH IN PRODUCT INVENTORY
      if (isBatch && batchNo && batchNo !== 'N/A') {
        if (!Array.isArray(product.batches)) product.batches = [];
        const batchExists = product.batches.some(
          (b) => (b.batchNumber || '').trim().toLowerCase() === batchNo.toLowerCase()
        );

        if (!batchExists) {
          product.batches.push({
            batchNumber: batchNo,
            quantity: 0,
            costPrice: costPrice,
            mrp: product.pricing?.mrp || 0,
            sellingPrice: product.pricing?.sellingPrice || 0,
            supplierName: supplier.companyName || '',
            supplier: supplier._id,
            addedDate: new Date().toISOString().split('T')[0],
            addedBy: req.user?.name || 'Vendor Price List',
            reason: `Registered via Vendor Price List (${supplier.companyName})`
          });
          product.markModified('batches');
          await product.save();
        }
      }

      cleanItems.push({
        productId: product._id,
        productName: product.name || '',
        sku: product.sku || '',
        hsn: product.hsnCode || '',
        unit,
        costPrice,
        defaultQty,
        batchNumber: batchNo,
        isBatchProduct: isBatch,
        notes: (raw.notes || '').trim()
      });
    }

    const payload = {
      supplierId,
      supplierName: supplier.companyName || '',
      items: cleanItems,
      notes: notes || '',
      status,
      updatedBy: req.user?.id || req.user?._id
    };

    let list = await VendorPriceList.findOne({ supplierId });
    if (list) {
      Object.assign(list, payload);
      await list.save();
    } else {
      payload.createdBy = req.user?.id || req.user?._id;
      list = await VendorPriceList.create(payload);
    }

    const populated = await VendorPriceList.findById(list._id)
      .populate('supplierId', 'companyName email phone currency')
      .populate('items.productId', 'name sku unit productType pricing stock status batches category subCategory');

    res.json({
      success: true,
      data: populated,
      message: `Price list saved (${cleanItems.length} products & batches updated)`
    });
  } catch (err) {
    console.error('upsertPriceList error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ADD / UPDATE single item in a supplier's price list
exports.upsertItem = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const { productId, costPrice, defaultQty, unit, notes, batchNumber } = req.body;

    const rawPid = typeof productId === 'object' && productId !== null
      ? (productId._id || productId.id)
      : productId;

    if (!isValidId(supplierId) || !isValidId(rawPid)) {
      return res.status(400).json({ success: false, message: 'supplierId & productId required' });
    }

    const price = parseFloat(costPrice);
    if (isNaN(price) || price < 0) {
      return res.status(400).json({ success: false, message: 'Valid costPrice required' });
    }

    const product = await Product.findById(rawPid);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const batchNo = (batchNumber || '').trim();
    const isBatch = (product.productType || 'batch') !== 'non-batch';

    // Register batch if new
    if (isBatch && batchNo && batchNo !== 'N/A') {
      if (!Array.isArray(product.batches)) product.batches = [];
      const batchExists = product.batches.some(
        (b) => (b.batchNumber || '').trim().toLowerCase() === batchNo.toLowerCase()
      );

      if (!batchExists) {
        product.batches.push({
          batchNumber: batchNo,
          quantity: 0,
          costPrice: price,
          addedDate: new Date().toISOString().split('T')[0],
          addedBy: req.user?.name || 'Vendor Price List',
          reason: `Item batch registered via Price List`
        });
        product.markModified('batches');
        await product.save();
      }
    }

    let list = await VendorPriceList.findOne({ supplierId });
    if (!list) {
      const supplier = await Supplier.findById(supplierId);
      if (!supplier) {
        return res.status(404).json({ success: false, message: 'Supplier not found' });
      }
      list = new VendorPriceList({
        supplierId,
        supplierName: supplier.companyName || '',
        items: [],
        createdBy: req.user?.id || req.user?._id
      });
    }

    const idx = list.items.findIndex(
      (i) => i.productId && i.productId.toString() === rawPid.toString() && (i.batchNumber || '') === batchNo
    );

    const itemData = {
      productId: product._id,
      productName: product.name || '',
      sku: product.sku || '',
      hsn: product.hsnCode || '',
      unit: (unit || product.unit || 'Pcs').trim(),
      costPrice: price,
      defaultQty: Math.max(1, parseInt(defaultQty) || 1),
      batchNumber: batchNo,
      isBatchProduct: isBatch,
      notes: (notes || '').trim()
    };

    if (idx >= 0) {
      list.items[idx] = { ...(list.items[idx].toObject?.() || list.items[idx]), ...itemData };
    } else {
      list.items.push(itemData);
    }

    list.updatedBy = req.user?.id || req.user?._id;
    await list.save();

    res.json({
      success: true,
      data: list,
      message: idx >= 0 ? 'Item updated' : 'Item added'
    });
  } catch (err) {
    console.error('upsertItem error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// REMOVE one item from price list
exports.removeItem = async (req, res) => {
  try {
    const { supplierId, itemId } = req.params;
    const list = await VendorPriceList.findOne({ supplierId });
    if (!list) {
      return res.status(404).json({ success: false, message: 'Price list not found' });
    }

    const before = list.items.length;
    list.items = list.items.filter((i) => i._id.toString() !== itemId);
    if (list.items.length === before) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    list.updatedBy = req.user?.id || req.user?._id;
    await list.save();

    res.json({ success: true, data: list, message: 'Item removed' });
  } catch (err) {
    console.error('removeItem error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE entire price list
exports.deletePriceList = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const list = await VendorPriceList.findOneAndDelete({ supplierId });
    if (!list) {
      return res.status(404).json({ success: false, message: 'Price list not found' });
    }
    res.json({ success: true, message: 'Price list deleted' });
  } catch (err) {
    console.error('deletePriceList error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};