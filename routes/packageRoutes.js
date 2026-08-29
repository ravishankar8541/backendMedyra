const express = require('express');
const router = express.Router();
const {
  getPackages,
  getPackageById,
  createPackage,
  updatePackage,
  deletePackage,
  updatePackageStatus,
  markLabelGenerated,
  markSlipGenerated
} = require('../controllers/packageController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

// Main collection routes: Get All & Create
router.route('/')
  .get(getPackages)
  .post(restrictTo('admin', 'manager', 'staff'), createPackage);

// Single Item routes: Get Single, Update (Edit), and Delete
router.route('/:id')
  .get(getPackageById)
  .put(restrictTo('admin', 'manager', 'staff'), updatePackage)
  .delete(restrictTo('admin', 'manager', 'staff'), deletePackage);

// Action routes
router.patch('/:id/status', updatePackageStatus);
router.patch('/:id/label', markLabelGenerated);
router.patch('/:id/slip', markSlipGenerated);

module.exports = router;