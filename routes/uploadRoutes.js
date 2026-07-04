// routes/uploadRoutes.js
const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const { upload, uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');

// ============================================
// UPLOAD SINGLE IMAGE
// ============================================
router.post('/image', protect, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    console.log('📸 Uploading single image:', req.file.originalname);

    const result = await uploadToCloudinary(req.file.path);
    
    res.json({
      success: true,
      url: result.secure_url,
      public_id: result.public_id,
      format: result.format,
      width: result.width,
      height: result.height,
      message: 'Image uploaded successfully'
    });
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================
// UPLOAD MULTIPLE IMAGES
// ============================================
router.post('/images', protect, upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No image files provided'
      });
    }

    console.log(`📸 Uploading ${req.files.length} images`);

    const uploadedImages = [];
    for (const file of req.files) {
      try {
        const result = await uploadToCloudinary(file.path);
        uploadedImages.push({
          url: result.secure_url,
          public_id: result.public_id,
          format: result.format,
          width: result.width,
          height: result.height
        });
      } catch (err) {
        console.error('Error uploading file:', file.originalname, err);
      }
    }

    if (uploadedImages.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'Failed to upload any images'
      });
    }

    res.json({
      success: true,
      urls: uploadedImages.map(img => img.url),
      images: uploadedImages,
      count: uploadedImages.length,
      message: `${uploadedImages.length} image(s) uploaded successfully`
    });
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================
// DELETE IMAGE
// ============================================
router.delete('/image/:public_id', protect, async (req, res) => {
  try {
    const { public_id } = req.params;
    
    const result = await deleteFromCloudinary(public_id);
    
    if (result.result === 'ok') {
      res.json({
        success: true,
        message: 'Image deleted successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Image not found or already deleted'
      });
    }
  } catch (error) {
    console.error('❌ Delete error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================
// DELETE MULTIPLE IMAGES
// ============================================
router.delete('/images', protect, async (req, res) => {
  try {
    const { public_ids } = req.body;
    
    if (!public_ids || !Array.isArray(public_ids) || public_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No public_ids provided'
      });
    }

    const results = await Promise.all(
      public_ids.map(id => deleteFromCloudinary(id))
    );

    const successful = results.filter(r => r.result === 'ok').length;
    const failed = results.length - successful;

    res.json({
      success: true,
      total: results.length,
      successful,
      failed,
      message: `${successful} image(s) deleted successfully`
    });
  } catch (error) {
    console.error('❌ Delete error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;