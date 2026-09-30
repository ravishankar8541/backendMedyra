const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const invalid = message => Object.assign(new Error(message), { status: 400 });
function date(value, end = false) {
  if (!value) return new Date();
  let text = String(value).trim();
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(text)) {
    const [d, m, y] = text.split(/[/-]/); text = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime()) || (/^\d{4}-\d{2}-\d{2}$/.test(text) && parsed.toISOString().slice(0, 10) !== text)) throw invalid('Enter a valid accounting date.');
  if (end) parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
}
function range(start, end) {
  if (start) date(start);
  if (end) date(end, true);
  if (start && end && date(start) > date(end, true)) throw invalid('Start date must not be after end date.');
}
function amounts(lines) {
  if (!Array.isArray(lines) || lines.length < 2) throw invalid('Add at least two journal lines.');
  let debit = 0, credit = 0;
  const normalized = lines.map(line => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) throw invalid('Each journal line must be an object.');
    const d = Number(line.debit || 0), c = Number(line.credit || 0);
    if (![d, c].every(Number.isFinite) || d < 0 || c < 0 || (d > 0) === (c > 0)) throw invalid('Each line must have one positive debit or credit, never both.');
    if (Math.abs(d * 100 - Math.round(d * 100)) > 0.00001 || Math.abs(c * 100 - Math.round(c * 100)) > 0.00001) throw invalid('Amounts must have at most two decimal places.');
    debit += Math.round(d * 100); credit += Math.round(c * 100);
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) throw invalid('Journal amounts exceed the supported range.');
    return { ...line, debit: round(d), credit: round(c) };
  });
  if (debit !== credit || debit <= 0) throw invalid('Debits must equal credits exactly.');
  return { lines: normalized, totalDebit: debit / 100, totalCredit: credit / 100 };
}
function balances(entries) {
  const map = new Map();
  for (const entry of entries) for (const line of entry.lines || []) {
    const acc = line.account;
    if (!acc?.type) throw new Error('A journal account is missing. Restore the account before generating reports.');
    const key = String(acc._id);
    const row = map.get(key) || { ...acc.toObject?.() || acc, balance: 0 };
    row.balance = round(row.balance + Number(line.debit || 0) - Number(line.credit || 0)); map.set(key, row);
  }
  return [...map.values()];
}
function pnl(entries) {
  const rows = balances(entries);
  const revenue = { domesticSales: 0, exportSales: 0, freightIncome: 0, insuranceIncome: 0, otherIncome: 0, totalRevenue: 0 };
  const expenses = { salesIncentives: 0, manualOperatingExpenses: 0, totalExpenses: 0 };
  let totalCOGS = 0;
  for (const row of rows) {
    if (row.type === 'revenue') {
      const field = { 4000: 'domesticSales', 4010: 'exportSales', 4020: 'freightIncome', 4030: 'insuranceIncome' }[row.code] || 'otherIncome';
      revenue[field] -= row.balance; revenue.totalRevenue -= row.balance;
    } else if (row.type === 'expense') {
      if (row.subType === 'cost_of_goods_sold') totalCOGS += row.balance;
      else { expenses[row.code === '5040' ? 'salesIncentives' : 'manualOperatingExpenses'] += row.balance; expenses.totalExpenses += row.balance; }
    }
  }
  for (const obj of [revenue, expenses]) for (const key in obj) obj[key] = round(obj[key]);
  const grossProfit = round(revenue.totalRevenue - totalCOGS), netProfit = round(grossProfit - expenses.totalExpenses);
  return { revenue, expenses, cogs: { directMaterials: round(totalCOGS), totalCOGS: round(totalCOGS) }, grossProfit, netProfit, grossMargin: revenue.totalRevenue ? (grossProfit / revenue.totalRevenue * 100).toFixed(2) : '0.00', netMargin: revenue.totalRevenue ? (netProfit / revenue.totalRevenue * 100).toFixed(2) : '0.00' };
}
function balanceSheet(entries) {
  const currentAssets = { cashAndBank: 0, accountsReceivable: 0, inventory: 0, supplierCredits: 0, otherCurrentAssets: 0, totalCurrent: 0 };
  const fixedAssets = { equipmentAndVehicles: 0, totalFixed: 0 };
  const currentLiabilities = { accountsPayable: 0, taxPayable: 0, customerCredits: 0, otherLiabilities: 0, totalCurrent: 0 };
  const equity = { capital: 0, retainedEarnings: 0, totalEquity: 0 };
  let longTermLiabilities = 0;
  for (const row of balances(entries)) {
    const value = row.balance;
    if (row.type === 'asset') {
      if (row.subType === 'fixed_asset') fixedAssets.equipmentAndVehicles += value;
      else currentAssets[{ bank: 'cashAndBank', cash: 'cashAndBank', accounts_receivable: 'accountsReceivable', inventory: 'inventory' }[row.subType] || 'otherCurrentAssets'] += value;
    } else if (row.type === 'liability') {
      if (row.subType === 'long_term_liability') longTermLiabilities -= value;
      else currentLiabilities[row.code === '2020' ? 'customerCredits' : ({ accounts_payable: 'accountsPayable', tax_payable: 'taxPayable' }[row.subType] || 'otherLiabilities')] -= value;
    }
    else if (row.type === 'equity') equity[row.subType === 'retained_earnings' ? 'retainedEarnings' : 'capital'] -= value;
    else if (['revenue', 'expense'].includes(row.type)) equity.retainedEarnings -= value;
  }
  currentAssets.totalCurrent = round(Object.values(currentAssets).reduce((a,b) => a+b,0));
  fixedAssets.totalFixed = round(fixedAssets.equipmentAndVehicles);
  currentLiabilities.totalCurrent = round(Object.values(currentLiabilities).reduce((a,b) => a+b,0));
  equity.totalEquity = round(equity.capital + equity.retainedEarnings);
  for (const obj of [currentAssets, fixedAssets, currentLiabilities, equity]) for (const key in obj) obj[key] = round(obj[key]);
  longTermLiabilities = round(longTermLiabilities);
  const totalAssets = round(currentAssets.totalCurrent + fixedAssets.totalFixed), totalLiabilities = round(currentLiabilities.totalCurrent + longTermLiabilities);
  const difference = round(totalAssets - totalLiabilities - equity.totalEquity);
  return { assets: { currentAssets, fixedAssets, totalAssets }, liabilities: { currentLiabilities, longTermLiabilities, totalLiabilities }, equity, difference, isBalanced: difference === 0 };
}
function classification(type, subType) {
  const allowed = {
    asset: ['current_asset', 'bank', 'cash', 'accounts_receivable', 'inventory', 'fixed_asset'],
    liability: ['current_liability', 'accounts_payable', 'tax_payable', 'long_term_liability'],
    equity: ['equity', 'retained_earnings'],
    revenue: ['operating_revenue', 'other_income'],
    expense: ['cost_of_goods_sold', 'operating_expense', 'tax_expense', 'financial_expense']
  };
  if (!allowed[type]?.includes(subType)) throw invalid('Account subtype must belong to the selected account type.');
}
function exchangeRate(document) {
  if (!document.currency || document.currency === 'INR') return 1;
  const rate = Number(document.exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) throw invalid(`A positive INR exchange rate is required for ${document.currency}.`);
  return rate;
}
function inRupees(entry, source = entry) {
  amounts((entry.lines || []).filter(l => l.debit || l.credit).map(l => ({ ...l.toObject?.() || l, debit: round(l.debit || 0), credit: round(l.credit || 0) })));
  const rate = exchangeRate(source);
  const result = entry.toObject ? entry.toObject() : { ...entry };
  result.lines = (entry.lines || []).map(line => ({ ...(line.toObject ? line.toObject() : line), debit: round(Number(line.debit || 0) * rate), credit: round(Number(line.credit || 0) * rate) })).filter(l => l.debit || l.credit);
  // Allocate conversion rounding to the final line on each side so both
  // sides reconcile to the converted voucher total.
  const total = round(Number(entry.totalDebit) * rate);
  for (const side of ['debit', 'credit']) {
    const lines = result.lines.filter(l => l[side] > 0);
    if (lines.length) lines[lines.length - 1][side] = round(lines[lines.length - 1][side] + total - result.lines.reduce((sum, l) => sum + l[side], 0));
  }
  Object.assign(result, amounts(result.lines), { currency: 'INR' });
  return result;
}
module.exports = { round, invalid, date, range, amounts, balances, pnl, balanceSheet, classification, exchangeRate, inRupees };
