const ROLES = ['sales', 'accountant', 'admin'];
const ACTIONS = ['view', 'create', 'edit', 'delete', 'share'];
const MODULES = ['sales', 'invoices', 'accounting', 'inventory', 'purchase', 'packaging', 'delivery', 'multi_currency', 'reports'];
const aliases = { telecaller: 'sales', payment: 'invoices' };
const normalizeRole = role => ['manager', 'telecaller', 'staff', 'delivery_agent'].includes(role) ? 'sales' : role;
const validPermissions = new Set([...MODULES.flatMap(m => ACTIONS.map(a => `${m}:${a}`)), 'sales:all_records', 'invoices:all_records']);
function normalizePermissions(permissions = []) {
  return [...new Set(permissions.flatMap(p => {
    const module = aliases[p] || p;
    if (MODULES.includes(module)) return ACTIONS.map(action => `${module}:${action}`);
    return validPermissions.has(p) ? [p] : [];
  }))];
}
function validateAccess(role, permissions) {
  if (!ROLES.includes(role)) throw Object.assign(new Error('Choose Sales, Accountant or Admin.'), { status: 400 });
  if (!Array.isArray(permissions) || permissions.some(p => typeof p !== 'string' || !validPermissions.has(p))) throw Object.assign(new Error('Invalid user permissions.'), { status: 400 });
  const result = [...new Set(permissions)];
  for (const p of result) if (!p.endsWith(':view') && !result.includes(p.split(':')[0] + ':view')) throw Object.assign(new Error('Enable View before granting other actions in a module.'), { status: 400 });
  return role === 'admin' ? [] : result;
}
function can(user, module, action = 'view') {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return normalizePermissions(user.permissions || []).includes(`${aliases[module] || module}:${action}`);
}
function apiPermission(req) {
  const path = (req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`).split('?')[0].replace(/^\/api(?=\/)/, '');
  const section = path.split('/')[1];
  if (section === 'auth') return path === '/auth/register' ? ['admin', 'create'] : ['session', 'view'];
  if (section === 'users' || path === '/reports/users') return ['admin', 'view'];
  const module = {
    leads: 'sales', followups: 'sales', telecaller: 'sales', revenue: 'sales', quotations: 'sales', 'client-price-lists': 'sales',
    invoices: 'invoices', 'sales-returns': 'invoices', orders: 'invoices', accounting: 'accounting',
    products: 'inventory', inventory: 'inventory', units: 'inventory', categories: 'inventory', subcategories: 'inventory',
    suppliers: 'purchase', 'purchase-orders': 'purchase', 'goods-receipts': 'purchase', 'purchase-returns': 'purchase', 'vendor-price-lists': 'purchase',
    packages: 'packaging', deliveries: 'delivery', currency: 'multi_currency', reports: 'reports', dashboard: 'sales', uploads: 'uploads'
  }[section];
  if (!module) return ['unknown', 'view'];
  let action = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? 'view' : req.method === 'DELETE' ? 'delete' : req.method === 'POST' ? 'create' : 'edit';
  if (action !== 'view') {
    if (/\/(?:[^/]*(?:email|share)|send-email)$/.test(path)) action = 'share';
    else if (/\/(?:cancel|void)$/.test(path)) action = 'delete';
    else if (/\/(?:payment|payments|status|sync|sync-packages|sync-journals|refresh|replacement|revise|assign|handover|proof|movement|batch)$/.test(path)) action = 'edit';
  }
  if (path === '/currency/convert') action = 'view';
  if (/\/convert-invoice$/.test(path)) return ['invoices', 'create'];
  return [module, action];
}
function canRequest(user, req) {
  if ((req.originalUrl || '').split('?')[0].endsWith('/convert-invoice') && !can(user, 'sales', 'view')) return false;
  const [module, action] = apiPermission(req);
  if (module === 'session') return true;
  if (module === 'admin' || module === 'unknown') return user?.role === 'admin';
  if (module === 'uploads') return user?.role === 'admin' || (req.method !== 'DELETE' && MODULES.some(m => can(user, m, 'create') || can(user, m, 'edit') || can(user, m, 'share')));
  return can(user, module, 'view') && can(user, module, action);
}
module.exports = { ROLES, ACTIONS, MODULES, normalizeRole, normalizePermissions, validateAccess, can, apiPermission, canRequest };
