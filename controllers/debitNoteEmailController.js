const mongoose = require('mongoose');
const { isEmail } = require('validator');
const PurchaseReturn = require('../models/PurchaseReturn');
const { getTransport, emailError } = require('../utils/poEmail');

exports.sendDebitNoteEmail = async (req, res) => {
  let data;
  try {
    data = req.body?.emailData;
    if (typeof data === 'string') data = JSON.parse(data);
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid email data.' });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ success: false, error: 'Email data is required.' });
  }
  const { to, cc, subject, body } = data;
  if (typeof to !== 'string' || !isEmail(to.trim()) ||
      (cc && (typeof cc !== 'string' || !isEmail(cc.trim()))) ||
      [subject, body].some(value => value != null && typeof value !== 'string')) {
    return res.status(400).json({ success: false, error: 'Enter a valid recipient and optional CC email address, with text email fields.' });
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, error: 'Invalid debit note ID.' });
  }
  if (!req.file?.buffer || req.file.buffer.subarray(0, 5).toString() !== '%PDF-') {
    return res.status(400).json({ success: false, error: 'A valid debit note PDF attachment is required.' });
  }
  try {
    const note = await PurchaseReturn.findById(req.params.id);
    if (!note) return res.status(404).json({ success: false, error: 'Debit note not found.' });
    if (note.status !== 'completed') return res.status(409).json({ success: false, error: 'Only posted debit notes can be emailed.' });
    const number = String(note.returnNumber || '').replace(/^PR-/i, 'DN-');
    const { transporter, user } = getTransport();
    const text = body || `Please find attached Debit Note ${number}.\n\nMedyra Pharmaceutical`;
    const escaped = text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const info = await transporter.sendMail({
      from: { name: 'Medyra Pharmaceutical', address: user },
      to: to.trim(), cc: cc?.trim() || undefined,
      subject: subject?.trim() || `Debit Note ${number} - Medyra Pharmaceutical`,
      text, html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escaped}</div>`,
      attachments: [{ filename: number.replace(/[^a-zA-Z0-9_.-]/g, '_') + '.pdf', content: req.file.buffer, contentType: 'application/pdf' }]
    });
    if (!(info.accepted || []).some(address => String(address).toLowerCase() === to.trim().toLowerCase())) {
      return res.status(502).json({ success: false, error: 'The mail server did not accept the vendor address. A CC recipient may have received the message; check before resending.' });
    }
    return res.json({ success: true, message: 'Mail server accepted the debit note for delivery.', messageId: info.messageId,
      warning: info.rejected?.length ? 'The vendor email was accepted, but the CC recipient was rejected.' : undefined });
  } catch (error) {
    console.error('Debit note email failed:', { code: error.code, responseCode: error.responseCode });
    return res.status(error.code === 'EMAIL_CONFIG' ? 503 : 502).json({ success: false, error: emailError(error, 'debit note') });
  }
};
