const Delivery = require('../models/Delivery');
const Package = require('../models/Package');
const Invoice = require('../models/Invoice');
const { randomBytes } = require('node:crypto');
const readProof = require('../utils/deliveryProof');
const deliveryNumber = () => `DEL-${new Date().getFullYear()}-${randomBytes(6).toString('hex').toUpperCase()}`;
const publicDelivery = doc => {
  const data = doc.toObject ? doc.toObject() : { ...doc };
  if (data.proof) { data.proof = { ...data.proof }; delete data.proof.data; }
  return data;
};

// 1. GET ALL DELIVERIES
exports.getDeliveries = async (req, res) => {
  try {
    const { status, search } = req.query;
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }

    if (search) {
      const searchRegex = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      query.$or = [
        { deliveryNumber: searchRegex },
        { orderId: searchRegex },
        { invoiceNo: searchRegex },
        { 'customer.name': searchRegex },
        { 'customer.phone': searchRegex },
        { receivedBy: searchRegex }
      ];
    }

    const deliveries = await Delivery.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit).limit(limit);
    const total = await Delivery.countDocuments(query);

    res.json({ success: true, data: deliveries, pagination: { page, pages: Math.ceil(total / limit), total } });
  } catch (error) {
    console.error('getDeliveries error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. CREATE DIRECT OR FROM PACKAGE/INVOICE
exports.createDelivery = async (req, res) => {
  try {
    const data = { ...req.body };
    data.createdBy = req.user?.id || null;

    data.deliveryNumber = deliveryNumber();
    data.status = 'pending';
    data.deliveredAt = null; data.receivedBy = ''; delete data.proof;

    const delivery = new Delivery(data);
    await delivery.save();

    res.status(201).json({
      success: true,
      data: delivery,
      message: '✅ Delivery entry created!'
    });
  } catch (error) {
    console.error('createDelivery error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. AUTO-SYNC FROM EXISTING PACKAGES (One-click import)
exports.syncFromPackages = async (req, res) => {
  try {
    const packages = await Package.find().sort({ createdAt: -1 });
    let createdCount = 0;

    for (const pkg of packages) {
      const exists = await Delivery.findOne({ $or: [{ packageId: pkg._id }, { orderId: pkg.orderId, packageId: null }] });
      if (!exists) {

        const itemsList = (pkg.products || [])
          .map(p => `${p.name} (Qty: ${p.quantity})`)
          .join(', ');

        await Delivery.create({
          deliveryNumber: deliveryNumber(),
          orderId: pkg.orderId,
          invoiceNo: pkg.invoiceNo || pkg.orderId,
          packageId: pkg._id,
          customer: {
            name: pkg.customerName,
            phone: pkg.customerPhone || 'N/A',
            address: pkg.customerAddress,
            country: pkg.destinationCountry || 'India'
          },
          itemsSummary: itemsList || 'Pharmaceutical Goods',
          totalBoxes: pkg.totalBoxesCount || pkg.boxes?.length || 1,
          totalWeight: pkg.totalGrossWeight || '',
          driverName: pkg.shippingMethod || 'Standard Courier',
          status: 'pending',
          deliveredAt: null,
          receivedBy: ''
        });
        createdCount++;
      }
    }

    res.json({
      success: true,
      message: `✅ Synced ${createdCount} package(s) into Delivery Dashboard!`
    });
  } catch (error) {
    console.error('syncFromPackages error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. CONFIRM DELIVERY ("PAHUCH GAYA")
exports.confirmDelivery = async (req, res) => {
  try {
    const { id } = req.params;
    const { receivedBy, receiverPhone, deliveryNotes } = req.body;
    if (typeof receivedBy !== 'string' || !receivedBy.trim()) return res.status(400).json({ success: false, message: 'Enter the actual receiver name.' });
    let proof;
    try { proof = readProof(req.file); }
    catch (error) { return res.status(400).json({ success: false, message: error.message }); }

    const delivery = await Delivery.findById(id);
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery not found' });
    }
    if (delivery.status === 'delivered') return res.json({ success: true, data: publicDelivery(delivery), message: 'Handover already recorded.' });

    delivery.status = 'delivered';
    delivery.deliveredAt = new Date();
    delivery.receivedBy = receivedBy.trim();
    delivery.receiverPhone = String(receiverPhone || '').trim();
    delivery.deliveryNotes = String(deliveryNotes || '').trim();
    delivery.confirmedBy = req.user?.id || req.user?._id;
    if (proof) delivery.proof = proof;

    await delivery.save();

    // Auto mark linked package as completed if exists
    if (delivery.packageId) {
      await Package.findByIdAndUpdate(delivery.packageId, {
        status: 'completed',
        completedDate: new Date().toISOString().split('T')[0]
      });
    }

    res.json({
      success: true,
      data: publicDelivery(delivery),
      message: `🎉 Order ${delivery.orderId} marked as DELIVERED to ${delivery.receivedBy}!`
    });
  } catch (error) {
    console.error('confirmDelivery error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 5. UPDATE STATUS (Pending -> Out for Delivery -> etc.)
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, driverName, driverPhone, trackingNumber } = req.body;
    if (!['pending', 'out_for_delivery', 'delivered', 'failed', 'returned'].includes(status)) return res.status(400).json({ success: false, message: 'Choose a valid delivery status.' });
    const current = await Delivery.findById(id);
    if (!current) return res.status(404).json({ success: false, message: 'Delivery not found' });

    const updateData = { status };
    if (driverName) updateData.driverName = driverName;
    if (driverPhone) updateData.driverPhone = driverPhone;
    if (trackingNumber) updateData.trackingNumber = trackingNumber;

    if (status === 'delivered') {
      updateData.deliveredAt = current.status === 'delivered' ? current.deliveredAt : new Date();
    } else {
      updateData.deliveredAt = null;
    }

    const delivery = await Delivery.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery not found' });
    }

    res.json({
      success: true,
      data: delivery,
      message: `Status updated to ${status}`
    });
  } catch (error) {
    console.error('updateStatus error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. DELETE DELIVERY
exports.deleteDelivery = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Delivery.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Delivery not found' });
    res.json({ success: true, message: '🗑️ Delivery record deleted successfully.' });
  } catch (error) {
    console.error('deleteDelivery error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.uploadProof = async (req, res) => {
  try {
    let proof;
    try { proof = readProof(req.file); }
    catch (error) { return res.status(400).json({ success: false, message: error.message }); }
    if (!proof) return res.status(400).json({ success: false, message: 'Choose a proof file.' });
    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) return res.status(404).json({ success: false, message: 'Delivery not found' });
    if (delivery.status !== 'delivered') return res.status(400).json({ success: false, message: 'Confirm handover before attaching proof.' });
    if (delivery.proof?.size) return res.status(409).json({ success: false, message: 'Proof is already recorded for this handover.' });
    delivery.proof = proof;
    await delivery.save();
    res.json({ success: true, data: publicDelivery(delivery), message: 'Handover proof saved.' });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
exports.getProof = async (req, res) => {
  try {
    const delivery = await Delivery.findById(req.params.id).select('+proof.data');
    if (!delivery?.proof?.data) return res.status(404).json({ success: false, message: 'No proof attachment found.' });
    const proof = delivery.proof;
    const filename = String(proof.name || 'handover-proof').replace(/[^a-zA-Z0-9._-]/g, '_');
    res.set({ 'Content-Type': proof.mimeType, 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(Buffer.from(proof.data));
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
