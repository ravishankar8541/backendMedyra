// api/index.js
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
const uploadRoutes = require('../routes/uploadRoutes'); // ✅ UPLOAD ROUTES

// ============================================
// INITIALIZE EXPRESS
// ============================================
const app = express();

// Connect to database
dbConnection();

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5000', 'http://localhost:3000'],
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
// EMAIL API
// ============================================
app.post('/api/send-po-email', upload.single('pdf'), async (req, res) => {
  try {
    const { emailData } = JSON.parse(req.body.emailData);
    const pdfBuffer = req.file;

    if (!pdfBuffer) {
      return res.status(400).json({ success: false, error: 'PDF file is required' });
    }

    const mailOptions = {
      from: `"Medyra Pharmaceutical" <${process.env.EMAIL_USER}>`,
      to: emailData.to,
      cc: emailData.cc || '',
      subject: emailData.subject,
      html: emailData.html || emailData.body,
      attachments: [
        {
          filename: `PO-${emailData.poNumber || 'PO'}.pdf`,
          content: pdfBuffer.buffer,
          contentType: 'application/pdf'
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);

    res.json({
      success: true,
      messageId: info.messageId,
      message: 'Email sent successfully'
    });
  } catch (error) {
    console.error('Email error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// ROUTES - SINGLE MOUNTING ONLY
// ============================================

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
mountRoute('/api/uploads', uploadRoutes, 'Upload Routes'); // ✅ MOUNTED

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'OK',
    message: 'Server is running',
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