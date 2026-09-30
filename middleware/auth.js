const jwt = require('jsonwebtoken');
const User = require('../models/User');
const migrateUserAccess = require('../utils/migrateUserAccess');
const { can, canRequest } = require('../utils/accessPolicy');
exports.protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return res.status(401).json({ success: false, message: 'Please sign in.' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    let user = await User.findById(decoded.id).select('-password');
    if (!user || user.status !== 'active' || (decoded.v || 0) !== (user.authVersion || 0)) return res.status(401).json({ success: false, message: 'Your session is no longer active. Please sign in again.' });
    user = await migrateUserAccess(user);
    if (!user || user.status !== 'active' || (decoded.v || 0) !== (user.authVersion || 0)) return res.status(401).json({ success: false, message: 'Your session is no longer active. Please sign in again.' });
    req.user = user;
    if (!canRequest(user, req)) return res.status(403).json({ success: false, message: 'Your administrator has not granted access to this action.' });
    if (!await require('../utils/recordAccess')(req)) return res.status(403).json({ success: false, message: 'This record is not assigned to you. Ask Admin for team record access.' });
    next();
  } catch (error) {
    const status = ['JsonWebTokenError', 'TokenExpiredError', 'CastError'].includes(error.name) ? 401 : 500;
    res.status(status).json({ success: false, message: status === 401 ? 'Please sign in again.' : 'Unable to verify access.' });
  }
};
// Permission-based routes replace fixed role allowlists. User administration
// remains admin-only in the central request policy.
exports.authorize = () => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Please sign in.' });
  if (!canRequest(req.user, req)) return res.status(403).json({ success: false, message: 'Your administrator has not granted access to this action.' });
  next();
};
exports.hasPermission = permission => (req, res, next) => {
  const [module, action = 'view'] = permission.split(':');
  if (!can(req.user, module, action)) return res.status(403).json({ success: false, message: 'Permission required: ' + permission });
  next();
};
