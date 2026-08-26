const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const {
  getClientPriceLists,
  getPriceListByClient,
  upsertClientPriceList,
  deleteClientPriceList
} = require('../controllers/clientPriceListController');

router.use(protect);

router.get('/', getClientPriceLists);
router.get('/client/:clientId', getPriceListByClient);

router.post('/', restrictTo('admin', 'manager', 'telecaller', 'staff'), upsertClientPriceList);
router.delete('/client/:clientId', restrictTo('admin', 'manager'), deleteClientPriceList);

module.exports = router;