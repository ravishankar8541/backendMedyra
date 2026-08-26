// api/index.js - SIMPLIFIED FIXED VERSION
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const nodemailer = require('nodemailer');
const multer = require('multer');
const upload = multer();

// ============================================
// DATABASE CONNECTION
// ============================================
const dbConnection = require('../config/db');

// ============================================
// IMPORT ROUTES
// ============================================
const authRoutes = require('../routes/authRoutes');
const userRoutes = require('../routes/userRoutes');
const invoiceRoutes = require('../routes/invoiceRoutes');
const productRoutes = require('../routes/productRoutes');
const orderRoutes = require('../routes/orderRoutes');
const inventoryRoutes = require('../routes/inventoryRoutes');
const supplierRoutes = require('../routes/supplierRoutes');
const purchaseOrderRoutes = require('../routes/purchaseOrderRoutes');
const leadRoutes = require('../routes/leadRoutes');
const followupRoutes = require('../routes/followupRoutes');
const dashboardRoutes = require('../routes/dashboardRoutes');
const revenueRoutes = require('../routes/revenueRoutes');
const telecallerRoutes = require('../routes/telecallerRoutes');
const deliveryRoutes = require('../routes/deliveryRoutes');
const packageRoutes = require('../routes/packageRoutes');
const accountingRoutes = require('../routes/accountingRoutes');
const reportRoutes = require('../routes/reportRoutes');
const currencyRoutes = require('../routes/currencyRoutes');
const uploadRoutes = require('../routes/uploadRoutes'); 
const quotationRoutes = require('../routes/quotationRoutes');
const purchaseReturnRoutes = require('../routes/purchaseReturnRoutes');
const unitRoutes = require('../routes/unitRoutes');
const categoryRoutes = require('../routes/categoryRoutes');
const goodsReceiptRoutes = require('../routes/goodsReceiptRoutes');
const subCategoryRoutes = require('../routes/subCategoryRoutes');
const vendorPriceListRoutes = require('../routes/vendorPriceListRoutes');
const clientPriceListRoutes = require('../routes/clientPriceListRoutes');
const app = express();

// Connect to database
dbConnection();

app.use(cors({
  origin: ['https://medyra-frontend-new-cwlc.vercel.app', 'http://localhost:5174', 'http://localhost:5173', 'http://localhost:5000', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============================================
// EMAIL TRANSPORTER
// ============================================
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ============================================
// SEND PO EMAIL - FIXED
// ============================================
app.post('/api/send-po-email', upload.single('pdf'), async (req, res) => {
  try {
    console.log('📧 Sending PO email...');
    
    // Parse email data
    const emailData = JSON.parse(req.body.emailData);
    const pdfBuffer = req.file;

    if (!pdfBuffer) {
      return res.status(400).json({ success: false, error: 'PDF file is required' });
    }

    if (!emailData.to) {
      return res.status(400).json({ success: false, error: 'Recipient email is required' });
    }

    const mailOptions = {
      from: `"Medyra Pharmaceutical" <${process.env.EMAIL_USER}>`,
      to: emailData.to,
      cc: emailData.cc || '',
      subject: emailData.subject || 'Purchase Order from Medyra Pharmaceutical',
      html: emailData.html || emailData.body || 'Please find attached the purchase order.',
      attachments: [
        {
          filename: `PO-${emailData.poNumber || 'PO'}.pdf`,
          content: pdfBuffer.buffer,
          contentType: 'application/pdf'
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent:', info.messageId);

    res.json({
      success: true,
      messageId: info.messageId,
      message: 'Email sent successfully'
    });
  } catch (error) {
    console.error('❌ Email error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// TEST EMAIL - SIMPLE DEBUG ENDPOINT
// ============================================
app.post('/api/test-email', async (req, res) => {
  try {
    const { to } = req.body;
    
    if (!to) {
      return res.status(400).json({ success: false, error: 'Email required' });
    }

    const mailOptions = {
      from: `"Medyra Pharmaceutical" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: 'Test Email',
      text: 'Your email configuration is working!'
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Test email sent' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to safely mount routes
const mountRoute = (path, router, name) => {
  try {
    if (router && router.stack) {
      app.use(path, router);
      console.log(`✅ ${name} mounted at ${path}`);
    } else if (router && typeof router === 'function') {
      app.use(path, router);
      console.log(`✅ ${name} mounted at ${path} (as function)`);
    } else {
      console.warn(`⚠️ ${name} is not a valid router`);
    }
  } catch (error) {
    console.error(`❌ Error mounting ${name}:`, error.message);
  }
};

// Mount all routes
mountRoute('/api/auth', authRoutes, 'Auth Routes');
mountRoute('/api/users', userRoutes, 'User Routes');
mountRoute('/api/invoices', invoiceRoutes, 'Invoice Routes');
mountRoute('/api/products', productRoutes, 'Product Routes');
mountRoute('/api/orders', orderRoutes, 'Order Routes');
mountRoute('/api/inventory', inventoryRoutes, 'Inventory Routes');
mountRoute('/api/suppliers', supplierRoutes, 'Supplier Routes');
mountRoute('/api/purchase-orders', purchaseOrderRoutes, 'Purchase Order Routes');
mountRoute('/api/leads', leadRoutes, 'Lead Routes');
mountRoute('/api/followups', followupRoutes, 'Followup Routes');
mountRoute('/api/dashboard', dashboardRoutes, 'Dashboard Routes');
mountRoute('/api/revenue', revenueRoutes, 'Revenue Routes');
mountRoute('/api/telecaller', telecallerRoutes, 'Telecaller Routes');
mountRoute('/api/deliveries', deliveryRoutes, 'Delivery Routes');
mountRoute('/api/packages', packageRoutes, 'Package Routes');
mountRoute('/api/accounting', accountingRoutes, 'Accounting Routes');
mountRoute('/api/reports', reportRoutes, 'Report Routes');
mountRoute('/api/currency', currencyRoutes, 'Currency Routes');
mountRoute('/api/uploads', uploadRoutes, 'Upload Routes'); 
mountRoute('/api/quotations', quotationRoutes, 'Quotation Routes');

mountRoute('/api/units', unitRoutes, 'Unit Routes');
mountRoute('/api/categories', categoryRoutes, 'Category Routes')
mountRoute('/api/goods-receipts', goodsReceiptRoutes, 'Goods Receipt Routes');
mountRoute('/api/purchase-returns', purchaseReturnRoutes, 'Purchase Return Routes');
mountRoute('/api/subcategories', subCategoryRoutes, 'Sub Category Routes');
mountRoute('/api/vendor-price-lists', vendorPriceListRoutes, 'Vendor Price Lists');
mountRoute('/api/client-price-lists', clientPriceListRoutes, 'Client Price Lists');
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: '🚀 Medyra Backend API is running successfully!',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// 404 Handler
// ============================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.url} not found`
  });
});

// ============================================
// ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  
  res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});