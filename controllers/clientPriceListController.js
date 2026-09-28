// controllers/clientPriceListController.js
const ClientPriceList = require('../models/ClientPriceList');
const Product = require('../models/Product');
const Lead = require('../models/Lead');
const mongoose = require('mongoose');

const isValidId = (id) =>
  id && mongoose.Types.ObjectId.isValid(id) &&
  String(new mongoose.Types.ObjectId(id)) === String(id);

// GET all client price lists
exports.getClientPriceLists = async (req, res) => {
  try {
    const { search, clientId, status } = req.query;
    const query = {};

    if (clientId && isValidId(clientId)) query.clientId = clientId;
    if (status && status !== 'all') query.status = status;
    if (search) {
      query.$or = [
        { clientName: { $regex: search, $options: 'i' } },
        { 'items.productName': { $regex: search, $options: 'i' } },
        { 'items.sku': { $regex: search, $options: 'i' } },
        { 'items.batchNumber': { $regex: search, $options: 'i' } }
      ];
    }

    const lists = await ClientPriceList.find(query)
      .populate('clientId', 'name companyName email phone currency state country')
      .populate('items.productId', 'name sku unit productType pricing stock status batches category subCategory hsnCode')
      .sort({ updatedAt: -1 });

    res.json({ success: true, data: lists });
  } catch (err) {
    console.error('getClientPriceLists error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET single price list by clientId (Used by Sales / Proforma)
exports.getPriceListByClient = async (req, res) => {
  try {
    const { clientId } = req.params;
    if (!isValidId(clientId)) {
      return res.status(400).json({ success: false, message: 'Invalid client id' });
    }

    const list = await ClientPriceList.findOne({ clientId, status: 'active' })
      .populate('clientId', 'name companyName email phone currency')
      .populate('items.productId', 'name sku unit productType pricing stock status batches hsnCode category subCategory');

    if (!list) {
      return res.json({ success: true, data: null, message: 'No price list found for this client' });
    }

    res.json({ success: true, data: list });
  } catch (err) {
    console.error('getPriceListByClient error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// CREATE or REPLACE full price list for a client (Allows multiple batches of the same product)
exports.upsertClientPriceList = async (req, res) => {
  try {
    const { clientId, items = [], notes = '', status = 'active' } = req.body;

    if (!isValidId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId required' });
    }

    const client = await Lead.findById(clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client/Lead not found' });
    }

    const cleanItems = [];
    for (const raw of items) {
      const rawPid = typeof raw.productId === 'object' && raw.productId !== null
        ? (raw.productId._id || raw.productId.id)
        : raw.productId;

      if (!isValidId(rawPid)) continue;
      const product = await Product.findById(rawPid);
      if (!product) continue;

      const sellingPrice = parseFloat(raw.sellingPrice ?? raw.rate);
      if (isNaN(sellingPrice) || sellingPrice < 0) continue;

      const defaultQty = Math.max(1, parseInt(raw.defaultQty) || 1);
      const unit = (raw.unit || product.unit || 'Pcs').trim();
      const taxRate = raw.taxRate !== undefined ? parseFloat(raw.taxRate) : (product.pricing?.taxRate || 5);
      const batchNo = ''; // Pricing does not allocate or create inventory batches.
      const isBatch = (product.productType || 'batch') !== 'non-batch';

      cleanItems.push({
        productId: product._id,
        productName: product.name || '',
        sku: product.sku || '',
        hsn: product.hsnCode || '',
        unit,
        sellingPrice,
        defaultQty,
        taxRate,
        batchNumber: batchNo,
        isBatchProduct: isBatch,
        notes: (raw.notes || '').trim()
      });
    }

    const payload = {
      clientId,
      clientName: client.name || client.companyName || '',
      currency: client.currency || 'INR',
      items: cleanItems,
      notes: notes || '',
      status,
      updatedBy: req.user?.id || req.user?._id
    };

    let list = await ClientPriceList.findOne({ clientId });
    if (list) {
      Object.assign(list, payload);
      await list.save();
    } else {
      payload.createdBy = req.user?.id || req.user?._id;
      list = await ClientPriceList.create(payload);
    }

    const populated = await ClientPriceList.findById(list._id)
      .populate('clientId', 'name companyName email phone currency')
      .populate('items.productId', 'name sku unit productType pricing stock status batches category subCategory');

    res.json({
      success: true,
      data: populated,
      message: `Client price list saved (${cleanItems.length} items & batches updated)`
    });
  } catch (err) {
    console.error('upsertClientPriceList error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE entire client price list
exports.deleteClientPriceList = async (req, res) => {
  try {
    const { clientId } = req.params;
    const list = await ClientPriceList.findOneAndDelete({ clientId });
    if (!list) {
      return res.status(404).json({ success: false, message: 'Price list not found' });
    }
    res.json({ success: true, message: 'Client price list deleted successfully' });
  } catch (err) {
    console.error('deleteClientPriceList error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};