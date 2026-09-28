// controllers/purchaseOrderController.js
require('dotenv').config();
const mongoose = require('mongoose');
const { getTransport, emailError } = require('../utils/poEmail');
const { isEmail } = require('validator');
const PurchaseOrder = require('../models/PurchaseOrder');
const Product = require('../models/Product');

const isValidObjectId = (id) => {
  if (!id) return false;
  return mongoose.Types.ObjectId.isValid(id) && 
         String(new mongoose.Types.ObjectId(id)) === String(id);
};

const numberToWords = (num) => {
  if (!num || isNaN(num) || num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const numToWords = (n) => {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + numToWords(n % 100) : '');
    if (n < 100000) return numToWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numToWords(n % 1000) : '');
    if (n < 10000000) return numToWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + numToWords(n % 100000) : '');
    return numToWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + numToWords(n % 10000000) : '');
  };
  return numToWords(Math.round(num));
};

const getCurrencySymbol = (code) => {
  const symbols = {
    INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ', SAR: '﷼',
    CNY: '¥', JPY: '¥', PKR: '₨', CAD: '$', AUD: '$', CHF: 'Fr',
    ZAR: 'R', TRY: '₺', SGD: '$', MYR: 'RM', NGN: '₦', EGP: '£'
  };
  return symbols[code] || code || '₹';
};

const formatDisplayDate = (dateVal) => {
  if (!dateVal) return 'N/A';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return dateVal;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateVal;
  }
};

// =========================================================================
// 🌐 PURCHASE ORDER ONLINE PUBLIC VIEW (No Print Button + Fixed Logo)
// =========================================================================
exports.getPublicPOView = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).send('<h2 style="font-family:sans-serif;text-align:center;margin-top:50px;color:#ef4444;">Invalid Purchase Order Link</h2>');
    }

    const order = await PurchaseOrder.findById(id);
    if (!order) {
      return res.status(404).send('<h2 style="font-family:sans-serif;text-align:center;margin-top:50px;color:#ef4444;">Purchase Order Not Found</h2>');
    }

    const company = {
      name: 'Medyra Pharmaceutical',
      address: 'Plot No. 65, Pocket-A, Sector-4, Bawana Industrial Area, DSIDC Delhi 110039, India',
      gstin: '07BLQPR8835QZZR', email: 'Pharmaceutical@medyra.in',
      phone: '+91 9310879396', contactPerson: 'Miss Ruby Rani'
    };
    const { buildPurchaseOrderPdf } = require('../utils/purchaseOrderPdf');
    const pdf = buildPurchaseOrderPdf(order, company, {
      formatDate: formatDisplayDate, numberToWords, logo: require('../utils/documentLogo')
    });
    const filename = `Purchase-Order-${order.poNumber}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${filename}.pdf"`);
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.send(Buffer.from(pdf.output('arraybuffer')));
  } catch (err) {
    console.error('Public PO View error:', err);
    return res.status(500).send('<h2>Error loading Purchase Order</h2>');
  }
};

// ============================================
// SEND PO VIA EMAIL (FIXED FOR TITAN SMTP GREETING TIMEOUT)
// ============================================
exports.sendPOEmail = async (req, res) => {
  let emailData;
  try {
    emailData = req.body?.emailData ?? req.body;
    if (typeof emailData === 'string') emailData = JSON.parse(emailData);
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid email data.' });
  }
  if (!emailData || typeof emailData !== 'object' || Array.isArray(emailData)) {
    return res.status(400).json({ success: false, error: 'Email data is required.' });
  }
  const { to, cc, subject, body, poNumber } = emailData;
  if (typeof to !== 'string' || !isEmail(to.trim()) ||
      (cc && (typeof cc !== 'string' || !isEmail(cc.trim()))) ||
      [subject, body, poNumber].some(value => value != null && typeof value !== 'string')) {
    return res.status(400).json({ success: false, error: 'Enter a valid recipient and optional CC email address, with text email fields.' });
  }
  if (!req.file?.buffer || req.file.buffer.subarray(0, 5).toString() !== '%PDF-') {
    return res.status(400).json({ success: false, error: 'A valid purchase order PDF attachment is required.' });
  }
  try {
    const { transporter, user } = getTransport();
    const text = body || 'Please find attached our official Purchase Order #' + (poNumber || '') + '.\n\nMedyra Pharmaceutical';
    const escaped = text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    // sendMail connects and authenticates itself; verify() would do that twice.
    const info = await transporter.sendMail({
      from: { name: 'Medyra Pharmaceutical', address: user },
      to: to.trim(),
      cc: cc?.trim() || undefined,
      subject: subject?.trim() || 'Purchase Order #' + (poNumber || '') + ' - Medyra Pharmaceutical',
      text,
      html: '<div style="font-family:Arial,sans-serif;white-space:pre-wrap">' + escaped + '</div>',
      attachments: [{
        filename: 'PO-' + (poNumber || 'document').replace(/[^a-zA-Z0-9_.-]/g, '_') + '.pdf',
        content: req.file.buffer,
        contentType: 'application/pdf'
      }]
    });
    const accepted = (info.accepted || []).map(address => String(address).toLowerCase());
    if (!accepted.includes(to.trim().toLowerCase())) {
      return res.status(502).json({ success: false, error: 'The mail server did not accept the vendor address. A CC recipient may have received the message; check before resending.' });
    }
    const warnings = [];
    if (info.rejected?.length) warnings.push('The vendor email was accepted, but the CC recipient was rejected.');
    const emailSentDate = new Date().toISOString();
    if (poNumber) {
      try {
        const updated = await PurchaseOrder.findOneAndUpdate(
          { poNumber }, { emailSent: true, emailSentDate },
          { maxTimeMS: 5000, bufferCommands: false }
        );
        if (!updated) warnings.push('Email accepted, but the purchase order record was not found. Do not resend.');
      } catch (error) {
        // SMTP already accepted the message. A database error must not invite a duplicate send.
        console.error('PO email status update failed:', error.code || error.name);
        warnings.push('Email accepted, but its saved status could not be updated. Do not resend.');
      }
    }
    return res.status(200).json({
      success: true, message: 'Mail server accepted the purchase order for delivery.',
      messageId: info.messageId, emailSentDate, warning: warnings.join(' ') || undefined
    });
  } catch (error) {
    console.error('PO email failed:', { code: error.code, command: error.command, responseCode: error.responseCode });
    return res.status(error.code === 'EMAIL_CONFIG' ? 503 : 502).json({
      success: false, code: error.code || 'EMAIL_SEND_FAILED', error: emailError(error)
    });
  }
};

// ============================================
// CRUD METHODS
// ============================================
exports.createPurchaseOrder = async (req, res) => {
  try {
    const { supplier, supplierId, supplierName } = req.body;
    const year = new Date().getFullYear();
    const lastOrder = await PurchaseOrder.findOne({ poNumber: new RegExp(`^PO-${year}/`) }).sort({ createdAt: -1 });

    let nextNum = 1;
    if (lastOrder && lastOrder.poNumber) {
      const parts = lastOrder.poNumber.split('/');
      if (parts.length === 2 && !isNaN(parseInt(parts[1]))) nextNum = parseInt(parts[1]) + 1;
    }

    let poNumber = `PO-${year}/${String(nextNum).padStart(3, '0')}`;
    while (await PurchaseOrder.exists({ poNumber })) {
      nextNum++;
      poNumber = `PO-${year}/${String(nextNum).padStart(3, '0')}`;
    }

    const purchaseOrder = new PurchaseOrder({
      ...req.body,
      items: (req.body.items || []).map(({ batchNumber, receivedQty, remainingQty, _id, ...item }) => ({
        ...item, receivedQty: 0, remainingQty: Number(item.quantity) || 0
      })),
      poNumber,
      supplier: supplier || supplierName || 'N/A',
      supplierId: isValidObjectId(supplierId) ? supplierId : null,
      status: 'pending'
    });

    await purchaseOrder.save();
    res.status(201).json({ success: true, data: purchaseOrder, message: `Purchase Order ${poNumber} created` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updatePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid Purchase Order ID' });
    }

    const order = await PurchaseOrder.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Purchase Order not found' });
    }

    const { supplier, supplierId, supplierName } = req.body;

    const hasReceipts = order.items.some(item => Number(item.receivedQty) > 0);
    if (hasReceipts && (
      (supplierId && String(supplierId) !== String(order.supplierId)) ||
      (req.body.currency && req.body.currency !== order.currency) ||
      (req.body.exchangeRate !== undefined && Number(req.body.exchangeRate) !== Number(order.exchangeRate))
    )) {
      return res.status(400).json({ success: false, message: 'Supplier and currency cannot change after goods are received.' });
    }
    const items = req.body.items?.map(raw => {
      const previous = order.items.find(item => String(item._id) === String(raw._id));
      const { batchNumber, receivedQty, remainingQty, ...item } = raw;
      const received = Number(previous?.receivedQty) || 0;
      if (previous && received > 0 && String(previous.productId || previous.product) !== String(item.productId || item.product)) {
        const error = new Error('A received product cannot be replaced.');
        error.status = 400;
        throw error;
      }
      if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) < received) {
        const error = new Error('Ordered quantity cannot be less than received quantity.');
        error.status = 400;
        throw error;
      }
      return { ...item, ...(previous ? { _id: previous._id, batchNumber: previous.batchNumber } : {}), receivedQty: received, remainingQty: Number(item.quantity) - received };
    });
    if (items && order.items.some(old => Number(old.receivedQty) > 0 && !items.some(item => String(item._id) === String(old._id)))) {
      return res.status(400).json({ success: false, message: 'A received purchase line cannot be removed. Correct its GRN first.' });
    }
    const receiptStatus = order.status;
    Object.assign(order, {
      ...req.body,
      ...(items ? { items } : {}),
      supplier: supplier || supplierName || order.supplier,
      supplierId: isValidObjectId(supplierId) ? supplierId : order.supplierId
    });
    if (hasReceipts) {
      const ordered = order.items.reduce((sum, item) => sum + Number(item.quantity), 0);
      const received = order.items.reduce((sum, item) => sum + Number(item.receivedQty), 0);
      order.status = received >= ordered ? 'delivered' : 'partially_received';
      order.partiallyReceived = received < ordered;
      order.receivedPercentage = Math.round(received / ordered * 100);
    } else {
      order.status = receiptStatus;
    }

    await order.save();
    res.json({ success: true, data: order, message: `Purchase Order #${order.poNumber} updated successfully` });
  } catch (error) {
    console.error('Update PO error:', error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.getPurchaseOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = { $in: status.split(',').map(s => s.trim()) };
    if (search) query.$or = [{ poNumber: { $regex: search, $options: 'i' } }, { supplier: { $regex: search, $options: 'i' } }];

    const orders = await PurchaseOrder.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit));
    const total = await PurchaseOrder.countDocuments(query);
    const pending = await PurchaseOrder.countDocuments({ status: 'pending' });
    const shipped = await PurchaseOrder.countDocuments({ status: 'shipped' });
    const delivered = await PurchaseOrder.countDocuments({ status: 'delivered' });
    const cancelled = await PurchaseOrder.countDocuments({ status: 'cancelled' });
    const partiallyReceived = await PurchaseOrder.countDocuments({ status: 'partially_received' });

    res.json({
      success: true,
      data: orders,
      stats: { total, pending, shipped, delivered, cancelled, partiallyReceived },
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPurchaseOrder = async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updatePurchaseOrderStatus = async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Purchase Order not found' });
    const hasReceipts = order.items.some(item => Number(item.receivedQty) > 0);
    if ((hasReceipts && req.body.status !== order.status) ||
        (!hasReceipts && ['delivered', 'partially_received'].includes(req.body.status))) {
      return res.status(400).json({ success: false, message: 'Received purchase status is determined by GRNs. Update the receipt to change it.' });
    }
    order.status = req.body.status;
    await order.save();
    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deletePurchaseOrder = async (req, res) => {
  try {
    const deleted = await PurchaseOrder.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Purchase Order not found' });
    res.json({ success: true, message: 'Purchase Order deleted. Linked invoices and stock remain until you delete the purchase invoice.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
