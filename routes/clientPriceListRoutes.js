const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getClientPriceLists,
  getPriceListByClient,
  upsertClientPriceList,
  deleteClientPriceList
} = require('../controllers/clientPriceListController');

router.use(protect);

router.get('/', getClientPriceLists);
router.get('/client/:clientId', getPriceListByClient);

router.post('/', authorize(), upsertClientPriceList);
router.delete('/client/:clientId', authorize(), deleteClientPriceList);

module.exports = router;