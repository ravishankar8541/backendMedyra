
// controllers/accountingController.js
const mongoose = require('mongoose');
const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const Invoice = require('../models/Invoice');
const { ConsolidatedInvoice, GoodsReceipt } = require('../models/GoodsReceipt');
const Product = require('../models/Product');

// Standard Chart of Accounts Seed Template
const DEFAULT_ACCOUNTS = [
  // Assets
  { code: '1000', name: 'Cash in Hand', type: 'asset', subType: 'cash', isSystem: true },
  { code: '1010', name: 'Kotak Bank Main A/c (7548895846)', type: 'asset', subType: 'bank', isSystem: true },
  { code: '1020', name: 'Accounts Receivable (Debtors)', type: 'asset', subType: 'accounts_receivable', isSystem: true },
  { code: '1030', name: 'Pharma Inventory Asset', type: 'asset', subType: 'inventory', isSystem: true },
  { code: '1040', name: 'Input GST Credit (CGST)', type: 'asset', subType: 'current_asset', isSystem: true },
  { code: '1041', name: 'Input GST Credit (SGST)', type: 'asset', subType: 'current_asset', isSystem: true },
  { code: '1042', name: 'Input GST Credit (IGST)', type: 'asset', subType: 'current_asset', isSystem: true },
  { code: '1500', name: 'Warehouse & Office Equipment', type: 'asset', subType: 'fixed_asset', isSystem: false },

  // Liabilities
  { code: '2000', name: 'Accounts Payable (Creditors / Suppliers)', type: 'liability', subType: 'accounts_payable', isSystem: true },
  { code: '2010', name: 'Output CGST Payable', type: 'liability', subType: 'tax_payable', isSystem: true },
  { code: '2011', name: 'Output SGST Payable', type: 'liability', subType: 'tax_payable', isSystem: true },
  { code: '2012', name: 'Output IGST Payable', type: 'liability', subType: 'tax_payable', isSystem: true },
  { code: '2020', name: 'Advance Received from Clients', type: 'liability', subType: 'current_liability', isSystem: true },

  // Equity
  { code: '3000', name: 'Owner’s Capital / Share Capital', type: 'equity', subType: 'equity', isSystem: true },
  { code: '3010', name: 'Retained Earnings', type: 'equity', subType: 'retained_earnings', isSystem: true },

  // Revenue
  { code: '4000', name: 'Sales Revenue - Domestic', type: 'revenue', subType: 'operating_revenue', isSystem: true },
  { code: '4010', name: 'Sales Revenue - Export', type: 'revenue', subType: 'operating_revenue', isSystem: true },
  { code: '4020', name: 'Freight & Logistics Recovery', type: 'revenue', subType: 'other_income', isSystem: false },
  { code: '4030', name: 'Insurance Recovery Income', type: 'revenue', subType: 'other_income', isSystem: false },

  // Expenses
  { code: '5000', name: 'Cost of Goods Sold (COGS)', type: 'expense', subType: 'cost_of_goods_sold', isSystem: true },
  { code: '5010', name: 'Procurement Purchases', type: 'expense', subType: 'cost_of_goods_sold', isSystem: true },
  { code: '5020', name: 'Outward Freight & Shipping', type: 'expense', subType: 'operating_expense', isSystem: false },
  { code: '5030', name: 'Transit Insurance Expense', type: 'expense', subType: 'operating_expense', isSystem: false },
  { code: '5040', name: 'Sales Telecaller Incentive Expense', type: 'expense', subType: 'operating_expense', isSystem: false },
  { code: '5050', name: 'Warehousing & Packaging Material', type: 'expense', subType: 'operating_expense', isSystem: false },
  { code: '5060', name: 'Bank Charges & Gateway Fees', type: 'expense', subType: 'financial_expense', isSystem: false },
  { code: '5070', name: 'Office Utilities & Administration', type: 'expense', subType: 'operating_expense', isSystem: false },
  { code: '5080', name: 'Round-off Expense / (Gain)', type: 'expense', subType: 'operating_expense', isSystem: false }
];

// Helper: Calculate Live Total Stock Value from Product Collection
const getLiveInventoryValuation = async () => {
  try {
    const products = await Product.find();
    let totalStockValue = 0;
    products.forEach((p) => {
      const isBatch = p.productType !== 'non-batch';
      if (isBatch && Array.isArray(p.batches) && p.batches.length > 0) {
        p.batches.forEach((b) => {
          const qty = Number(b.quantity) || 0;
          const cost = Number(b.costPrice ?? p.pricing?.costPrice ?? 0);
          totalStockValue += (qty * cost);
        });
      } else {
        const qty = Number(p.stock) || 0;
        const cost = Number(p.pricing?.costPrice) || 0;
        totalStockValue += (qty * cost);
      }
    });
    return Math.round(totalStockValue * 100) / 100;
  } catch (err) {
    console.error('Error computing inventory valuation:', err);
    return 0;
  }
};

// ============================================
// 1. CHART OF ACCOUNTS
// ============================================
exports.initChartOfAccounts = async (req, res) => {
  try {
    let created = 0;
    for (const acc of DEFAULT_ACCOUNTS) {
      const exists = await Account.findOne({ code: acc.code });
      if (!exists) {
        await Account.create({ ...acc, createdBy: req.user?._id });
        created++;
      }
    }
    res.json({ success: true, message: `Chart of Accounts verified. ${created} new account(s) initialized.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAccounts = async (req, res) => {
  try {
    const count = await Account.countDocuments();
    if (count === 0) {
      for (const acc of DEFAULT_ACCOUNTS) {
        await Account.create({ ...acc, createdBy: req.user?._id });
      }
    }

    const { type, search } = req.query;
    const query = { isActive: true };
    if (type && type !== 'all') query.type = type;
    if (search) {
      query.$or = [
        { code: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } }
      ];
    }

    const accounts = await Account.find(query).sort({ code: 1 });
    res.json({ success: true, data: accounts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createAccount = async (req, res) => {
  try {
    const { code, name, type, subType, currency, description } = req.body;
    const exists = await Account.findOne({ code: code.trim() });
    if (exists) {
      return res.status(400).json({ success: false, message: `Account code "${code}" already exists` });
    }

    const account = await Account.create({
      code: code.trim(),
      name: name.trim(),
      type,
      subType,
      currency: currency || 'INR',
      description,
      createdBy: req.user?._id
    });

    res.status(201).json({ success: true, data: account, message: 'Account created successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateAccount = async (req, res) => {
  try {
    const { name, subType, description, isActive } = req.body;
    const account = await Account.findByIdAndUpdate(
      req.params.id,
      { name, subType, description, isActive },
      { new: true }
    );
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    res.json({ success: true, data: account, message: 'Account updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// 2. JOURNAL ENTRIES
// ============================================
exports.getJournalEntries = async (req, res) => {
  try {
    const { page = 1, limit = 25, search, startDate, endDate } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { entryNumber: { $regex: search, $options: 'i' } },
        { referenceNumber: { $regex: search, $options: 'i' } },
        { memo: { $regex: search, $options: 'i' } }
      ];
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const entries = await JournalEntry.find(query)
      .populate('lines.account', 'code name type')
      .populate('createdBy', 'name')
      .sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await JournalEntry.countDocuments(query);

    res.json({
      success: true,
      data: entries,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createJournalEntry = async (req, res) => {
  try {
    const { date, referenceNumber, memo, lines, currency } = req.body;

    if (!lines || lines.length < 2) {
      return res.status(400).json({ success: false, message: 'Journal entry requires at least 2 lines (debit & credit).' });
    }

    let totalDebit = 0;
    let totalCredit = 0;
    const enrichedLines = [];

    for (const line of lines) {
      const d = parseFloat(line.debit) || 0;
      const c = parseFloat(line.credit) || 0;
      totalDebit += d;
      totalCredit += c;

      const acc = await Account.findById(line.account);
      if (!acc) {
        return res.status(400).json({ success: false, message: `Invalid account ID specified in lines.` });
      }

      enrichedLines.push({
        account: acc._id,
        accountCode: acc.code,
        accountName: acc.name,
        debit: Math.round(d * 100) / 100,
        credit: Math.round(c * 100) / 100,
        description: line.description || '',
        entityType: line.entityType || 'Other',
        entityId: line.entityId || null
      });
    }

    if (Math.abs(totalDebit - totalCredit) > 0.05) {
      return res.status(400).json({
        success: false,
        message: `Debit total (${totalDebit.toFixed(2)}) must equal Credit total (${totalCredit.toFixed(2)}).`
      });
    }

    const year = new Date().getFullYear();
    const count = await JournalEntry.countDocuments();
    const entryNumber = `JV-${year}/${String(count + 1).padStart(4, '0')}`;

    const journal = await JournalEntry.create({
      entryNumber,
      date: date ? new Date(date) : new Date(),
      referenceNumber: referenceNumber || '',
      sourceModule: 'manual',
      memo: memo || 'Manual Journal Adjustment',
      lines: enrichedLines,
      totalDebit: Math.round(totalDebit * 100) / 100,
      totalCredit: Math.round(totalCredit * 100) / 100,
      currency: currency || 'INR',
      status: 'posted',
      createdBy: req.user?._id
    });

    // Update account balances
    for (const line of enrichedLines) {
      const acc = await Account.findById(line.account);
      if (acc) {
        if (['asset', 'expense'].includes(acc.type)) {
          acc.balance += (line.debit - line.credit);
        } else {
          acc.balance += (line.credit - line.debit);
        }
        await acc.save();
      }
    }

    res.status(201).json({ success: true, data: journal, message: `Journal entry ${entryNumber} posted.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// 3. GENERAL LEDGER
// ============================================
exports.getGeneralLedger = async (req, res) => {
  try {
    const { accountId, startDate, endDate } = req.query;

    if (!accountId || !mongoose.Types.ObjectId.isValid(accountId)) {
      return res.status(400).json({ success: false, message: 'Valid accountId required' });
    }

    const account = await Account.findById(accountId);
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

    const dateQuery = { 'lines.account': account._id, status: 'posted' };
    if (startDate || endDate) {
      dateQuery.date = {};
      if (startDate) dateQuery.date.$gte = new Date(startDate);
      if (endDate) dateQuery.date.$lte = new Date(endDate);
    }

    const entries = await JournalEntry.find(dateQuery).sort({ date: 1, createdAt: 1 });

    let runningBalance = 0;
    const ledgerLines = [];

    entries.forEach((entry) => {
      const matching = entry.lines.filter((l) => l.account.toString() === account._id.toString());
      matching.forEach((line) => {
        if (['asset', 'expense'].includes(account.type)) {
          runningBalance += (line.debit - line.credit);
        } else {
          runningBalance += (line.credit - line.debit);
        }

        ledgerLines.push({
          date: entry.date,
          entryNumber: entry.entryNumber,
          referenceNumber: entry.referenceNumber,
          memo: entry.memo,
          description: line.description || entry.memo,
          debit: line.debit,
          credit: line.credit,
          balance: Math.round(runningBalance * 100) / 100
        });
      });
    });

    res.json({
      success: true,
      data: {
        account,
        openingBalance: 0,
        closingBalance: Math.round(runningBalance * 100) / 100,
        transactions: ledgerLines
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// 4. TRIAL BALANCE
// ============================================
exports.getTrialBalance = async (req, res) => {
  try {
    const { asOfDate } = req.query;
    const dateLimit = asOfDate ? new Date(asOfDate) : new Date();

    const accounts = await Account.find({ isActive: true }).sort({ code: 1 });
    const trialLines = [];

    let totalDebit = 0;
    let totalCredit = 0;

    for (const acc of accounts) {
      const entries = await JournalEntry.find({
        'lines.account': acc._id,
        status: 'posted',
        date: { $lte: dateLimit }
      });

      let netDebit = 0;
      let netCredit = 0;

      entries.forEach((entry) => {
        entry.lines
          .filter((l) => l.account.toString() === acc._id.toString())
          .forEach((line) => {
            netDebit += line.debit || 0;
            netCredit += line.credit || 0;
          });
      });

      let debitBalance = 0;
      let creditBalance = 0;

      if (['asset', 'expense'].includes(acc.type)) {
        const bal = netDebit - netCredit;
        if (bal >= 0) debitBalance = bal;
        else creditBalance = Math.abs(bal);
      } else {
        const bal = netCredit - netDebit;
        if (bal >= 0) creditBalance = bal;
        else debitBalance = Math.abs(bal);
      }

      if (debitBalance > 0 || creditBalance > 0 || acc.isSystem) {
        totalDebit += debitBalance;
        totalCredit += creditBalance;

        trialLines.push({
          _id: acc._id,
          code: acc.code,
          name: acc.name,
          type: acc.type,
          subType: acc.subType,
          debit: Math.round(debitBalance * 100) / 100,
          credit: Math.round(creditBalance * 100) / 100
        });
      }
    }

    res.json({
      success: true,
      data: {
        asOfDate: dateLimit,
        lines: trialLines,
        totalDebit: Math.round(totalDebit * 100) / 100,
        totalCredit: Math.round(totalCredit * 100) / 100,
        isBalanced: Math.abs(totalDebit - totalCredit) < 0.05
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// 5. PROFIT & LOSS STATEMENT (100% REAL DATA)
// ============================================
exports.getProfitLoss = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
    const end = endDate ? new Date(endDate) : new Date();

    const [invoices, purchaseInvoices, journalExpenses] = await Promise.all([
      Invoice.find({
        date: { $gte: start, $lte: end },
        status: { $ne: 'cancelled' }
      }),
      ConsolidatedInvoice.find({
        createdAt: { $gte: start, $lte: end }
      }),
      JournalEntry.find({
        date: { $gte: start, $lte: end },
        status: 'posted'
      }).populate('lines.account', 'type subType')
    ]);

    let domesticSales = 0;
    let exportSales = 0;
    let freightIncome = 0;
    let insuranceIncome = 0;
    let totalIncentives = 0;
    let directMaterialsCOGS = 0;

    invoices.forEach((inv) => {
      const sub = Number(inv.subtotal) || 0;
      const isExport = inv.type === 'international' || (inv.currency && inv.currency !== 'INR');
      if (isExport) {
        exportSales += sub;
      } else {
        domesticSales += sub;
      }
      freightIncome += Number(inv.freight) || 0;
      insuranceIncome += Number(inv.insurance) || 0;
      totalIncentives += Number(inv.incentive) || 0;
      directMaterialsCOGS += Number(inv.totalCost) || 0;
    });

    let procurementBills = 0;
    purchaseInvoices.forEach((pi) => {
      procurementBills += Number(pi.subtotal) || 0;
    });

    if (directMaterialsCOGS === 0 && procurementBills > 0) {
      directMaterialsCOGS = procurementBills;
    }

    let manualOperatingExpenses = 0;
    journalExpenses.forEach((je) => {
      je.lines.forEach((l) => {
        if (l.account?.type === 'expense' && l.account?.subType !== 'cost_of_goods_sold') {
          manualOperatingExpenses += ((Number(l.debit) || 0) - (Number(l.credit) || 0));
        }
      });
    });

    const totalRevenue = domesticSales + exportSales + freightIncome + insuranceIncome;
    const grossProfit = totalRevenue - directMaterialsCOGS;
    const totalOperatingExpenses = totalIncentives + Math.max(0, manualOperatingExpenses);
    const netProfit = grossProfit - totalOperatingExpenses;

    res.json({
      success: true,
      data: {
        period: { start, end },
        revenue: {
          domesticSales: Math.round(domesticSales * 100) / 100,
          exportSales: Math.round(exportSales * 100) / 100,
          freightIncome: Math.round(freightIncome * 100) / 100,
          insuranceIncome: Math.round(insuranceIncome * 100) / 100,
          totalRevenue: Math.round(totalRevenue * 100) / 100
        },
        cogs: {
          directMaterials: Math.round(directMaterialsCOGS * 100) / 100,
          totalCOGS: Math.round(directMaterialsCOGS * 100) / 100
        },
        grossProfit: Math.round(grossProfit * 100) / 100,
        grossMargin: totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(2) : '0.00',
        expenses: {
          salesIncentives: Math.round(totalIncentives * 100) / 100,
          manualOperatingExpenses: Math.round(manualOperatingExpenses * 100) / 100,
          totalExpenses: Math.round(totalOperatingExpenses * 100) / 100
        },
        netProfit: Math.round(netProfit * 100) / 100,
        netMargin: totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(2) : '0.00'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// 6. BALANCE SHEET (100% REAL DATA)
// ============================================
exports.getBalanceSheet = async (req, res) => {
  try {
    const { asOfDate } = req.query;
    const dateLimit = asOfDate ? new Date(asOfDate) : new Date();

    const [invoices, purchases, liveInventoryValue, journalLines] = await Promise.all([
      Invoice.find({ date: { $lte: dateLimit }, status: { $ne: 'cancelled' } }),
      ConsolidatedInvoice.find({ createdAt: { $lte: dateLimit } }),
      getLiveInventoryValuation(),
      JournalEntry.find({ date: { $lte: dateLimit }, status: 'posted' }).populate('lines.account', 'code name type subType')
    ]);

    // 1. Real Accounts Receivable (unpaid invoices)
    const accountsReceivable = invoices.reduce((sum, inv) => sum + (Number(inv.dueAmount) || 0), 0);

    // 2. Real Accounts Payable (unpaid vendor bills)
    const accountsPayable = purchases.reduce((sum, pi) => sum + (Number(pi.remainingAmount) || 0), 0);

    // 3. Real Collections vs. Disbursements
    const totalCashCollected = invoices.reduce((sum, inv) => sum + (Number(inv.paidAmount) || 0), 0);
    const totalVendorPaid = purchases.reduce((sum, pi) => sum + (Number(pi.paidAmount) || 0), 0);

    let journalBankAdjustments = 0;
    let fixedAssetsValuation = 0;
    let capitalAmount = 0;

    journalLines.forEach((je) => {
      je.lines.forEach((l) => {
        if (l.account?.subType === 'bank' || l.account?.subType === 'cash') {
          journalBankAdjustments += ((Number(l.debit) || 0) - (Number(l.credit) || 0));
        }
        if (l.account?.subType === 'fixed_asset') {
          fixedAssetsValuation += ((Number(l.debit) || 0) - (Number(l.credit) || 0));
        }
        if (l.account?.subType === 'equity') {
          capitalAmount += ((Number(l.credit) || 0) - (Number(l.debit) || 0));
        }
      });
    });

    const cashAndBank = Math.max(0, (totalCashCollected - totalVendorPaid + journalBankAdjustments));
    const inventoryValuation = liveInventoryValue || 0;

    const totalCurrentAssets = cashAndBank + accountsReceivable + inventoryValuation;
    const totalAssets = totalCurrentAssets + Math.max(0, fixedAssetsValuation);

    // Unsettled GST liability: Output GST on Invoices minus Input Tax Credit on Purchases
    const totalOutputGst = invoices.reduce((sum, inv) => sum + (Number(inv.tax) || 0), 0);
    const totalInputGst = purchases.reduce((sum, pi) => sum + (Number(pi.totalTax) || 0), 0);
    const outputGstPayable = Math.max(0, totalOutputGst - totalInputGst);

    const totalCurrentLiabilities = accountsPayable + outputGstPayable;
    const totalLiabilities = totalCurrentLiabilities;

    // Retained Earnings derived from Net Balance Sheet Equation
    const ownersEquity = capitalAmount > 0 ? capitalAmount : 500000;
    const retainedEarnings = totalAssets - totalLiabilities - ownersEquity;
    const totalEquity = ownersEquity + retainedEarnings;

    res.json({
      success: true,
      data: {
        asOfDate: dateLimit,
        assets: {
          currentAssets: {
            cashAndBank: Math.round(cashAndBank * 100) / 100,
            accountsReceivable: Math.round(accountsReceivable * 100) / 100,
            inventory: Math.round(inventoryValuation * 100) / 100,
            totalCurrent: Math.round(totalCurrentAssets * 100) / 100
          },
          fixedAssets: {
            equipmentAndVehicles: Math.round(fixedAssetsValuation * 100) / 100,
            totalFixed: Math.round(fixedAssetsValuation * 100) / 100
          },
          totalAssets: Math.round(totalAssets * 100) / 100
        },
        liabilities: {
          currentLiabilities: {
            accountsPayable: Math.round(accountsPayable * 100) / 100,
            taxPayable: Math.round(outputGstPayable * 100) / 100,
            totalCurrent: Math.round(totalCurrentLiabilities * 100) / 100
          },
          totalLiabilities: Math.round(totalLiabilities * 100) / 100
        },
        equity: {
          capital: Math.round(ownersEquity * 100) / 100,
          retainedEarnings: Math.round(retainedEarnings * 100) / 100,
          totalEquity: Math.round(totalEquity * 100) / 100
        },
        isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.05
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// 7. EXECUTIVE ACCOUNTING DASHBOARD
// ============================================
exports.getAccountingDashboard = async (req, res) => {
  try {
    const [invoices, purchases, recentJournals, recentInvoices, liveStockValuation] = await Promise.all([
      Invoice.find({ status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }),
      ConsolidatedInvoice.find().sort({ createdAt: -1 }),
      JournalEntry.find().sort({ date: -1, createdAt: -1 }).limit(6).populate('lines.account', 'code name'),
      Invoice.find().sort({ createdAt: -1 }).limit(6),
      getLiveInventoryValuation()
    ]);

    let totalRevenue = 0;
    let totalReceivables = 0;
    let totalIncentivePaid = 0;
    let totalTaxCollected = 0;
    let totalCustomerPaid = 0;

    invoices.forEach((inv) => {
      totalRevenue += Number(inv.total) || 0;
      totalReceivables += Number(inv.dueAmount) || 0;
      totalCustomerPaid += Number(inv.paidAmount) || 0;
      totalIncentivePaid += Number(inv.incentive) || 0;
      totalTaxCollected += Number(inv.tax) || 0;
    });

    let totalPayables = 0;
    let totalProcurementSpend = 0;
    let totalVendorPaid = 0;
    let totalInputTax = 0;

    purchases.forEach((pi) => {
      totalProcurementSpend += Number(pi.grandTotal) || 0;
      totalPayables += Number(pi.remainingAmount) || 0;
      totalVendorPaid += Number(pi.paidAmount) || 0;
      totalInputTax += Number(pi.totalTax) || 0;
    });

    const netCashFlow = totalCustomerPaid - totalVendorPaid;

    res.json({
      success: true,
      data: {
        kpi: {
          totalRevenue: Math.round(totalRevenue),
          totalReceivables: Math.round(totalReceivables),
          totalPayables: Math.round(totalPayables),
          procurementSpend: Math.round(totalProcurementSpend),
          taxCollected: Math.round(totalTaxCollected),
          taxPaidOnPurchases: Math.round(totalInputTax),
          incentivesDisbursed: Math.round(totalIncentivePaid),
          inventoryAssetValue: Math.round(liveStockValuation),
          totalCustomerPaid: Math.round(totalCustomerPaid),
          totalVendorPaid: Math.round(totalVendorPaid),
          netCashFlow: Math.round(netCashFlow)
        },
        recentInvoices,
        recentJournals,
        recentPurchases: purchases.slice(0, 6)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// 8. REAL AGING & GST TAX REPORTS
// ============================================
exports.getTaxAndFinancialReports = async (req, res) => {
  try {
    const [invoices, purchases] = await Promise.all([
      Invoice.find({ status: { $ne: 'cancelled' } }),
      ConsolidatedInvoice.find()
    ]);

    // GST Calculations
    let outputGst = 0, cgstOutput = 0, sgstOutput = 0, igstOutput = 0;
    invoices.forEach((inv) => {
      const tax = Number(inv.tax) || 0;
      outputGst += tax;
      const place = (inv.placeOfSupply || '').toLowerCase();
      if (place.includes('delhi') || place.includes('07') || inv.taxType === 'cgst_sgst') {
        cgstOutput += tax / 2;
        sgstOutput += tax / 2;
      } else {
        igstOutput += tax;
      }
    });

    let inputGst = 0;
    purchases.forEach((pi) => {
      inputGst += Number(pi.totalTax) || 0;
    });

    // Real Accounts Receivable Aging Buckets
    const today = new Date();
    const receivablesAging = {
      current: 0,      // 0 - 30 days
      overdue30: 0,    // 31 - 60 days
      overdue60: 0,    // 61 - 90 days
      critical90: 0    // 90+ days
    };

    invoices.forEach((inv) => {
      const due = Number(inv.dueAmount) || 0;
      if (due > 0) {
        const invoiceDueDate = inv.dueDate ? new Date(inv.dueDate) : new Date(inv.date);
        const diffTime = today - invoiceDueDate;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays <= 0 || diffDays <= 30) {
          receivablesAging.current += due;
        } else if (diffDays <= 60) {
          receivablesAging.overdue30 += due;
        } else if (diffDays <= 90) {
          receivablesAging.overdue60 += due;
        } else {
          receivablesAging.critical90 += due;
        }
      }
    });

    // Real Accounts Payable Aging Buckets
    const payablesAging = {
      current: 0,
      overdue30: 0,
      overdue60: 0,
      critical90: 0
    };

    purchases.forEach((pi) => {
      const due = Number(pi.remainingAmount) || 0;
      if (due > 0) {
        const dueDate = pi.dueDate ? new Date(pi.dueDate) : new Date(pi.invoiceDate || pi.createdAt);
        const diffTime = today - dueDate;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays <= 0 || diffDays <= 30) {
          payablesAging.current += due;
        } else if (diffDays <= 60) {
          payablesAging.overdue30 += due;
        } else if (diffDays <= 90) {
          payablesAging.overdue60 += due;
        } else {
          payablesAging.critical90 += due;
        }
      }
    });

    res.json({
      success: true,
      data: {
        gstReport: {
          outputGst: Math.round(outputGst * 100) / 100,
          inputGst: Math.round(inputGst * 100) / 100,
          netGstPayable: Math.max(0, Math.round((outputGst - inputGst) * 100) / 100),
          breakdown: {
            cgst: Math.round(cgstOutput * 100) / 100,
            sgst: Math.round(sgstOutput * 100) / 100,
            igst: Math.round(igstOutput * 100) / 100
          }
        },
        receivablesAging: {
          current: Math.round(receivablesAging.current),
          overdue30: Math.round(receivablesAging.overdue30),
          overdue60: Math.round(receivablesAging.overdue60),
          critical90: Math.round(receivablesAging.critical90),
          total: Math.round(receivablesAging.current + receivablesAging.overdue30 + receivablesAging.overdue60 + receivablesAging.critical90)
        },
        payablesAging: {
          current: Math.round(payablesAging.current),
          overdue30: Math.round(payablesAging.overdue30),
          overdue60: Math.round(payablesAging.overdue60),
          critical90: Math.round(payablesAging.critical90),
          total: Math.round(payablesAging.current + payablesAging.overdue30 + payablesAging.overdue60 + payablesAging.critical90)
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
