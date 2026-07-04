const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  createJournalEntry,
  getJournalEntries,
  getProfitAndLoss,
  getBalanceSheet
} = require('../controllers/accountingController');
const { protect, restrictTo } = require('../middleware/auth');

const journalValidation = [
  body('description').notEmpty().withMessage('Description required'),
  body('entries').isArray({ min: 2 }).withMessage('At least 2 entries required')
];

router.use(protect);
router.use(restrictTo('accountant', 'admin'));

router.get('/pnl', getProfitAndLoss);
router.get('/balance-sheet', getBalanceSheet);

router.route('/journal')
  .post(journalValidation, createJournalEntry)
  .get(getJournalEntries);

module.exports = router;