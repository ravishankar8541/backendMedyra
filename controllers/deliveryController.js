const Delivery = require('../models/Delivery');
const Package = require('../models/Package');
const Invoice = require('../models/Invoice');

// 1. GET ALL DELIVERIES
exports.getDeliveries = async (req, res) => {
  try {
    const { status, search, limit = 100 } = req.query;
    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }

    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
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
      .limit(parseInt(limit));

    res.json({ success: true, data: deliveries });
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

    const count = await Delivery.countDocuments();
    const year = new Date().getFullYear();
    data.deliveryNumber = data.deliveryNumber || `DEL-${year}-${String(count + 1).padStart(4, '0')}`;

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
    const packages = await Package.find().sort({ createdAt: -1 }).limit(50);
    let createdCount = 0;

    for (const pkg of packages) {
      const exists = await Delivery.findOne({ orderId: pkg.orderId });
      if (!exists) {
        const count = await Delivery.countDocuments();
        const year = new Date().getFullYear();

        const itemsList = (pkg.products || [])
          .map(p => `${p.name} (Qty: ${p.quantity})`)
          .join(', ');

        await Delivery.create({
          deliveryNumber: `DEL-${year}-${String(count + 1).padStart(4, '0')}`,
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
          status: pkg.status === 'completed' ? 'delivered' : 'pending',
          deliveredAt: pkg.status === 'completed' ? new Date() : null,
          receivedBy: pkg.status === 'completed' ? pkg.customerName : ''
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

    const delivery = await Delivery.findById(id);
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery not found' });
    }

    delivery.status = 'delivered';
    delivery.deliveredAt = new Date();
    delivery.receivedBy = receivedBy || delivery.customer.name;
    delivery.receiverPhone = receiverPhone || delivery.customer.phone;
    delivery.deliveryNotes = deliveryNotes || 'Delivered successfully and confirmed.';

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
      data: delivery,
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

    const updateData = { status };
    if (driverName) updateData.driverName = driverName;
    if (driverPhone) updateData.driverPhone = driverPhone;
    if (trackingNumber) updateData.trackingNumber = trackingNumber;

    if (status === 'delivered') {
      updateData.deliveredAt = new Date();
    }

    const delivery = await Delivery.findByIdAndUpdate(id, updateData, { new: true });
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
    await Delivery.findByIdAndDelete(id);
    res.json({ success: true, message: '🗑️ Delivery record deleted successfully.' });
  } catch (error) {
    console.error('deleteDelivery error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};