const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  getFollowups,
  createFollowup,
  updateFollowup,
  completeFollowup,
  deleteFollowup,
  getFollowupStats
} = require('../controllers/followupController');
const { protect } = require('../middleware/auth');

const followupValidation = [
  body('customer').notEmpty().withMessage('Customer name required'),
  body('phone').notEmpty().withMessage('Phone number required'),
  body('date').isISO8601().withMessage('Valid date required'),
  body('time').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Invalid time format')
];

router.use(protect);

router.get('/stats', getFollowupStats);
router.route('/')
  .get(getFollowups)
  .post(followupValidation, createFollowup);

router.put('/:id', updateFollowup);
router.put('/:id/complete', completeFollowup);
router.delete('/:id', deleteFollowup);

module.exports = router;