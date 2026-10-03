const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const PurchaseReturn = require('../models/PurchaseReturn');
const PurchaseReturnShare = require('../models/PurchaseReturnShare');

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

exports.share = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) fail('Invalid debit note ID.');
    const note = await PurchaseReturn.findById(req.params.id);
    if (!note) fail('Debit note not found.', 404);
    if (note.status !== 'completed') fail('Only posted debit notes can be shared.', 409);
    if (!req.file?.buffer || req.file.buffer.subarray(0, 5).toString() !== '%PDF-') fail('A valid debit note PDF is required.');

    const debitNoteNumber = String(note.returnNumber || '').replace(/^PR-/i, 'DN-');
    const share = await PurchaseReturnShare.create({
      purchaseReturn: note._id,
      debitNoteNumber,
      pdf: req.file.buffer,
      token: randomBytes(16).toString('base64url'),
      createdBy: req.user?._id || req.user?.id
    });
    res.status(201).json({ success: true, token: share.token });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Could not prepare debit note sharing.' });
  }
};

exports.view = async (req, res) => {
  try {
    if (!/^[A-Za-z0-9_-]{22}$/.test(req.params.token)) fail('Invalid debit note link.', 404);
    const share = await PurchaseReturnShare.findOne({ token: req.params.token }).select('+pdf');
    if (!share) fail('Debit note document not found.', 404);
    const filename = share.debitNoteNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}.pdf"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }).send(Buffer.from(share.pdf));
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Could not open debit note.' });
  }
};
