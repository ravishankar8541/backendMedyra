const { randomBytes } = require('node:crypto');
const PurchaseInvoiceShare = require('../models/PurchaseInvoiceShare');

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

exports.create = async (req, res) => {
  try {
    const invoiceNumber = typeof req.body?.invoiceNumber === 'string' ? req.body.invoiceNumber.trim() : '';
    if (!invoiceNumber) fail('Purchase invoice number is required.');
    if (!req.file?.buffer || req.file.buffer.subarray(0, 5).toString() !== '%PDF-') {
      fail('Attach a valid purchase invoice PDF.');
    }

    const share = await PurchaseInvoiceShare.create({
      invoiceNumber,
      pdf: req.file.buffer,
      token: randomBytes(16).toString('base64url'),
      createdBy: req.user?._id || req.user?.id
    });
    return res.status(201).json({ success: true, token: share.token });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to create purchase invoice link.' });
  }
};

exports.view = async (req, res) => {
  try {
    const { token } = req.params;
    if (!/^[A-Za-z0-9_-]{22}$/.test(token || '')) fail('Invalid document link.', 404);
    const share = await PurchaseInvoiceShare.findOne({ token }).select('+pdf');
    if (!share) fail('Purchase invoice document not found.', 404);

    const filename = String(share.invoiceNumber || 'purchase-invoice').replace(/[^A-Za-z0-9_.-]/g, '_');
    return res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}.pdf"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }).send(Buffer.from(share.pdf));
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to load purchase invoice document.' });
  }
};
