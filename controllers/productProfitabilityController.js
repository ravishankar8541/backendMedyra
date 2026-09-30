const Invoice = require('../models/Invoice');
const { ConsolidatedInvoice } = require('../models/GoodsReceipt');
const SalesReturn = require('../models/SalesReturn');
const { productProfitability } = require('../utils/productProfitability');
exports.getProductProfitability = async (req, res) => {
  try {
    const [invoices, purchases, returns] = await Promise.all([
      Invoice.find({ status: { $nin: ['draft', 'cancelled'] } }).select('invoiceNumber date customer currency exchangeRate items').lean(),
      ConsolidatedInvoice.find({}).select('invoiceNumber invoiceDate supplierName currency exchangeRate items').lean(),
      SalesReturn.find({ status: 'posted' }).select('invoice returnNumber returnDate items replacementHistory').lean()
    ]);
    res.json({ success: true, data: productProfitability(invoices, purchases, returns, req.query) });
  } catch (error) { res.status(error.status || 500).json({ success: false, message: error.message }); }
};
