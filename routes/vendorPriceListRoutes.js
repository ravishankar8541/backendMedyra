const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
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

router.post('/', authorize(), upsertPriceList);
router.put('/supplier/:supplierId/item', authorize(), upsertItem);
router.delete('/supplier/:supplierId/item/:itemId', authorize(), removeItem);
router.delete('/supplier/:supplierId', authorize(), deletePriceList);

module.exports = router;










