const mongoose = require('mongoose');
const { can } = require('./accessPolicy');
const owns = (user, row) => [row?.createdBy, row?.assignedTo].some(id => id && String(id._id || id) === String(user._id || user.id));
module.exports = async function recordAccess(req) {
  const path = (req.originalUrl || '').split('?')[0].replace(/^\/api/, '');
  const parts = path.split('/').filter(Boolean);
  let module, model, id;
  if (parts[0] === 'leads') { module = 'sales'; model = require('../models/Lead'); id = parts[1]; }
  if (parts[0] === 'invoices') { module = 'invoices'; model = require('../models/Invoice'); id = parts[1]; }
  if (module && id && mongoose.isValidObjectId(id) && !can(req.user, module, 'all_records')) {
    const row = await model.findById(id).select('createdBy assignedTo');
    if (row && !owns(req.user, row)) return false;
  }
  if (parts[0] === 'sales-returns' && !can(req.user, 'invoices', 'all_records')) {
    let invoiceId = parts[1] === 'source' ? parts[2] : req.body?.invoiceId;
    if (mongoose.isValidObjectId(parts[1])) invoiceId = (await require('../models/SalesReturn').findById(parts[1]).select('invoice'))?.invoice;
    if (invoiceId && mongoose.isValidObjectId(invoiceId)) {
      const invoice = await require('../models/Invoice').findById(invoiceId).select('createdBy assignedTo');
      if (invoice && !owns(req.user, invoice)) return false;
    }
  }
  return true;
};
