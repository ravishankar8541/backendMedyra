const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const mail = require('../utils/poEmail');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const generic = 'If an active Admin account exists for this email, a reset code will arrive shortly. Check your spam folder too.';
const attempts = new Map();
exports.limit = (req, res, next) => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
  const key = req.ip;
  const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  if (++entry.count > 20 || attempts.size >= 10000) return res.status(429).json({ message: 'Too many recovery attempts. Please try again in 15 minutes.' });
  attempts.set(key, entry); next();
};
exports.forgot = async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid registered email.' });
    const { transporter, user: sender } = mail.getTransport();
    const token = crypto.randomBytes(24).toString('hex');
    const digest = hash(token);
    const user = await User.findOneAndUpdate({ email, role: 'admin', status: 'active', $or: [{ passwordResetRequestedAt: { $exists: false } }, { passwordResetRequestedAt: { $lt: new Date(Date.now() - 60000) } }] },
      { $set: { passwordResetHash: digest, passwordResetExpires: new Date(Date.now() + 15 * 60000), passwordResetRequestedAt: new Date() } }, { new: true });
    if (user) {
      try {
        const result = await transporter.sendMail({ from: { name: 'Medyra Account Security', address: sender }, to: user.email, subject: 'Reset your Medyra password',
          text: `A password reset was requested for your Medyra account.\n\nYour reset code:\n${token}\n\nOn the Medyra login page, open Forgot Password and paste this code to choose a new password. This code expires in 15 minutes and can be used only once.\n\nIf you did not request this, ignore this email. Never share this code.` });
        if (!result.accepted?.some(address => String(address).toLowerCase() === email)) throw new Error('Mail not accepted');
      } catch {
        await User.updateOne({ _id: user._id, passwordResetHash: digest }, { $unset: { passwordResetHash: 1, passwordResetExpires: 1 } });
        return res.status(503).json({ message: 'Recovery email could not be sent. Please try again later or ask the system owner to check email settings.' });
      }
    }
    res.json({ success: true, message: generic });
  } catch { res.status(503).json({ message: 'Password recovery is unavailable. Please check the server email configuration and try again.' }); }
};
exports.reset = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token.trim())) return res.status(400).json({ message: 'Invalid or expired reset code. Request a new code.' });
    if (typeof newPassword !== 'string' || newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > 72) return res.status(400).json({ message: 'Use at least 8 characters and no more than 72 bytes for the password.' });
    const digest = hash(token.trim());
    const query = { passwordResetHash: digest, passwordResetExpires: { $gt: new Date() }, status: 'active', role: 'admin' };
    if (!await User.exists(query)) return res.status(400).json({ message: 'Invalid or expired reset code. Request a new code.' });
    const password = await bcrypt.hash(newPassword, 12);
    const result = await User.updateOne(query, { $set: { password, passwordChangedAt: new Date(), forcePasswordChange: false }, $inc: { authVersion: 1 }, $unset: { passwordResetHash: 1, passwordResetExpires: 1 } });
    if (!result.modifiedCount) return res.status(400).json({ message: 'Invalid or expired reset code. Request a new code.' });
    res.json({ success: true, message: 'Password reset successfully. Sign in with your new password.' });
  } catch { res.status(500).json({ message: 'Unable to reset password. Please try again.' }); }
};
