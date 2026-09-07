// routes/purchaseOrderRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const purchaseOrderController = require('../controllers/purchaseOrderController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// 🌐 Public PO View route (WhatsApp direct view bina auth)
router.get('/public-view/:id', purchaseOrderController.getPublicPOView);

// Email Route
router.post('/send-email', upload.single('pdf'), purchaseOrderController.sendPOEmail);

// CRUD Routes
router.post('/', purchaseOrderController.createPurchaseOrder);
router.get('/', purchaseOrderController.getPurchaseOrders);
router.get('/:id', purchaseOrderController.getPurchaseOrder);
router.put('/:id', purchaseOrderController.updatePurchaseOrder);
router.put('/:id/status', purchaseOrderController.updatePurchaseOrderStatus);
router.delete('/:id', purchaseOrderController.deletePurchaseOrder);

module.exports = router;