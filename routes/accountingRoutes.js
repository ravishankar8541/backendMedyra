
// routes/accountingRoutes.js
const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const {
  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  initChartOfAccounts,
  getJournalEntries,
  getJournalEntry,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  getGeneralLedger,
  getTrialBalance,
  getProfitLoss,
  getBalanceSheet,
  getAccountingDashboard,
  getTaxAndFinancialReports,
  syncAutomatedJournals
} = require('../controllers/accountingController');

router.use(protect);

// Dashboard, Auto-Sync & Initialization
router.get('/dashboard', getAccountingDashboard);
router.post('/sync-journals', restrictTo('admin', 'accountant'), syncAutomatedJournals);
router.post('/init-coa', restrictTo('admin', 'accountant'), initChartOfAccounts);

// Chart of Accounts (Full CRUD)
router.route('/accounts')
  .get(getAccounts)
  .post(restrictTo('admin', 'accountant'), createAccount);

router.route('/accounts/:id')
  .put(restrictTo('admin', 'accountant'), updateAccount)
  .delete(restrictTo('admin', 'accountant'), deleteAccount);

// Journal Entries (Full CRUD & Edit)
router.route('/journals')
  .get(getJournalEntries)
  .post(restrictTo('admin', 'accountant'), createJournalEntry);

router.route('/journals/:id')
  .get(getJournalEntry)
  .put(restrictTo('admin', 'accountant'), updateJournalEntry)
  .delete(restrictTo('admin', 'accountant'), deleteJournalEntry);

// Financial Statements & Reports
router.get('/ledger', getGeneralLedger);
router.get('/trial-balance', getTrialBalance);
router.get('/pnl', getProfitLoss);
router.get('/balance-sheet', getBalanceSheet);
router.get('/reports', getTaxAndFinancialReports);

module.exports = router;