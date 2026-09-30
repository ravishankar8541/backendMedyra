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
const { protect, authorize } = require('../middleware/auth');
const share = require('../controllers/packageShareController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 3, fieldSize: 64 * 1024 } }).single('pdf');
const pdfUpload = (req, res, next) => upload(req, res, error => {
  if (!error) return next();
  res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: 'Attach one Packing List PDF up to 10 MB.' });
});
router.get('/document/:token', share.view);

router.use(protect);
router.post('/:id/share', authorize(), pdfUpload, share.share);
router.post('/:id/email', authorize(), pdfUpload, share.email);

// Main collection routes: Get All & Create
router.route('/')
  .get(getPackages)
  .post(authorize(), createPackage);

// Single Item routes: Get Single, Update (Edit), and Delete
router.route('/:id')
  .get(getPackageById)
  .put(authorize(), updatePackage)
  .delete(authorize(), deletePackage);

// Action routes
router.patch('/:id/status', updatePackageStatus);
router.patch('/:id/label', markLabelGenerated);
router.patch('/:id/slip', markSlipGenerated);

module.exports = router;
