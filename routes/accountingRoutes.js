
// routes/accountingRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
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
router.use(authorize());

// Dashboard, Auto-Sync & Initialization
router.get('/dashboard', getAccountingDashboard);
router.post('/sync-journals', authorize(), syncAutomatedJournals);
router.post('/init-coa', authorize(), initChartOfAccounts);

// Chart of Accounts (Full CRUD)
router.route('/accounts')
  .get(getAccounts)
  .post(authorize(), createAccount);

router.route('/accounts/:id')
  .put(authorize(), updateAccount)
  .delete(authorize(), deleteAccount);

// Journal Entries (Full CRUD & Edit)
router.route('/journals')
  .get(getJournalEntries)
  .post(authorize(), createJournalEntry);

router.route('/journals/:id')
  .get(getJournalEntry)
  .put(authorize(), updateJournalEntry)
  .delete(authorize(), deleteJournalEntry);

// Financial Statements & Reports
router.get('/ledger', getGeneralLedger);
router.get('/trial-balance', getTrialBalance);
router.get('/pnl', getProfitLoss);
router.get('/balance-sheet', getBalanceSheet);
router.get('/reports', getTaxAndFinancialReports);
router.get('/product-profitability', require('../controllers/productProfitabilityController').getProductProfitability);

module.exports = router;
