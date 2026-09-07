const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const {
  getPriceLists,
  getPriceListBySupplier,
  upsertPriceList,
  upsertItem,
  removeItem,
  deletePriceList
} = require('../controllers/vendorPriceListController');

router.use(protect);

router.get('/', getPriceLists);
router.get('/supplier/:supplierId', getPriceListBySupplier);

router.post('/', restrictTo('admin', 'manager'), upsertPriceList);
router.put('/supplier/:supplierId/item', restrictTo('admin', 'manager'), upsertItem);
router.delete('/supplier/:supplierId/item/:itemId', restrictTo('admin', 'manager'), removeItem);
router.delete('/supplier/:supplierId', restrictTo('admin'), deletePriceList);

module.exports = router;










