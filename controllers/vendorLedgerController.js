const mongoose = require('mongoose');
const Supplier = require('../models/Supplier');
const PurchaseOrder = require('../models/PurchaseOrder');
const PurchaseReturn = require('../models/PurchaseReturn');
const { GoodsReceipt, ConsolidatedInvoice } = require('../models/GoodsReceipt');
const { buildVendorLedger } = require('../utils/vendorLedger');

exports.getVendorLedger = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid vendor ID.' });
  try {
    const supplier = await Supplier.findById(req.params.id).lean();
    if (!supplier) return res.status(404).json({ success: false, message: 'Vendor not found.' });
    const name = String(supplier.companyName || '').trim();
    const exactName = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    const sameNames = name ? await Supplier.countDocuments({ companyName: exactName }) : 0;
    const warnings = sameNames > 1 ? ['Multiple vendors share this name. Unlinked legacy records are excluded until their vendor IDs are assigned.'] : [];
    const legacyNames = sameNames === 1 ? [{ supplierName: exactName }, { supplier: exactName }] : [];
    // An explicit supplier ID always wins over a matching company name.
    const scope = (links = []) => ({ $or: [
      { supplierId: supplier._id },
      { $and: [{ supplierId: null }, { $or: [
        { supplier: String(supplier._id) }, ...links,
        { $and: [{ purchaseOrder: null }, { supplier: { $not: /^[a-f\d]{24}$/i } }, { $or: legacyNames.length ? legacyNames : [{ _id: null }] }] },
      ] }] },
    ] });
    const orders = await PurchaseOrder.find(scope()).lean();
    const orderLinks = [{ purchaseOrder: { $in: orders.map(order => order._id) } },
      { purchaseOrder: null, poNumber: { $in: orders.map(order => order.poNumber) } }];
    const [receipts, invoices] = await Promise.all([
      GoodsReceipt.find(scope(orderLinks)).lean(), ConsolidatedInvoice.find(scope(orderLinks)).lean(),
    ]);
    const returns = await PurchaseReturn.find(scope([...orderLinks, { invoice: { $in: invoices.map(invoice => invoice._id) } }])).lean();
    return res.json({ success: true, data: buildVendorLedger({ supplier, orders, receipts, invoices, returns, warnings }) });
  } catch (error) {
    console.error('Vendor ledger failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load the complete vendor ledger. Please try again.' });
  }
};
