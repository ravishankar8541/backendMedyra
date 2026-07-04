const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  getTelecallerStats,
  createCallLog,
  getCallLogs
} = require('../controllers/telecallerController');
const { protect } = require('../middleware/auth');

const callValidation = [
  body('lead').notEmpty().withMessage('Lead required'),
  body('notes').notEmpty().withMessage('Call notes required')
];

router.use(protect);

router.get('/stats', getTelecallerStats);
router.post('/calls', callValidation, createCallLog);
router.get('/calls', getCallLogs);

module.exports = router;