// routes/purchaseOrderRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const purchaseOrderController = require('../controllers/purchaseOrderController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10, fieldSize: 64 * 1024 }
});

// 🌐 Public PO View route (WhatsApp direct view bina auth)
router.get('/public-view/:id', purchaseOrderController.getPublicPOView);

// Email Route
router.post('/send-email', (req, res, next) => {
  upload.single('pdf')(req, res, (error) => {
    if (!error) return next();
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      success: false,
      error: error.code === 'LIMIT_FILE_SIZE'
        ? 'The PO PDF exceeds the 10 MB email limit.'
        : 'Invalid email upload. Attach one PDF and the email details.'
    });
  });
}, purchaseOrderController.sendPOEmail);

// CRUD Routes
router.post('/', purchaseOrderController.createPurchaseOrder);
router.get('/', purchaseOrderController.getPurchaseOrders);
router.get('/:id', purchaseOrderController.getPurchaseOrder);
router.put('/:id', purchaseOrderController.updatePurchaseOrder);
router.put('/:id/status', purchaseOrderController.updatePurchaseOrderStatus);
router.delete('/:id', purchaseOrderController.deletePurchaseOrder);

module.exports = router;
