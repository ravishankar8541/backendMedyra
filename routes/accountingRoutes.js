// routes/accountingRoutes.js
const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const {
  getAccounts,
  createAccount,
  updateAccount,
  initChartOfAccounts,
  getJournalEntries,
  createJournalEntry,
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

// Dashboard, Auto-Sync & Seeds
router.get('/dashboard', getAccountingDashboard);
router.post('/sync-journals', restrictTo('admin', 'accountant'), syncAutomatedJournals);
router.post('/init-coa', restrictTo('admin', 'accountant'), initChartOfAccounts);

// Chart of Accounts
router.route('/accounts')
  .get(getAccounts)
  .post(restrictTo('admin', 'accountant'), createAccount);
router.put('/accounts/:id', restrictTo('admin', 'accountant'), updateAccount);

// Journal Entries (Manual + Automated)
router.route('/journals')
  .get(getJournalEntries)
  .post(restrictTo('admin', 'accountant'), createJournalEntry);

router.delete('/journals/:id', restrictTo('admin', 'accountant'), deleteJournalEntry);

// Financial Statements
router.get('/ledger', getGeneralLedger);
router.get('/trial-balance', getTrialBalance);
router.get('/pnl', getProfitLoss);
router.get('/balance-sheet', getBalanceSheet);
router.get('/reports', getTaxAndFinancialReports);

module.exports = router;