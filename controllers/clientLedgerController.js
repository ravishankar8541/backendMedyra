const { can } = require('../utils/accessPolicy');
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Invoice = require('../models/Invoice');
const SalesReturn = require('../models/SalesReturn');
const { buildClientLedger } = require('../utils/clientLedger');
exports.getClientLedger = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid client ID.' });
  try {
    const client = await Lead.findById(req.params.id).lean();
    if (!client) return res.status(404).json({ success: false, message: 'Client not found.' });
    const userId = String(req.user?._id || req.user?.id || '');
    if (!can(req.user, 'sales', 'all_records') && (!userId || ![client.assignedTo, client.createdBy].some(value => String(value?._id || value || '') === userId))) {
      return res.status(403).json({ success: false, message: 'You can only view ledgers for your assigned or created clients.' });
    }
    // Explicit client identity only: names/emails can be shared by unrelated accounts.
    const invoices = await Invoice.find({ leadId: client._id }).lean();
    const returns = await SalesReturn.find({ invoice: { $in: invoices.map(invoice => invoice._id) } }).lean();
    return res.json({ success: true, data: buildClientLedger({ client, invoices, returns }) });
  } catch (error) {
    console.error('Client ledger failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load the complete client ledger. Please retry.' });
  }
};
