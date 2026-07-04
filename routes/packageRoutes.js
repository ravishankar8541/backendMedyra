const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  createPackage,
  getPackages,
  updatePackageStatus,
  markLabelGenerated,
  markSlipGenerated
} = require('../controllers/packageController');
const { protect } = require('../middleware/auth');

const packageValidation = [
  body('orderId').notEmpty().withMessage('Order ID required'),
  body('customerName').notEmpty().withMessage('Customer name required'),
  body('customerAddress').notEmpty().withMessage('Customer address required')
];

router.use(protect);

router.route('/')
  .post(packageValidation, createPackage)
  .get(getPackages);

router.put('/:id/status', updatePackageStatus);
router.put('/:id/label', markLabelGenerated);
router.put('/:id/slip', markSlipGenerated);

module.exports = router;