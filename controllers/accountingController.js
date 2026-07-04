const JournalEntry = require('../models/JournalEntry');
const Invoice = require('../models/Invoice');
const PurchaseOrder = require('../models/PurchaseOrder');

// @desc    Create journal entry
// @route   POST /api/accounting/journal
// @access  Private (Accountant, Admin)
exports.createJournalEntry = async (req, res) => {
  try {
    const entryData = req.body;
    entryData.createdBy = req.user.id;

    // Validate balance
    let totalDebit = 0;
    let totalCredit = 0;
    entryData.entries.forEach(e => {
      if (e.type === 'debit') totalDebit += e.amount;
      else totalCredit += e.amount;
    });

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({
        message: 'Journal entries must balance (debit = credit)'
      });
    }

    const entry = new JournalEntry(entryData);
    await entry.save();

    res.status(201).json({
      success: true,
      data: entry
    });
  } catch (error) {
    console.error('Create journal entry error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get journal entries
// @route   GET /api/accounting/journal
// @access  Private (Accountant, Admin)
exports.getJournalEntries = async (req, res) => {
  try {
    const { page = 1, limit = 10, startDate, endDate, status } = req.query;

    const query = {};
    if (status) query.status = status;
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const entries = await JournalEntry.find(query)
      .populate('createdBy', 'name')
      .sort({ date: -1 })
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
    console.error('Get journal entries error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get profit & loss summary
// @route   GET /api/accounting/pnl
// @access  Private (Accountant, Admin)
exports.getProfitAndLoss = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    // Get income from invoices
    const income = await Invoice.aggregate([
      { $match: { ...dateFilter, status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);

    // Get expenses from purchase orders
    const expenses = await PurchaseOrder.aggregate([
      { $match: { ...dateFilter, status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);

    const totalIncome = income[0]?.total || 0;
    const totalExpenses = expenses[0]?.total || 0;
    const netProfit = totalIncome - totalExpenses;

    res.json({
      success: true,
      data: {
        totalIncome,
        totalExpenses,
        netProfit,
        profitMargin: totalIncome ? ((netProfit / totalIncome) * 100).toFixed(2) : 0
      }
    });
  } catch (error) {
    console.error('Get P&L error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get balance sheet
// @route   GET /api/accounting/balance-sheet
// @access  Private (Accountant, Admin)
exports.getBalanceSheet = async (req, res) => {
  try {
    const asOfDate = req.query.date ? new Date(req.query.date) : new Date();

    // Get assets from invoices (accounts receivable)
    const receivables = await Invoice.aggregate([
      { $match: { status: { $in: ['sent', 'overdue'] } } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);

    // Get liabilities from purchase orders (accounts payable)
    const payables = await PurchaseOrder.aggregate([
      { $match: { status: { $in: ['pending', 'approved', 'shipped'] } } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);

    // Get total revenue (equity)
    const revenue = await Invoice.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);

    const assets = {
      current: receivables[0]?.total || 0,
      fixed: 0, // Would come from fixed assets collection
      total: receivables[0]?.total || 0
    };

    const liabilities = {
      current: payables[0]?.total || 0,
      total: payables[0]?.total || 0
    };

    const equity = {
      capital: revenue[0]?.total || 0,
      retained: 0,
      total: revenue[0]?.total || 0
    };

    res.json({
      success: true,
      data: {
        asOfDate,
        assets,
        liabilities,
        equity,
        totalAssets: assets.total,
        totalLiabilities: liabilities.total + equity.total
      }
    });
  } catch (error) {
    console.error('Get balance sheet error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};