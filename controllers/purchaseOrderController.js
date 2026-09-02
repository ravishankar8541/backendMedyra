// controllers/purchaseOrderController.js
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const PurchaseOrder = require('../models/PurchaseOrder');
const Product = require('../models/Product');

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
// 🌐 PURCHASE ORDER ONLINE VIEW (EXACT PRINT PO MATCH)
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
      gstin: '07BLQPR8835QZZR',
      email: 'Pharmaceutical@medyra.in',
      phone: '+91 9310879396',
      logoUrl: 'https://medyra-frontend-new-cwlc.vercel.app/medyraWhiteLogo.png'
    };

    const items = order.items || [];
    const currency = order.currency || 'INR';
    const symbol = getCurrencySymbol(currency);
    const createdDate = formatDisplayDate(order.createdAt || order.date);
    const expectedDate = formatDisplayDate(order.expectedDate);

    const freight = Number(order.freight?.amount || 0);
    const freightTaxRate = Number(order.freight?.taxRate || 18);
    const insurance = Number(order.insurance?.amount || 0);
    const insuranceTaxRate = Number(order.insurance?.taxRate || 18);
    const inventory = Number(order.inventoryCharges?.amount || 0);
    const inventoryTaxRate = Number(order.inventoryCharges?.taxRate || 18);

    const itemsBaseSubtotal = items.reduce((sum, item) => {
      const qty = Number(item.quantity) || 0;
      const rate = Number(item.unitPrice || item.rate) || 0;
      return sum + (qty * rate);
    }, 0);

    const rawSubtotal = Number(order.subtotal || 0);
    const itemsSubtotal = (rawSubtotal > 0 && Math.abs(rawSubtotal - itemsBaseSubtotal - freight - insurance - inventory) < 0.1)
      ? itemsBaseSubtotal
      : (itemsBaseSubtotal > 0 ? itemsBaseSubtotal : rawSubtotal);

    const totalTax = Number(order.totalTax || 0);
    const exactTotalBeforeRound = itemsSubtotal + freight + insurance + inventory + totalTax;
    const isInternational = currency && currency !== 'INR';
    const storedTotal = Number(order.total);
    const grandTotal = isInternational
      ? Number((Number.isFinite(storedTotal) && storedTotal > 0 ? storedTotal : exactTotalBeforeRound).toFixed(2))
      : Math.round(Number.isFinite(storedTotal) && storedTotal > 0 ? storedTotal : exactTotalBeforeRound);
    const roundOff = isInternational ? 0 : Number((grandTotal - exactTotalBeforeRound).toFixed(2));
    const totalInWords = `${currency === 'INR' ? 'Indian Rupee' : currency} ${numberToWords(isInternational ? Math.floor(grandTotal) : Math.round(grandTotal))} Only`;

    // ⭐ Tax label in brackets
    const taxTypeLabel = order.gstType === 'cgst_sgst' ? 'CGST + SGST' : 'IGST';

    let rowIndex = 0;
    const itemRows = items.map((item) => {
      rowIndex++;
      const qty = Number(item.quantity) || 0;
      const rate = Number(item.unitPrice || item.rate) || 0;
      const lineTotal = qty * rate;
      const tax = Number(item.taxRate) || 0;

      return `
        <tr>
          <td class="text-center" style="font-weight:700;color:#475569;">${rowIndex}</td>
          <td>
            <p style="font-weight:800;color:#000000;margin-bottom:2px;">${item.productName || item.name || 'Product'}</p>
            <p style="font-size:10px;color:#64748b;">HSN: ${item.hsn || '3004.90.99'}</p>
            <p style="font-size:10px;color:#64748b;">Unit: ${item.unit || 'Strips'}</p>
          </td>
          <td class="text-center" style="font-family:monospace;font-size:11px;">${item.batchNumber && item.batchNumber !== 'N/A' ? item.batchNumber : '-'}</td>
          <td class="text-center" style="font-weight:800;">${qty}</td>
          <td class="text-right">${rate.toFixed(2)}</td>
          <td class="text-center">${tax}%</td>
          <td class="text-right" style="font-weight:900;color:#000000;">${lineTotal.toFixed(2)}</td>
        </tr>`;
    }).join('');

    let chargeRows = '';
    if (freight > 0) {
      rowIndex++;
      chargeRows += `
        <tr>
          <td class="text-center" style="font-weight:700;color:#475569;">${rowIndex}</td>
          <td>
            <p style="font-weight:800;color:#000000;">Freight / Shipping Charges</p>
            <p style="font-size:10px;color:#64748b;">Transportation & logistics</p>
          </td>
          <td class="text-center">-</td>
          <td class="text-center" style="font-weight:800;">1</td>
          <td class="text-right">${freight.toFixed(2)}</td>
          <td class="text-center">${freightTaxRate}%</td>
          <td class="text-right" style="font-weight:900;">${freight.toFixed(2)}</td>
        </tr>`;
    }
    if (insurance > 0) {
      rowIndex++;
      chargeRows += `
        <tr>
          <td class="text-center" style="font-weight:700;color:#475569;">${rowIndex}</td>
          <td>
            <p style="font-weight:800;color:#000000;">Insurance Charges</p>
            <p style="font-size:10px;color:#64748b;">Cargo / transit insurance</p>
          </td>
          <td class="text-center">-</td>
          <td class="text-center" style="font-weight:800;">1</td>
          <td class="text-right">${insurance.toFixed(2)}</td>
          <td class="text-center">${insuranceTaxRate}%</td>
          <td class="text-right" style="font-weight:900;">${insurance.toFixed(2)}</td>
        </tr>`;
    }
    if (inventory > 0) {
      rowIndex++;
      chargeRows += `
        <tr>
          <td class="text-center" style="font-weight:700;color:#475569;">${rowIndex}</td>
          <td>
            <p style="font-weight:800;color:#000000;">Inventory / Handling Charges</p>
            <p style="font-size:10px;color:#64748b;">Handling & inventory charges</p>
          </td>
          <td class="text-center">-</td>
          <td class="text-center" style="font-weight:800;">1</td>
          <td class="text-right">${inventory.toFixed(2)}</td>
          <td class="text-center">${inventoryTaxRate}%</td>
          <td class="text-right" style="font-weight:900;">${inventory.toFixed(2)}</td>
        </tr>`;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Purchase Order - ${order.poNumber || ''}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; padding: 25px; font-size: 11px; color: #0f172a; line-height: 1.4; }
    .po-container { max-width: 210mm; margin: 0 auto; background: #ffffff; padding: 32px; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    .logo-box { width: 160px; height: 80px; background-color: #000000 !important; border-radius: 8px; padding: 6px; display: flex; align-items: center; justify-content: center; }
    .logo-img { width: 100%; height: 100%; object-fit: contain; }
    .po-title { font-size: 20px; font-weight: 900; color: #000000; text-transform: uppercase; }
    .solid-divider { width: 100%; height: 2px; background: #000000; margin: 12px 0; }
    .section-title { font-size: 11px; font-weight: 900; text-transform: uppercase; color: #000000; border-bottom: 2px solid #000000; padding-bottom: 2px; display: inline-block; margin-bottom: 6px; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
    .items-table th { background-color: #e0f2fe !important; color: #0f172a; font-weight: 800; font-size: 10px; text-transform: uppercase; padding: 9px 10px; text-align: left; border-bottom: 2px solid #0284c7; }
    .items-table td { padding: 9px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bottom-grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 24px; margin-top: 8px; page-break-inside: avoid; }
    .totals-box { border-top: 2px solid #000000; padding-top: 8px; font-size: 11px; }
    .total-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #e2e8f0; }
    .total-row.final { border-bottom: none; margin-top: 6px; padding: 8px 10px; border: 2px solid #000000; font-weight: 900; font-size: 14px; }
    .print-bar { max-width: 210mm; margin: 0 auto 16px auto; display: flex; justify-content: flex-end; }
    .print-btn { background: #013A59; color: #fff; border: none; padding: 8px 16px; font-weight: 700; border-radius: 6px; cursor: pointer; }
    @media print {
      body { background: #fff; padding: 0; }
      .print-bar { display: none; }
      .po-container { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      .logo-box { background-color: #000000 !important; }
    }
  </style>
</head>
<body>
  <div class="print-bar">
    <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
  </div>
  <div class="po-container">
    <table class="header-table">
      <tr>
        <td style="vertical-align:top; width:60%;">
          <div class="logo-box" style="margin-bottom:8px;">
            <img src="${company.logoUrl}" class="logo-img" alt="Medyra" onerror="this.style.display='none';this.parentElement.innerHTML='<span style=\\'color:#fff;font-weight:900;font-size:16px;\\'>MEDYRA</span>'"/>
          </div>
          <div style="font-size:10px; color:#334155;">
            <p style="font-weight:800;font-size:11px;">${company.name}</p>
            <p>${company.address}</p>
            <p>GSTIN: <strong>${company.gstin}</strong> | Mobile: ${company.phone}</p>
            <p>Email: ${company.email}</p>
          </div>
        </td>
        <td style="vertical-align:top; text-align:right; width:40%;">
          <div class="po-title">PURCHASE ORDER</div>
          <p style="font-weight:800;margin-top:4px;">PO Number: ${order.poNumber}</p>
          <p style="font-weight:700;">Date: ${createdDate}</p>
          <p style="font-weight:700;">Currency: ${currency}</p>
        </td>
      </tr>
    </table>

    <div class="solid-divider"></div>

    <div style="margin-bottom:12px;">
      <div class="section-title">VENDOR DETAILS</div>
      <div style="font-size:11px;margin-top:4px;">
        <h4 style="font-size:13px;font-weight:900;">${order.supplierName || order.supplier}</h4>
        <p>${order.supplierAddress || 'N/A'}</p>
        <p><strong>GSTIN:</strong> ${order.supplierGST || 'N/A'}</p>
        <p><strong>Contact:</strong> ${order.supplierContact || 'N/A'}</p>
        <p><strong>Email:</strong> ${order.supplierEmail || 'N/A'}</p>
      </div>
    </div>

    <table class="items-table">
      <thead>
        <tr>
          <th style="width:32px;" class="text-center">#</th>
          <th>Item & Description</th>
          <th class="text-center" style="width:90px;">Batch</th>
          <th class="text-center" style="width:60px;">Qty</th>
          <th class="text-right" style="width:80px;">Rate (${symbol})</th>
          <th class="text-center" style="width:60px;">Tax</th>
          <th class="text-right" style="width:90px;">Total (${symbol})</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        ${chargeRows}
      </tbody>
    </table>

    <div class="bottom-grid">
      <div>
        <p><strong>Total In Words:</strong> ${totalInWords}</p>
        <p style="margin-top:8px;"><strong>Expected Delivery:</strong> ${expectedDate}</p>
        ${order.notes && order.notes !== 'No notes' ? `<p style="margin-top:8px;"><strong>Notes:</strong> ${order.notes}</p>` : ''}
      </div>

      <div class="totals-box">
        <div class="total-row">
          <span>Sub Total</span>
          <span>${symbol}${itemsSubtotal.toFixed(2)}</span>
        </div>
        ${freight > 0 ? `<div class="total-row"><span>Freight</span><span>${symbol}${freight.toFixed(2)}</span></div>` : ''}
        ${insurance > 0 ? `<div class="total-row"><span>Insurance</span><span>${symbol}${insurance.toFixed(2)}</span></div>` : ''}
        ${inventory > 0 ? `<div class="total-row"><span>Inventory Charges</span><span>${symbol}${inventory.toFixed(2)}</span></div>` : ''}
        <div class="total-row">
          <span>Total Tax (${taxTypeLabel})</span>
          <span>${symbol}${totalTax.toFixed(2)}</span>
        </div>
        ${!isInternational ? `<div class="total-row"><span>Round Off</span><span>${roundOff >= 0 ? '+' : ''}${symbol}${Math.abs(roundOff).toFixed(2)}</span></div>` : ''}
        <div class="total-row final">
          <span>TOTAL (${currency})</span>
          <span>${symbol}${grandTotal.toFixed(2)}</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (err) {
    console.error('Public PO View error:', err);
    return res.status(500).send('<h2>Error loading Purchase Order</h2>');
  }
};

// ============================================
// SEND PO VIA EMAIL
// ============================================
exports.sendPOEmail = async (req, res) => {
  try {
    let emailData = req.body;

    if (req.body.emailData) {
      if (typeof req.body.emailData === 'string') {
        try {
          emailData = JSON.parse(req.body.emailData);
        } catch (e) {
          emailData = req.body;
        }
      } else {
        emailData = req.body.emailData;
      }
    }

    const { to, cc, subject, body, html, poNumber } = emailData;

    if (!to || !to.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Recipient email is required'
      });
    }

    const attachments = [];
    if (req.file) {
      attachments.push({
        filename: req.file.originalname || `PO-${poNumber || 'document'}.pdf`,
        content: req.file.buffer,
        contentType: 'application/pdf'
      });
    }

    const mailHtml = html || (body ? body.replace(/\n/g, '<br/>') : `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;">
        <p>Dear Sir/Madam,</p>
        <p>Please find attached our official Purchase Order <strong>#${poNumber || ''}</strong>.</p>
        <p>Thank you,<br/>Medyra Pharmaceutical</p>
      </div>
    `);

    await transporter.sendMail({
      from: `"Medyra Pharmaceutical" <${process.env.EMAIL_USER}>`,
      to: to.trim(),
      cc: cc && cc.trim() ? cc.trim() : undefined,
      subject: subject || `Purchase Order #${poNumber || ''} - Medyra Pharmaceutical`,
      html: mailHtml,
      attachments
    });

    if (poNumber) {
      await PurchaseOrder.findOneAndUpdate(
        { poNumber },
        {
          emailSent: true,
          emailSentDate: new Date().toISOString()
        }
      );
    }

    return res.status(200).json({
      success: true,
      message: `Email successfully sent to ${to.trim()}`
    });
  } catch (error) {
    console.error('❌ Send Email Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to send email'
    });
  }
};

// ============================================
// CREATE PURCHASE ORDER
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

// ============================================
// UPDATE PURCHASE ORDER (FULL EDIT)
// ============================================
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

    if (order.status === 'delivered') {
      return res.status(400).json({ success: false, message: 'Cannot edit a delivered purchase order' });
    }

    const { supplier, supplierId, supplierName } = req.body;

    Object.assign(order, {
      ...req.body,
      supplier: supplier || supplierName || order.supplier,
      supplierId: isValidObjectId(supplierId) ? supplierId : order.supplierId
    });

    await order.save();
    res.json({ success: true, data: order, message: `Purchase Order #${order.poNumber} updated successfully` });
  } catch (error) {
    console.error('Update PO error:', error);
    res.status(500).json({ success: false, message: error.message });
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
    const order = await PurchaseOrder.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deletePurchaseOrder = async (req, res) => {
  try {
    await PurchaseOrder.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};