const User = require('../models/User');
const { validateAccess, normalizeRole } = require('../utils/accessPolicy');
const migrate = require('../utils/migrateUserAccess');
const invalid = message => Object.assign(new Error(message), { status: 400 });
const statuses = ['active', 'inactive', 'pending', 'suspended'];
const clean = user => { const result = user.toObject(); delete result.password; return result; };
const handler = fn => async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: 'Only Admin can manage users.' });
    await fn(req, res);
  } catch (error) {
    res.status(error.status || (error.code === 11000 ? 409 : ['ValidationError', 'CastError'].includes(error.name) ? 400 : 500)).json({ success: false, message: error.code === 11000 ? 'This email is already in use.' : error.message });
  }
};
function fields(body, existing) {
  const updates = {};
  for (const key of ['name', 'email', 'phone', 'department']) if (body[key] !== undefined) {
    if (typeof body[key] !== 'string' || (key !== 'department' && !body[key].trim())) throw invalid(`${key} is required.`);
    updates[key] = body[key].trim();
  }
  if (updates.email) {
    updates.email = updates.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) throw invalid('Enter a valid email address.');
  }
  updates.role = body.role === undefined ? normalizeRole(existing?.role || 'sales') : body.role;
  updates.permissions = validateAccess(updates.role, body.permissions === undefined ? existing?.permissions || [] : body.permissions);
  updates.status = body.status === undefined ? existing?.status || 'active' : body.status;
  if (!statuses.includes(updates.status)) throw invalid('Invalid account status.');
  updates.accessVersion = 1;
  return updates;
}
function protectSelf(req, user, updates) {
  if (String(user._id) === String(req.user._id || req.user.id)) throw invalid('You can only change your own password in User Management.');
}
exports.createUser = handler(async (req, res) => {
  const updates = fields(req.body);
  if (typeof req.body.password !== 'string' || req.body.password.length < 8) throw invalid('Use a password of at least 8 characters.');
  const user = await User.create({ ...updates, password: req.body.password, emailVerified: true, accessUpdatedAt: new Date(), accessUpdatedBy: req.user._id || req.user.id });
  res.status(201).json({ success: true, data: clean(user), user: clean(user) });
});
exports.getUsers = handler(async (req, res) => {
  // Existing role names are upgraded once, preserving explicit legacy module grants.
  const legacy = await User.find({ accessVersion: { $ne: 1 } }).select('-password');
  for (const user of legacy) await migrate(user);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const query = {};
  if (req.query.role && req.query.role !== 'all') query.role = req.query.role;
  if (req.query.status && req.query.status !== 'all') query.status = req.query.status;
  if (req.query.search) {
    const search = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = ['name', 'email', 'phone'].map(key => ({ [key]: { $regex: search, $options: 'i' } }));
  }
  const [users, total] = await Promise.all([User.find(query).select('-password').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit), User.countDocuments(query)]);
  res.json({ success: true, data: users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});
exports.getUser = handler(async (req, res) => {
  const user = await migrate(await User.findById(req.params.id).select('-password'));
  if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
  res.json({ success: true, data: clean(user) });
});
exports.updateUser = handler(async (req, res) => {
  const user = await migrate(await User.findById(req.params.id));
  if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
  const updates = fields(req.body, user);
  if (String(user._id) === String(req.user._id || req.user.id)) {
    const allowed = ['name', 'email', 'phone', 'department'];
    if (Object.keys(req.body).some(key => !allowed.includes(key))) throw invalid('You can edit your profile details only. Use Change Password to change your password.');
    for (const key of allowed) if (updates[key] !== undefined) user[key] = updates[key];
    await user.save();
    return res.json({ success: true, data: clean(user) });
  }
  Object.assign(user, updates, { accessUpdatedAt: new Date(), accessUpdatedBy: req.user._id || req.user.id });
  await user.save();
  res.json({ success: true, data: clean(user) });
});
exports.updateUserStatus = handler(async (req, res) => {
  const user = await migrate(await User.findById(req.params.id));
  if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
  if (!statuses.includes(req.body.status)) throw invalid('Invalid account status.');
  protectSelf(req, user, { role: user.role, status: req.body.status });
  user.status = req.body.status;
  await user.save();
  res.json({ success: true, data: clean(user) });
});
exports.deleteUser = handler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
  if (String(user._id) === String(req.user._id || req.user.id)) throw invalid('You cannot delete your own account.');
  await user.deleteOne();
  res.json({ success: true, message: 'User deleted.' });
});
exports.resetPassword = handler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id || req.user.id)) throw invalid('Use Change Password with your current password to update your own password.');
  const password = req.body.newPassword || req.body.password;
  if (typeof password !== 'string' || password.length < 8) throw invalid('Use a password of at least 8 characters.');
  const user = await migrate(await User.findById(req.params.id));
  if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
  user.password = password;
  await user.save();
  res.json({ success: true, message: 'Password updated. Existing sessions have been revoked.' });
});
