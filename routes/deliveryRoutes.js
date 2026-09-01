const express = require('express');
const router = express.Router();
const {
  getDeliveries,
  createDelivery,
  syncFromPackages,
  confirmDelivery,
  updateStatus,
  deleteDelivery
} = require('../controllers/deliveryController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getDeliveries)
  .post(createDelivery);

router.post('/sync-packages', syncFromPackages);
router.patch('/:id/confirm', confirmDelivery);
router.patch('/:id/status', updateStatus);
router.delete('/:id', deleteDelivery);

module.exports = router;