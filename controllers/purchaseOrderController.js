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
      gstin: '07BLQPR8835QZZR',
      email: 'Pharmaceutical@medyra.in',
      phone: '+91 9310879396',
      contactPerson: 'Miss Ruby Rani',
      // Use a reliable logo URL (or keep your current one)
      logoUrl: 'https://res.cloudinary.com/dq3izjr7b/image/upload/v1788842622/medyraWhiteLogo_hl3u0h.png'
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
          </td>
          <td class="text-center" style="font-weight:800;">${qty}</td>
          <td class="text-center">${item.unit || 'Strips'}</td>
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
          <td class="text-center" style="font-weight:800;">1</td>
          <td class="text-center">—</td>
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
          <td class="text-center" style="font-weight:800;">1</td>
          <td class="text-center">—</td>
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
          <td class="text-center" style="font-weight:800;">1</td>
          <td class="text-center">—</td>
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
    .logo-box { width: 160px; height: 80px; background-color: #000000 !important; border-radius: 8px; padding: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
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
    @media print {
      body { background: #fff; padding: 0; }
      .po-container { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      .logo-box { background-color: #000000 !important; }
    }
  </style>
</head>
<body>
  <div class="po-container">
    <table class="header-table">
      <tr>
        <td style="vertical-align:top; width:60%;">
          <div class="logo-box" style="margin-bottom:8px;">
            <img 
              src="${company.logoUrl}" 
              class="logo-img" 
              alt="Medyra" 
              onerror="this.style.display='none'; this.parentElement.innerHTML='<span style=\\'color:#ffffff;font-weight:900;font-size:22px;letter-spacing:1px;\\'>MEDYRA</span>';"
            />
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
          <p style="font-weight:800;margin-top:4px;">PO Number: <span style="font-family:monospace;">${order.poNumber}</span></p>
          <p style="font-weight:700;">Date: ${createdDate}</p>
          <p style="font-weight:700;">Currency: ${currency}</p>
          <p style="font-weight:700;margin-top:2px;">Purchaser: <strong>${order.purchaserName || company.contactPerson}</strong></p>
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
          <th class="text-center" style="width:50px;">Qty</th>
          <th class="text-center" style="width:55px;">Unit</th>
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
    const { GoodsReceipt } = require('../models/GoodsReceipt');
    if (await GoodsReceipt.exists({ purchaseOrder: req.params.id })) {
      return res.status(400).json({ success: false, message: 'This purchase has linked GRNs and cannot be deleted.' });
    }
    await PurchaseOrder.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
