const User = require('../models/User');
const { normalizeRole, normalizePermissions } = require('./accessPolicy');
module.exports = async function migrateUserAccess(user) {
  if (!user || user.accessVersion === 1) return user;
  const updates = { role: normalizeRole(user.role), permissions: user.role === 'admin' ? [] : normalizePermissions(user.permissions || []), accessVersion: 1 };
  const migrated = await User.findOneAndUpdate({ _id: user._id, accessVersion: { $ne: 1 } }, { $set: updates }, { new: true });
  if (migrated) Object.assign(user, updates);
  else return User.findById(user._id).select('-password');
  return user;
};
