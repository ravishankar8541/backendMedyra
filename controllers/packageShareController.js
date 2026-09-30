const { can } = require('../utils/accessPolicy');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const { isEmail } = require('validator');
const Package = require('../models/Package');
const PackageShare = require('../models/PackageShare');
const mail = require('../utils/poEmail');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const filename = number => `Packing_List_${number.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
async function validate(req) {
  if (!can(req.user, 'packaging', 'share')) fail('You cannot share packing lists.', 403);
  if (!mongoose.isValidObjectId(req.params.id)) fail('Invalid package.');
  const pkg = await Package.findById(req.params.id);
  if (!pkg) fail('Package not found.', 404);
  if (!req.file?.buffer || req.file.buffer.subarray(0, 5).toString() !== '%PDF-') fail('A valid Packing List PDF is required.');
  return pkg;
}
exports.share = async (req, res) => {
  try {
    const pkg = await validate(req);
    const share = await PackageShare.create({ package: pkg._id, orderId: pkg.orderId, pdf: req.file.buffer,
      token: randomBytes(16).toString('base64url'), createdBy: req.user?._id || req.user?.id });
    res.status(201).json({ success: true, token: share.token });
  } catch (error) { res.status(error.status || 500).json({ success: false, message: error.message }); }
};
exports.view = async (req, res) => {
  try {
    if (!/^[A-Za-z0-9_-]{22}$/.test(req.params.token)) fail('Invalid document link.', 404);
    const share = await PackageShare.findOne({ token: req.params.token }).select('+pdf');
    if (!share) fail('Packing List not found.', 404);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename(share.orderId)}"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(Buffer.from(share.pdf));
  } catch (error) { res.status(error.status || 500).json({ success: false, message: error.message }); }
};
exports.email = async (req, res) => {
  try {
    const pkg = await validate(req);
    const { to, subject, message } = req.body;
    if (typeof to !== 'string' || !isEmail(to.trim())) fail('Enter a valid recipient email.');
    if ([subject, message].some(value => value != null && typeof value !== 'string')) fail('Subject and message must be text.');
    if (subject && (subject.length > 200 || /[\r\n]/.test(subject))) fail('Subject must be a single line of up to 200 characters.');
    if (message && message.length > 10000) fail('Message must be up to 10000 characters.');
    const { transporter, user } = mail.getTransport();
    const info = await transporter.sendMail({ from: { name: 'Medyra Pharmaceutical', address: user }, to: to.trim(),
      subject: subject?.trim() || `Packing List ${pkg.orderId} - Medyra Pharmaceutical`,
      text: message || `Please find attached Packing List ${pkg.orderId}.`,
      attachments: [{ filename: filename(pkg.orderId), content: req.file.buffer, contentType: 'application/pdf' }] });
    if (!(info.accepted || []).some(address => String(address).toLowerCase() === to.trim().toLowerCase())) fail('Mail server did not accept the recipient.', 502);
    res.json({ success: true, message: 'Mail server accepted the Packing List PDF for delivery.' });
  } catch (error) { res.status(error.status || 502).json({ success: false, message: error.status ? error.message : mail.emailError(error, 'packing list') }); }
};
