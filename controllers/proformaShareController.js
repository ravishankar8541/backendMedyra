const { can } = require('../utils/accessPolicy');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const { isEmail } = require('validator');
const Lead = require('../models/Lead');
const ProformaShare = require('../models/ProformaShare');
const { getTransport, emailError } = require('../utils/poEmail');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
async function validate(req) {
  if (!mongoose.isValidObjectId(req.params.id)) fail('Invalid client.');
  const lead = await Lead.findById(req.params.id);
  if (!lead) fail('Client not found.', 404);
  const uid = String(req.user?._id || req.user?.id || '');
  if (!can(req.user, 'sales', 'all_records') && ![lead.createdBy, lead.assignedTo].some(id => String(id || '') === uid)) fail('You cannot share this client’s proforma.', 403);
  const number = req.body.proformaNumber;
  if (typeof number !== 'string' || ![...(lead.proformas || []), lead.proforma].filter(Boolean).some(p => p.number === number)) fail('Proforma not found for this client.', 404);
  if (!req.file?.buffer || req.file.buffer.subarray(0, 5).toString() !== '%PDF-') fail('A valid proforma PDF is required.');
  return { lead, number };
}
exports.share = async (req, res) => {
  try {
    const { lead, number } = await validate(req);
    const share = await ProformaShare.create({ lead: lead._id, proformaNumber: number, pdf: req.file.buffer,
      token: randomBytes(16).toString('base64url'), createdBy: req.user?._id || req.user?.id });
    res.status(201).json({ success: true, token: share.token });
  } catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
};
exports.view = async (req, res) => {
  try {
    if (!/^(?:[A-Za-z0-9_-]{22}|[a-f0-9]{64})$/.test(req.params.token)) fail('Invalid document link.', 404);
    const share = await ProformaShare.findOne({ token: req.params.token }).select('+pdf');
    if (!share) fail('Proforma document not found.', 404);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${share.proformaNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf"`,
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
      subject: subject?.trim() || `Proforma ${number} - Medyra Pharmaceutical`, text: message || `Please find attached proforma ${number}.`,
      attachments: [{ filename: `${number.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`, content: req.file.buffer, contentType: 'application/pdf' }] });
    if (!(info.accepted || []).some(a => String(a).toLowerCase() === to.trim().toLowerCase())) fail('Mail server did not accept the recipient. Check delivery before retrying if CC was used.', 502);
    res.json({ success: true, message: 'Mail server accepted the proforma PDF for delivery.', warning: info.rejected?.length ? 'One or more CC recipients were rejected.' : undefined });
  } catch (e) { res.status(e.status || 502).json({ success: false, message: e.status ? e.message : emailError(e, 'proforma') }); }
};
