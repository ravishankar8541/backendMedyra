const { can } = require('../utils/accessPolicy');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const { isEmail } = require('validator');
const Invoice = require('../models/Invoice');
const InvoiceShare = require('../models/InvoiceShare');
const { getTransport, emailError } = require('../utils/poEmail');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
async function validate(req) {
  if (!mongoose.isValidObjectId(req.params.id)) fail('Invalid invoice.');
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) fail('Invoice not found.', 404);
  const uid = String(req.user?._id || req.user?.id || '');
  if (!can(req.user, 'invoices', 'all_records') && ![invoice.createdBy, invoice.assignedTo].some(id => String(id || '') === uid)) fail('You cannot share this invoice.', 403);
  if (!req.file?.buffer || req.file.buffer.subarray(0, 5).toString() !== '%PDF-') fail('A valid invoice PDF is required.');
  return { invoice, number: invoice.invoiceNumber };
}
exports.share = async (req, res) => {
  try {
    const { invoice, number } = await validate(req);
    const share = await InvoiceShare.create({ invoice: invoice._id, invoiceNumber: number, pdf: req.file.buffer,
      token: randomBytes(16).toString('base64url'), createdBy: req.user?._id || req.user?.id });
    res.status(201).json({ success: true, token: share.token });
  } catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
};
exports.view = async (req, res) => {
  try {
    if (!/^(?:[A-Za-z0-9_-]{22}|[a-f0-9]{64})$/.test(req.params.token)) fail('Invalid document link.', 404);
    const share = await InvoiceShare.findOne({ token: req.params.token }).select('+pdf');
    if (!share) fail('Invoice document not found.', 404);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${share.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(Buffer.from(share.pdf));
  } catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
};
exports.email = async (req, res) => {
  try {
    const { number } = await validate(req);
    const { to, cc, subject, message } = req.body;
    if (typeof to !== 'string' || !isEmail(to.trim()) || (cc && (typeof cc !== 'string' || !isEmail(cc.trim())))) fail('Enter a valid recipient and optional CC email.');
    if ([subject, message].some(value => value != null && typeof value !== 'string')) fail('Subject and message must be text.');
    const { transporter, user } = getTransport();
    const info = await transporter.sendMail({ from: { name: 'Medyra Pharmaceutical', address: user }, to: to.trim(), cc: cc?.trim() || undefined,
      subject: subject?.trim() || `Invoice ${number} - Medyra Pharmaceutical`, text: message || `Please find attached invoice ${number}.`,
      attachments: [{ filename: `${number.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`, content: req.file.buffer, contentType: 'application/pdf' }] });
    if (!(info.accepted || []).some(a => String(a).toLowerCase() === to.trim().toLowerCase())) fail('Mail server did not accept the recipient. Check delivery before retrying if CC was used.', 502);
    res.json({ success: true, message: 'Mail server accepted the invoice PDF for delivery.', warning: info.rejected?.length ? 'One or more CC recipients were rejected.' : undefined });
  } catch (e) { res.status(e.status || 502).json({ success: false, message: e.status ? e.message : emailError(e, 'invoice') }); }
};
