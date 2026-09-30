const express = require('express');
const router = express.Router();
const {
  getDeliveries,
  createDelivery,
  syncFromPackages,
  confirmDelivery,
  updateStatus,
  deleteDelivery, uploadProof, getProof
} = require('../controllers/deliveryController');
const { protect } = require('../middleware/auth');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3 } }).single('proof');
const proofUpload = (req, res, next) => upload(req, res, error => {
  if (!error) return next();
  res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: 'Choose one JPG, PNG, WebP or PDF file up to 5 MB.' });
});

router.use(protect);

router.route('/')
  .get(getDeliveries)
  .post(createDelivery);

router.post('/sync-packages', syncFromPackages);
router.patch('/:id/confirm', proofUpload, confirmDelivery);
router.post('/:id/proof', proofUpload, uploadProof);
router.get('/:id/proof', getProof);
router.patch('/:id/status', updateStatus);
router.delete('/:id', deleteDelivery);

module.exports = router;
