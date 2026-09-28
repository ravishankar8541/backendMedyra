// controllers/goodsReceiptController.js
const mongoose = require('mongoose');
const purchaseInvoiceLogo = require('../utils/documentLogo');
const { GoodsReceipt, ConsolidatedInvoice } = require('../models/GoodsReceipt');
const PurchaseOrder = require('../models/PurchaseOrder');
const Product = require('../models/Product');
const PurchaseReturn = require('../models/PurchaseReturn');
const { settleInvoice, money } = require('../utils/purchaseSettlement');
const JournalEntry = require('../models/JournalEntry');
const { getTransport, emailError } = require('../utils/poEmail');
const { isEmail } = require('validator');
const receiptTransaction = require('../utils/receiptTransaction');
const {
  idOf,
  fail,
  plain,
  quantityOf,
  purchaseLine,
  syncPurchaseQuantities,
  validateItem,
  applyReceiptStock,
  recalculateReceipt
} = require('../utils/grnStock');
const { syncAllAutomatedJournals } = require('./accountingController');

// Map already returned quantities for this receipt so edits cannot reduce below what was returned
const getReturnedQuantityMap = async (grnId) => {
  const returns = await PurchaseReturn.find({ 'items.grnId': grnId, status: 'completed' });
  const map = new Map();
  for (const ret of returns) {
    for (const item of ret.items) {
      if (idOf(item.grnId) === idOf(grnId)) {
        const key = idOf(item.invoiceItemId) || idOf(item.product);
        map.set(key, (map.get(key) || 0) + Number(item.quantity || 0));
      }
    }
  }
  return map;
};

// Safe matcher across GRN items and incoming invoice/update items
const findMatchingItem = (grnItems, upd, seen) => {
  const updId = idOf(upd._id);
  const updPoItemId = idOf(upd.purchaseOrderItemId);
  const updProdId = idOf(upd.productId?._id || upd.productId || upd.product);

  // 1. Direct _id match
  let found = grnItems.find((i) => idOf(i._id) === updId && !seen.has(idOf(i._id)));
  if (found) return found;

  // 2. By purchaseOrderItemId
  if (updPoItemId) {
    found = grnItems.find(
      (i) => idOf(i.purchaseOrderItemId) === updPoItemId && !seen.has(idOf(i._id))
    );
    if (found) return found;
  }

  // 3. By productId AND batchNumber
  if (updProdId && upd.batchNumber && upd.batchNumber !== 'N/A') {
    found = grnItems.find(
      (i) =>
        idOf(i.productId) === updProdId &&
        String(i.batchNumber).trim().toLowerCase() ===
          String(upd.batchNumber).trim().toLowerCase() &&
        !seen.has(idOf(i._id))
    );
    if (found) return found;
  }

  // 4. By productId alone
  if (updProdId) {
    found = grnItems.find((i) => idOf(i.productId) === updProdId && !seen.has(idOf(i._id)));
    if (found) return found;
  }

  return null;
};

// Apply absolute receipt quantities; repeated PUTs never add stock again.
const updateReceiptItems = async (grn, updates, actor) => {
  if (grn.status !== 'completed') fail('Only completed receipts can be edited.');
  const returnedMap = await getReturnedQuantityMap(grn._id);
  const seen = new Set();

  for (let idx = 0; idx < updates.length; idx++) {
    const upd = updates[idx];
    let item = findMatchingItem(grn.items, upd, seen);

    // Positional fallback if array aligns
    if (!item && idx < grn.items.length && !seen.has(idOf(grn.items[idx]._id))) {
      item = grn.items[idx];
    }

    if (!item) {
      fail(`Unknown item: ${upd.productName || 'Product'}. Please reload the invoice.`);
    }
    seen.add(idOf(item._id));

    const before = plain(item);
    const product = await Product.findById(item.productId);
    if (!product) fail(`Product not found for ${item.productName}.`);

    const next = { ...before };
    for (const field of [
      'batchNumber',
      'mfgDate',
      'expDate',
      'mrp',
      'sellingPrice',
      'unitPrice',
      'taxRate',
      'remarks',
      'unit',
      'hsn'
    ]) {
      if (upd[field] !== undefined) next[field] = upd[field];
    }
    if (upd.receivedQty !== undefined) next.receivedQty = Number(upd.receivedQty);
    next.acceptedQty = next.receivedQty;

    // Safety: Cannot reduce receivedQty below already returned items
    const returnedQty =
      returnedMap.get(idOf(item._id)) || returnedMap.get(idOf(item.productId)) || 0;
    if (next.receivedQty < returnedQty) {
      fail(
        `Quantity for "${item.productName}" cannot be less than returned quantity (${returnedQty}).`
      );
    }

    if (upd.unit !== undefined && !String(upd.unit).trim()) fail('Unit is required.');

    for (const field of ['mfgDate', 'expDate']) {
      const val = next[field];
      if (val && val !== 'N/A' && val !== '-' && !Number.isFinite(Date.parse(val))) {
        fail('Enter a valid manufacturing or expiry date.');
      }
    }
    if (
      next.mfgDate &&
      next.expDate &&
      next.mfgDate !== 'N/A' &&
      next.expDate !== 'N/A'
    ) {
      const mfgTime = Date.parse(next.mfgDate);
      const expTime = Date.parse(next.expDate);
      if (Number.isFinite(mfgTime) && Number.isFinite(expTime) && expTime < mfgTime) {
        fail('Expiry date cannot be before manufacturing date.');
      }
    }

    applyReceiptStock(product, before, next, grn, actor);
    Object.assign(item, next);
    await product.save();
  }

  const po = await PurchaseOrder.findById(grn.purchaseOrder);
  if (po) {
    const receipts = await GoodsReceipt.find({
      purchaseOrder: po._id,
      status: 'completed'
    });
    syncPurchaseQuantities(
      po,
      receipts.map((receipt) => (idOf(receipt._id) === idOf(grn._id) ? grn : receipt))
    );
    await po.save();
  }

  recalculateReceipt(grn);
  grn.markModified('items');
};

const reverseReceipt = async (grn, actor) => {
  if (await PurchaseReturn.exists({ 'items.grnId': grn._id, status: 'completed' })) {
    fail('Cancel linked purchase returns before deleting or reversing this receipt.');
  }
  if (grn.status !== 'completed') return;
  for (const item of grn.items) {
    if (quantityOf(item) <= 0) continue;
    const product = await Product.findById(item.productId);
    if (!product) fail(`Cannot reverse missing product ${item.productName}.`);
    applyReceiptStock(product, plain(item), null, grn, actor);
    await product.save();
  }
  grn.status = 'cancelled';
  grn.invoiceGenerated = false;
  grn.invoiceId = null;
  grn.consolidatedInvoiceId = null;
  await grn.save();
  const po = await PurchaseOrder.findById(grn.purchaseOrder);
  if (po) {
    const remaining = await GoodsReceipt.find({
      purchaseOrder: po._id,
      status: 'completed'
    });
    syncPurchaseQuantities(po, remaining);
    await po.save();
  }
};

// ============================================
// PUBLIC INVOICE VIEW (NO AUTH REQUIRED)
// ============================================
exports.getPublicInvoiceView = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .send(
          '<h2 style="font-family:sans-serif;text-align:center;margin-top:50px;color:#ef4444;">Invalid Invoice Link</h2>'
        );
    }

    const invoice = await ConsolidatedInvoice.findById(id);
    if (!invoice) {
      return res
        .status(404)
        .send(
          '<h2 style="font-family:sans-serif;text-align:center;margin-top:50px;color:#ef4444;">Purchase Invoice Not Found</h2>'
        );
    }

    const currency = invoice.currency || 'INR';
    const symbols = {
      INR: '₹',
      USD: '$',
      EUR: '€',
      GBP: '£',
      AED: 'د.إ',
      SAR: '﷼',
      PKR: '₨'
    };
    const symbol = symbols[currency] || currency || '₹';
    const invNo = String(invoice.invoiceNumber || '').replace(/^CI-/i, 'PI-');
    const items = invoice.items || [];

    const formatDate = (d) => {
      if (!d) return '—';
      try {
        return new Date(d).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        });
      } catch {
        return d;
      }
    };

    let rowIndex = 0;
    const itemRows = items
      .map((item) => {
        rowIndex++;
        const qty =
          Number(item.acceptedQty || item.quantity || item.receivedQty) || 0;
        const rate = Number(item.unitPrice || item.rate) || 0;
        const tax = Number(item.taxRate) || 0;
        const lineTotal = qty * rate;
        return `
        <tr>
          <td class="text-center" style="font-weight:700;color:#475569;">${rowIndex}</td>
          <td>
            <p style="font-weight:800;color:#000;margin-bottom:2px;">${item.productName || item.name || 'Product'}</p>
            <p style="font-size:10px;color:#64748b;">HSN: ${item.hsn || '3004.90.99'}</p>
          </td>
          <td class="text-center" style="font-family:monospace;font-size:11px;">${
            item.batchNumber && item.batchNumber !== 'N/A' ? item.batchNumber : '-'
          }</td>
          <td class="text-center" style="font-weight:800;">${qty}</td>
          <td class="text-center">${item.unit || 'Strips'}</td>
          <td class="text-right">${rate.toFixed(2)}</td>
          <td class="text-center">${tax}%</td>
          <td class="text-right" style="font-weight:900;color:#000;">${lineTotal.toFixed(2)}</td>
        </tr>`;
      })
      .join('');

    const freight = Number(invoice.freight?.amount || 0);
    const insurance = Number(invoice.insurance?.amount || 0);
    const inventory = Number(invoice.inventoryCharges?.amount || 0);
    const itemsSubtotal = items.reduce((sum, item) => {
      const qty =
        Number(item.acceptedQty || item.quantity || item.receivedQty) || 0;
      const rate = Number(item.unitPrice || item.rate) || 0;
      return sum + qty * rate;
    }, 0);
    const totalTax = Number(invoice.totalTax || 0);
    const grandTotal = Number(
      invoice.grandTotal || itemsSubtotal + freight + insurance + inventory + totalTax
    );
    const paidAmt = Number(invoice.paidAmount || 0);
    const balanceAmt = Math.max(0, grandTotal - Number(invoice.returnCredit || 0) - paidAmt);
    const taxTypeLabel =
      invoice.gstType === 'cgst_sgst' ? 'CGST + SGST' : 'IGST';

    let chargeRows = '';
    if (freight > 0) {
      rowIndex++;
      chargeRows += `
        <tr>
          <td class="text-center" style="font-weight:700;">${rowIndex}</td>
          <td><p style="font-weight:800;">Freight / Shipping Charges</p></td>
          <td class="text-center">-</td>
          <td class="text-center" style="font-weight:800;">1</td>
          <td class="text-center">—</td>
          <td class="text-right">${freight.toFixed(2)}</td>
          <td class="text-center">${Number(invoice.freight?.taxRate ?? 0)}%</td>
          <td class="text-right" style="font-weight:900;">${freight.toFixed(2)}</td>
        </tr>`;
    }
    if (insurance > 0) {
      rowIndex++;
      chargeRows += `
        <tr>
          <td class="text-center" style="font-weight:700;">${rowIndex}</td>
          <td><p style="font-weight:800;">Insurance Charges</p></td>
          <td class="text-center">-</td>
          <td class="text-center" style="font-weight:800;">1</td>
          <td class="text-center">—</td>
          <td class="text-right">${insurance.toFixed(2)}</td>
          <td class="text-center">${Number(invoice.insurance?.taxRate ?? 0)}%</td>
          <td class="text-right" style="font-weight:900;">${insurance.toFixed(2)}</td>
        </tr>`;
    }
    if (inventory > 0) {
      rowIndex++;
      chargeRows += `
        <tr>
          <td class="text-center" style="font-weight:700;">${rowIndex}</td>
          <td><p style="font-weight:800;">Inventory / Handling Charges</p></td>
          <td class="text-center">-</td>
          <td class="text-center" style="font-weight:800;">1</td>
          <td class="text-center">—</td>
          <td class="text-right">${inventory.toFixed(2)}</td>
          <td class="text-center">${Number(invoice.inventoryCharges?.taxRate ?? 0)}%</td>
          <td class="text-right" style="font-weight:900;">${inventory.toFixed(2)}</td>
        </tr>`;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Purchase Invoice - ${invNo}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; padding: 25px; font-size: 11px; color: #0f172a; line-height: 1.4; }
    .invoice-container { max-width: 210mm; margin: 0 auto; background: #ffffff; padding: 32px; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    .logo-box { width: 140px; height: 70px; background-color: #000000 !important; border-radius: 8px; padding: 6px; display: flex; align-items: center; justify-content: center; }
    .logo-img { width: 100%; height: 100%; object-fit: contain; }
    .invoice-title { font-size: 20px; font-weight: 900; color: #000000; text-transform: uppercase; }
    .solid-divider { width: 100%; height: 2px; background: #000000; margin: 12px 0; }
    .section-title { font-size: 11px; font-weight: 900; text-transform: uppercase; color: #000000; border-bottom: 2px solid #000000; padding-bottom: 2px; display: inline-block; margin-bottom: 6px; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
    .items-table th { background-color: #e0f2fe !important; color: #0f172a; font-weight: 800; font-size: 10px; text-transform: uppercase; padding: 9px 10px; text-align: left; border-bottom: 2px solid #0284c7; }
    .items-table td { padding: 9px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bottom-grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 24px; margin-top: 8px; }
    .totals-box { border-top: 2px solid #000000; padding-top: 8px; font-size: 11px; }
    .total-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #e2e8f0; }
    .total-row.final { border-bottom: none; margin-top: 6px; padding: 8px 10px; border: 2px solid #000000; font-weight: 900; font-size: 14px; }
    .print-bar { max-width: 210mm; margin: 0 auto 16px auto; display: flex; justify-content: flex-end; }
    .print-btn { background: #013A59; color: #fff; border: none; padding: 10px 18px; font-weight: 700; border-radius: 6px; cursor: pointer; }
    @media print {
      body { background: #fff; padding: 0; }
      .print-bar { display: none; }
      .invoice-container { border: none; box-shadow: none; padding: 0; max-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="print-bar">
    <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
  </div>
  <div class="invoice-container">
    <table class="header-table">
      <tr>
        <td style="vertical-align:top; width:60%;">
          <div class="logo-box" style="margin-bottom:8px;">
            <img src="${purchaseInvoiceLogo}" class="logo-img" alt="Medyra"/>
          </div>
          <div style="font-size:10px; color:#334155;">
            <p style="font-weight:800;font-size:11px;">Medyra Pharmaceutical</p>
            <p>Plot No. 65, Pocket-A, Sector-4, Bawana Industrial Area, DSIDC Delhi 110039, India</p>
            <p>GSTIN: <strong>07BLQPR8835QZZR</strong> | Mobile: +91 9310879396</p>
            <p>Email: Pharmaceutical@medyra.in</p>
          </div>
        </td>
        <td style="vertical-align:top; text-align:right; width:40%;">
          <div class="invoice-title">PURCHASE INVOICE</div>
          <p style="font-weight:800;font-size:11px;margin-top:6px;">Invoice (PI): <span style="font-family:monospace;">${invNo}</span></p>
          <p style="font-weight:700;font-size:11px;margin-top:2px;">Date: ${formatDate(invoice.invoiceDate)}</p>
          <p style="font-weight:700;font-size:11px;margin-top:2px;">PO Ref: <span style="font-family:monospace;">${invoice.poNumber || '—'}</span></p>
          <p style="font-weight:700;font-size:11px;margin-top:2px;">Due Date: ${formatDate(invoice.dueDate)}</p>
        </td>
      </tr>
    </table>

    <div class="solid-divider"></div>

    <div style="margin-bottom:12px;">
      <div class="section-title">VENDOR DETAILS</div>
      <div style="font-size:11px;margin-top:4px;">
        <h4 style="font-size:13px;font-weight:900;color:#000;">${invoice.supplierName || 'N/A'}</h4>
        <p style="color:#1e293b;max-width:500px;line-height:1.2;margin:2px 0 6px 0;">${invoice.supplierAddress || 'N/A'}</p>
        <p><strong>GSTIN / TAX ID:</strong> ${invoice.supplierGST || 'N/A'}</p>
        <p><strong>Contact:</strong> ${invoice.supplierContact || 'N/A'}</p>
        <p><strong>Email:</strong> ${invoice.supplierEmail || 'N/A'}</p>
      </div>
    </div>

    <table class="items-table">
      <thead>
        <tr>
          <th style="width:32px;" class="text-center">#</th>
          <th>Item & Description</th>
          <th class="text-center" style="width:90px;">Batch</th>
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
        <p><strong>Currency:</strong> ${currency}</p>
        ${invoice.notes && invoice.notes !== 'No notes' ? `<p style="margin-top:6px;"><strong>Notes:</strong> ${invoice.notes}</p>` : ''}
      </div>
      <div class="totals-box">
        <div class="total-row">
          <span style="color:#475569;font-weight:700;">Sub Total</span>
          <span style="font-weight:800;">${symbol}${itemsSubtotal.toFixed(2)}</span>
        </div>
        ${freight > 0 ? `<div class="total-row"><span>Freight</span><span>${symbol}${freight.toFixed(2)}</span></div>` : ''}
        ${insurance > 0 ? `<div class="total-row"><span>Insurance</span><span>${symbol}${insurance.toFixed(2)}</span></div>` : ''}
        ${inventory > 0 ? `<div class="total-row"><span>Inventory / Handling</span><span>${symbol}${inventory.toFixed(2)}</span></div>` : ''}
        <div class="total-row">
          <span style="color:#475569;font-weight:700;">Total Tax (${taxTypeLabel})</span>
          <span style="font-weight:800;color:#d97706;">${symbol}${totalTax.toFixed(2)}</span>
        </div>
        <div class="total-row final">
          <span style="text-transform:uppercase;">TOTAL (${currency})</span>
          <span>${symbol}${grandTotal.toFixed(2)}</span>
        </div>
        <div class="total-row" style="margin-top:8px;padding:6px 0;">
          <span style="color:#059669;font-weight:700;">Paid</span>
          <span style="font-weight:800;color:#059669;">${symbol}${paidAmt.toFixed(2)}</span>
        </div>
        <div class="total-row" style="padding:6px 8px;border-bottom:none;background:#f1f5f9;border-radius:4px;">
          <span style="color:${balanceAmt > 0 ? '#dc2626' : '#059669'};font-weight:700;">Dues</span>
          <span style="font-weight:900;color:${balanceAmt > 0 ? '#dc2626' : '#059669'};">${symbol}${balanceAmt.toFixed(2)}</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

    const pdf = require('../utils/purchaseInvoicePdf').buildPurchaseInvoicePdf(html, {
      currency, symbol, logo: require('../utils/documentLogo')
    });
    const filename = `Purchase-Invoice-${invoice.invoiceNumber}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${filename}.pdf"`);
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.send(Buffer.from(pdf.output('arraybuffer')));
  } catch (err) {
    console.error('Public Invoice View error:', err);
    return res
      .status(500)
      .send(
        '<h2 style="font-family:sans-serif;text-align:center;margin-top:50px;">Error loading Purchase Invoice</h2>'
      );
  }
};

const generateGRNNumber = async () => {
  const year = new Date().getFullYear();
  const last = await GoodsReceipt.findOne({
    grnNumber: new RegExp(`^GRN-${year}/`)
  }).sort({ createdAt: -1 });

  let next = 1;
  if (last?.grnNumber) {
    const parts = last.grnNumber.split('/');
    if (parts[1]) next = parseInt(parts[1], 10) + 1;
  }

  let grnNumber = `GRN-${year}/${String(next).padStart(3, '0')}`;
  while (await GoodsReceipt.exists({ grnNumber })) {
    next++;
    grnNumber = `GRN-${year}/${String(next).padStart(3, '0')}`;
  }
  return grnNumber;
};

const generateConsolidatedInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const last = await ConsolidatedInvoice.findOne({
    invoiceNumber: new RegExp(`^(PI|CI)-${year}/`)
  }).sort({ createdAt: -1 });

  let next = 1;
  if (last?.invoiceNumber) {
    const parts = last.invoiceNumber.split('/');
    if (parts[1]) next = parseInt(parts[1], 10) + 1;
  }

  let invoiceNumber = `PI-${year}/${String(next).padStart(3, '0')}`;
  while (await ConsolidatedInvoice.exists({ invoiceNumber })) {
    next++;
    invoiceNumber = `PI-${year}/${String(next).padStart(3, '0')}`;
  }
  return invoiceNumber;
};

// ============================================
// CREATE GRN
// ============================================
exports.createGRN = async (req, res) => {
  try {
    const {
      purchaseOrderId,
      poNumber,
      supplierId,
      supplierName,
      supplierGST,
      supplierAddress,
      supplierContact,
      supplierEmail,
      receivedDate,
      receivedBy,
      warehouse,
      items,
      notes,
      currency,
      exchangeRate,
      freight,
      insurance,
      inventoryCharges,
      gstType,
      initialPayment
    } = req.body;

    if (!purchaseOrderId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Purchase Order and at least one item are required'
      });
    }

    const po = await PurchaseOrder.findById(purchaseOrderId);
    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase Order not found'
      });
    }

    let finalSupplierName =
      supplierName && supplierName.trim() !== '' && supplierName !== 'N/A'
        ? supplierName.trim()
        : '';
    if (!finalSupplierName && po) {
      finalSupplierName =
        po.supplierName || po.supplier?.companyName || po.supplier?.name || '';
    }
    const possibleSupId =
      supplierId || po?.supplierId || po?.supplier?._id || po?.supplier;
    if (!finalSupplierName && possibleSupId) {
      try {
        const supDoc = await mongoose.connection
          .collection('suppliers')
          .findOne({
            _id: mongoose.isValidObjectId(possibleSupId)
              ? new mongoose.Types.ObjectId(possibleSupId)
              : possibleSupId
          });
        if (supDoc) {
          finalSupplierName =
            supDoc.companyName || supDoc.name || supDoc.supplierName || '';
        }
      } catch (err) {
        console.log('Supplier DB Lookup Error:', err.message);
      }
    }
    if (!finalSupplierName) finalSupplierName = 'Vendor / Supplier';

    const poCurrency = currency || po.currency || 'INR';
    const effExchangeRate = Number(exchangeRate || po.exchangeRate || 1) || 1;

    if (po.status === 'cancelled') fail('Cannot receive a cancelled purchase order.');
    const requestId = String(req.body.receiptRequestId || '').trim();
    if (requestId) {
      const previous = await GoodsReceipt.findOne({
        purchaseOrder: purchaseOrderId,
        receiptRequestIds: requestId
      });
      if (previous) {
        if (previous.status !== 'completed') fail('This receipt was reversed. Start a new receipt.');
        return res.status(200).json({
          success: true,
          data: previous,
          message: 'Receipt already saved.'
        });
      }
    }
    let existingGRN = await GoodsReceipt.findOne({
      purchaseOrder: purchaseOrderId,
      status: 'completed'
    });
    const receiptContext = existingGRN
      ? {
          ...plain(existingGRN),
          receivedDate: receivedDate || existingGRN.receivedDate
        }
      : {
          _id: new mongoose.Types.ObjectId(),
          grnNumber: await generateGRNNumber(),
          purchaseOrder: po._id,
          poNumber: po.poNumber,
          supplierName: finalSupplierName,
          supplierId: possibleSupId,
          receivedDate: receivedDate || new Date().toISOString().split('T')[0],
          currency: poCurrency,
          exchangeRate: effExchangeRate
        };
    const lineReceived = new Map();
    const isFirstReceipt = !existingGRN;

    let subtotal = 0;
    let itemsTax = 0;
    const processedItems = [];

    for (const item of items) {
      const receivedQty = quantityOf(item);
      if (!Number.isFinite(receivedQty) || receivedQty < 0) fail('Invalid received quantity.');
      if (receivedQty <= 0) continue;

      let product = null;
      if (item.productId && mongoose.isValidObjectId(item.productId)) {
        product = await Product.findById(item.productId);
      }
      if (!product && item.productId) {
        product = await Product.findOne({
          $or: [
            { productId: item.productId },
            { sku: item.productId },
            { productCode: item.productId },
            { code: item.productId },
            { 'basicInfo.sku': item.productId }
          ]
        });
      }
      if (!product && item.sku) {
        product = await Product.findOne({
          $or: [{ sku: item.sku }, { 'basicInfo.sku': item.sku }]
        });
      }
      if (!product && item.productName) {
        product = await Product.findOne({
          $or: [{ name: item.productName }, { 'basicInfo.name': item.productName }]
        });
      }

      if (!product) fail(`Product not found: ${item.productName || item.productId}`);
      const line = purchaseLine(po, { ...item, productId: product._id });
      const key = idOf(line._id);
      const already = Number(line.receivedQty || 0);
      if (item.alreadyReceived !== undefined && Number(item.alreadyReceived) !== already) {
        fail('This purchase has been received since you opened it. Select the purchase again.');
      }
      const receivedNow = (lineReceived.get(key) || 0) + receivedQty;
      if (already + receivedNow > Number(line.quantity)) {
        fail(`Received quantity exceeds pending quantity for ${product.name}.`);
      }
      lineReceived.set(key, receivedNow);
      validateItem(item, product);
      const rate = Number(item.unitPrice ?? line.unitPrice) || 0;
      const taxRate = Number(item.taxRate ?? line.taxRate) || 0;
      const itemSubtotal = receivedQty * rate;
      const itemTax = (itemSubtotal * taxRate) / 100;
      subtotal += itemSubtotal;
      itemsTax += itemTax;
      const userMfgDate = item.mfgDate || '';
      const userExpDate = item.expDate || '';
      const rawMrp = Number(item.mrp) || 0;
      const rawSellingPrice = Number(item.sellingPrice) || 0;

      const orderedQty = Number(line.quantity);
      const alreadyReceived = already;
      const remainingQty = Math.max(0, orderedQty - alreadyReceived - receivedQty);

      const processedItem = {
        _id: new mongoose.Types.ObjectId(),
        purchaseOrderItemId: line._id,
        productId: product?._id || (mongoose.isValidObjectId(item.productId) ? item.productId : null),
        productName: item.productName || product?.name || '',
        sku: item.sku || product?.sku || '',
        hsn: item.hsn || product?.hsn || '',
        unit: item.unit || product?.unit || 'Strips',
        orderedQty,
        alreadyReceived,
        receivedQty,
        acceptedQty: receivedQty,
        rejectedQty: 0,
        remainingQty,
        batchNumber: item.batchNumber || 'N/A',
        mfgDate: userMfgDate,
        expDate: userExpDate,
        unitPrice: rate,
        supplierName: finalSupplierName, // ✅ ADDED: Supplier name on each item
        supplier: possibleSupId || null, // ✅ ADDED: Supplier ID on each item
        mrp:
          rawMrp > 0
            ? rawMrp
            : Number(product.pricing?.mrp || 0) / (poCurrency !== 'INR' ? effExchangeRate : 1),
        sellingPrice:
          rawSellingPrice > 0
            ? rawSellingPrice
            : Number(product.pricing?.sellingPrice || 0) / (poCurrency !== 'INR' ? effExchangeRate : 1) ||
              Number((rate * 1.2).toFixed(2)),
        taxRate,
        subtotal: itemSubtotal,
        tax: itemTax,
        totalWithTax: itemSubtotal + itemTax,
        remarks: item.remarks || ''
      };
      applyReceiptStock(
        product,
        null,
        processedItem,
        receiptContext,
        req.user?.name || receivedBy || 'System'
      );
      await product.save();
      processedItems.push(processedItem);
    }

    if (processedItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid items with received quantity found'
      });
    }

    let payAmt = 0;
    let paymentEntry = null;
    if (initialPayment && Number(initialPayment.amount) > 0) {
      payAmt = Number(initialPayment.amount);
      paymentEntry = {
        date: initialPayment.date || new Date().toISOString().split('T')[0],
        amount: payAmt,
        method: initialPayment.method || 'bank',
        reference: initialPayment.reference || '',
        notes: initialPayment.notes || 'Payment on GRN',
        receivedBy: req.user?.name || 'System'
      };
    }

    let grn;
    let overpaymentCredit = 0;

    if (isFirstReceipt) {
      const grnNumber = receiptContext.grnNumber;

      const freightData = {
        amount: Number(freight?.amount) || 0,
        taxRate: Number(freight?.taxRate) || 0,
        taxAmount: ((Number(freight?.amount) || 0) * (Number(freight?.taxRate) || 0)) / 100
      };
      const insuranceData = {
        amount: Number(insurance?.amount) || 0,
        taxRate: Number(insurance?.taxRate) || 0,
        taxAmount: ((Number(insurance?.amount) || 0) * (Number(insurance?.taxRate) || 0)) / 100
      };
      const inventoryData = {
        amount: Number(inventoryCharges?.amount) || 0,
        taxRate: Number(inventoryCharges?.taxRate) || 0,
        taxAmount:
          ((Number(inventoryCharges?.amount) || 0) * (Number(inventoryCharges?.taxRate) || 0)) / 100
      };

      const chargesSubtotal =
        freightData.amount + insuranceData.amount + inventoryData.amount;
      const chargesTax =
        freightData.taxAmount + insuranceData.taxAmount + inventoryData.taxAmount;

      const totalTax = itemsTax + chargesTax;
      const exactTotal = subtotal + chargesSubtotal + totalTax;
      const isInternational = poCurrency && poCurrency !== 'INR';
      const grandTotal = isInternational
        ? Number(exactTotal.toFixed(2))
        : Math.round(exactTotal);
      const roundOff = isInternational
        ? 0
        : Number((grandTotal - exactTotal).toFixed(2));

      grn = new GoodsReceipt({
        _id: receiptContext._id,
        grnNumber,
        purchaseOrder: purchaseOrderId,
        poNumber: poNumber || po.poNumber,
        supplierId: possibleSupId,
        supplierName: finalSupplierName,
        supplierGST: supplierGST || po.supplierGST || '',
        supplierAddress: supplierAddress || po.supplierAddress || '',
        supplierContact: supplierContact || po.supplierContact || '',
        supplierEmail: supplierEmail || po.supplierEmail || '',
        receivedDate: receivedDate || new Date().toISOString().split('T')[0],
        receivedBy: receivedBy || req.user?.name || '',
        warehouse: warehouse || 'Main Warehouse',
        items: processedItems,
        notes: notes || '',
        status: 'completed',
        createdBy: req.user?.id || req.user?._id,
        currency: poCurrency,
        exchangeRate: effExchangeRate,
        subtotal,
        totalTax,
        chargesSubtotal,
        chargesTax,
        roundOff,
        grandTotal,
        freight: freightData,
        insurance: insuranceData,
        inventoryCharges: inventoryData,
        gstType: gstType || po.gstType || 'igst',
        chargesApplied: true,
        paidAmount: payAmt,
        payments: paymentEntry ? [paymentEntry] : [],
        invoiceGenerated: false
      });

      if (payAmt > grandTotal) overpaymentCredit = payAmt - grandTotal;
    } else {
      grn = existingGRN;
      const mergedItems = [...(grn.items || [])];

      mergedItems.push(...processedItems);

      let newSubtotal = 0;
      let newItemsTax = 0;
      mergedItems.forEach((item) => {
        newSubtotal += item.subtotal || 0;
        newItemsTax += item.tax || 0;
      });

      const cSub = Number(grn.chargesSubtotal || 0);
      const cTax = Number(grn.chargesTax || 0);
      const newTotalTax = newItemsTax + cTax;

      grn.items = mergedItems;
      grn.subtotal = newSubtotal;
      grn.totalTax = newTotalTax;

      const exactTotal = newSubtotal + cSub + newTotalTax;
      const curr = grn.currency || poCurrency;
      const isInternational = curr && curr !== 'INR';
      grn.grandTotal = isInternational
        ? Number(exactTotal.toFixed(2))
        : Math.round(exactTotal);
      grn.roundOff = isInternational
        ? 0
        : Number((grn.grandTotal - exactTotal).toFixed(2));

      if (paymentEntry) {
        if (!Array.isArray(grn.payments)) grn.payments = [];
        grn.payments.push(paymentEntry);
        grn.paidAmount = (grn.paidAmount || 0) + payAmt;
      }

      if (grn.paidAmount > grn.grandTotal) {
        overpaymentCredit = grn.paidAmount - grn.grandTotal;
      }
      grn.receivedDate = receivedDate || grn.receivedDate;
      grn.notes = notes ? `${grn.notes ? grn.notes + ' | ' : ''}${notes}` : grn.notes;
    }

    if (requestId) grn.receiptRequestIds.push(requestId);
    await grn.save();

    const allReceipts = await GoodsReceipt.find({
      purchaseOrder: po._id,
      status: 'completed'
    });
    syncPurchaseQuantities(po, allReceipts);
    if (po.status === 'delivered') {
      po.deliveryDate = receivedDate || new Date().toISOString().split('T')[0];
    }
    const currentReceipt = allReceipts.find(
      (receipt) => idOf(receipt._id) === idOf(grn._id)
    );
    if (currentReceipt) grn.items = currentReceipt.items;

    if (overpaymentCredit > 0) {
      po.creditAmount = (Number(po.creditAmount) || 0) + overpaymentCredit;
    }
    await po.save();

    // Consolidated Purchase Invoice (PI)
    let existingInvoice = await ConsolidatedInvoice.findOne({
      purchaseOrder: purchaseOrderId
    });

    if (!existingInvoice) {
      const invoiceNumber = await generateConsolidatedInvoiceNumber();
      existingInvoice = new ConsolidatedInvoice({
        invoiceNumber,
        grnIds: [grn._id],
        poNumber: poNumber || po.poNumber,
        purchaseOrder: purchaseOrderId,
        supplierId: possibleSupId,
        supplierName: finalSupplierName,
        supplierGST: supplierGST || po.supplierGST || '',
        supplierAddress: supplierAddress || po.supplierAddress || '',
        supplierContact: supplierContact || po.supplierContact || '',
        supplierEmail: supplierEmail || po.supplierEmail || '',
        invoiceDate: receivedDate || new Date().toISOString().split('T')[0],
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0],
        items: [...grn.items],
        subtotal: grn.subtotal,
        totalTax: grn.totalTax,
        chargesSubtotal: grn.chargesSubtotal,
        chargesTax: grn.chargesTax,
        roundOff: grn.roundOff,
        grandTotal: grn.grandTotal,
        freight: grn.freight,
        insurance: grn.insurance,
        inventoryCharges: grn.inventoryCharges,
        gstType: gstType || po.gstType || 'igst',
        currency: poCurrency,
        exchangeRate: effExchangeRate,
        paidAmount: grn.paidAmount || 0,
        payments: grn.payments || [],
        remainingAmount: Math.max(0, grn.grandTotal - (grn.paidAmount || 0)),
        paymentStatus:
          (grn.paidAmount || 0) >= grn.grandTotal
            ? 'paid'
            : grn.paidAmount > 0
            ? 'partial'
            : 'pending',
        status: (grn.paidAmount || 0) >= grn.grandTotal ? 'paid' : 'generated',
        notes: notes || '',
        createdBy: req.user?.id || req.user?._id,
        receiptCount: 1
      });
      settleInvoice(existingInvoice);
      await existingInvoice.save();
    } else {
      existingInvoice.items = grn.items;
      existingInvoice.subtotal = grn.subtotal;
      existingInvoice.totalTax = grn.totalTax;
      existingInvoice.chargesSubtotal = grn.chargesSubtotal;
      existingInvoice.chargesTax = grn.chargesTax;
      existingInvoice.roundOff = grn.roundOff;
      existingInvoice.grandTotal = grn.grandTotal;
      existingInvoice.freight = grn.freight;
      existingInvoice.insurance = grn.insurance;
      existingInvoice.inventoryCharges = grn.inventoryCharges;
      existingInvoice.paidAmount = grn.paidAmount || 0;
      existingInvoice.remainingAmount = Math.max(
        0,
        grn.grandTotal - (grn.paidAmount || 0)
      );
      existingInvoice.paymentStatus =
        (grn.paidAmount || 0) >= grn.grandTotal
          ? 'paid'
          : grn.paidAmount > 0
          ? 'partial'
          : 'pending';
      existingInvoice.status =
        (grn.paidAmount || 0) >= grn.grandTotal ? 'paid' : 'generated';
      existingInvoice.payments = grn.payments || [];
      existingInvoice.receiptCount = (existingInvoice.receiptCount || 0) + 1;
      settleInvoice(existingInvoice);
      await existingInvoice.save();
    }

    grn.consolidatedInvoiceId = existingInvoice._id;
    grn.invoiceGenerated = true;
    grn.invoiceId = existingInvoice._id;
    await grn.save();

    res.status(201).json({
      success: true,
      data: grn,
      consolidatedInvoice: existingInvoice,
      message: `GRN ${grn.grnNumber} saved successfully.`
    });
  } catch (error) {
    console.error('❌ Create GRN error:', error);
    throw error;
  }
};

// ============================================
// UPDATE GRN
// ============================================
exports.updateGRN = async (req, res) => {
  try {
    const grn = await GoodsReceipt.findById(req.params.id);
    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    const {
      items,
      notes,
      receivedDate,
      receivedBy,
      warehouse,
      freight,
      insurance,
      inventoryCharges,
      gstType
    } = req.body;

    if (receivedDate !== undefined) grn.receivedDate = receivedDate;
    if (receivedBy !== undefined) grn.receivedBy = receivedBy;
    if (warehouse !== undefined) grn.warehouse = warehouse;
    if (notes !== undefined) grn.notes = notes;
    if (gstType !== undefined) grn.gstType = gstType;

    if (freight) {
      const amt = Number(freight.amount) || 0;
      const rate = Number(freight.taxRate) || 0;
      grn.freight = { amount: amt, taxRate: rate, taxAmount: (amt * rate) / 100 };
    }
    if (insurance) {
      const amt = Number(insurance.amount) || 0;
      const rate = Number(insurance.taxRate) || 0;
      grn.insurance = { amount: amt, taxRate: rate, taxAmount: (amt * rate) / 100 };
    }
    if (inventoryCharges) {
      const amt = Number(inventoryCharges.amount) || 0;
      const rate = Number(inventoryCharges.taxRate) || 0;
      grn.inventoryCharges = { amount: amt, taxRate: rate, taxAmount: (amt * rate) / 100 };
    }

    if (Array.isArray(items)) await updateReceiptItems(grn, items, req.user?.name || 'System');
    recalculateReceipt(grn);
    await grn.save();

    let inv = null;
    if (grn.consolidatedInvoiceId) {
      inv = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
    }
    if (!inv && grn.purchaseOrder) {
      inv = await ConsolidatedInvoice.findOne({ purchaseOrder: grn.purchaseOrder });
    }

    if (inv) {
      if (notes !== undefined) inv.notes = notes;
      if (receivedDate !== undefined) inv.invoiceDate = receivedDate;
      inv.subtotal = grn.subtotal;
      inv.totalTax = grn.totalTax;
      inv.chargesSubtotal = grn.chargesSubtotal;
      inv.chargesTax = grn.chargesTax;
      inv.roundOff = grn.roundOff;
      inv.grandTotal = grn.grandTotal;
      inv.freight = grn.freight;
      inv.insurance = grn.insurance;
      inv.inventoryCharges = grn.inventoryCharges;
      inv.items = grn.items;
      inv.gstType = grn.gstType;
      inv.remainingAmount = Math.max(0, inv.grandTotal - (Number(inv.paidAmount) || 0));
      inv.paymentStatus =
        (inv.paidAmount || 0) >= inv.grandTotal
          ? 'paid'
          : inv.paidAmount > 0
          ? 'partial'
          : 'pending';
      inv.status = (inv.paidAmount || 0) >= inv.grandTotal ? 'paid' : 'generated';
      settleInvoice(inv);
      await inv.save();
    }

    res.json({
      success: true,
      data: grn,
      message: `GRN ${grn.grnNumber} updated successfully`
    });
  } catch (error) {
    console.error('❌ Update GRN error:', error);
    throw error;
  }
};

// ============================================
// UPDATE PURCHASE INVOICE
// ============================================
exports.updateConsolidatedInvoice = async (req, res) => {
  try {
    const invoice = await ConsolidatedInvoice.findById(req.params.invoiceId);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Purchase Invoice not found' });
    }

    const {
      dueDate,
      notes,
      invoiceDate,
      paymentTerms,
      supplierGST,
      supplierContact,
      supplierAddress,
      items,
      freight,
      insurance,
      inventoryCharges,
      gstType
    } = req.body;

    for (const charge of [freight, insurance, inventoryCharges]) {
      if (
        charge &&
        (!Number.isFinite(Number(charge.amount)) ||
          Number(charge.amount) < 0 ||
          !Number.isFinite(Number(charge.taxRate)) ||
          Number(charge.taxRate) < 0 ||
          Number(charge.taxRate) > 100)
      ) {
        fail('Charges must be non-negative and GST must be between 0 and 100%.');
      }
    }

    if (gstType !== undefined && !['igst', 'cgst_sgst'].includes(gstType)) {
      fail('Invalid GST type.');
    }
    if (dueDate !== undefined) invoice.dueDate = dueDate;
    if (notes !== undefined) invoice.notes = notes;
    if (invoiceDate !== undefined) invoice.invoiceDate = invoiceDate;
    if (paymentTerms !== undefined) invoice.paymentTerms = paymentTerms;
    if (supplierGST !== undefined) invoice.supplierGST = supplierGST;
    if (supplierContact !== undefined) invoice.supplierContact = supplierContact;
    if (supplierAddress !== undefined) invoice.supplierAddress = supplierAddress;
    if (gstType !== undefined) invoice.gstType = gstType;

    // Resilient GRN lookup (via grnIds, consolidatedInvoiceId, invoiceId, or purchaseOrder)
    let grn = null;
    if (invoice.grnIds && invoice.grnIds.length > 0) {
      grn = await GoodsReceipt.findOne({ _id: { $in: invoice.grnIds }, status: 'completed' });
    }
    if (!grn) {
      grn = await GoodsReceipt.findOne({
        $or: [{ consolidatedInvoiceId: invoice._id }, { invoiceId: invoice._id }],
        status: 'completed'
      });
    }
    if (!grn && invoice.purchaseOrder) {
      grn = await GoodsReceipt.findOne({
        purchaseOrder: invoice.purchaseOrder,
        status: 'completed'
      });
    }

    if (Array.isArray(items)) {
      if (grn) {
        await updateReceiptItems(
          grn,
          items.map((item) => ({
            ...item,
            receivedQty: item.acceptedQty ?? item.receivedQty ?? item.quantity
          })),
          req.user?.name || 'System'
        );
        await grn.save();

        invoice.items = grn.items;
        invoice.subtotal = grn.subtotal;
        invoice.totalTax = grn.items.reduce((sum, item) => sum + Number(item.tax || 0), 0);
      } else {
        // Fallback for standalone/legacy invoices without active GRN
        let subtotal = 0;
        let itemsTax = 0;
        invoice.items = items.map((item) => {
          const qty = Number(item.acceptedQty ?? item.receivedQty ?? item.quantity ?? 0);
          const rate = Number(item.unitPrice || item.rate || 0);
          const taxRate = Number(item.taxRate || 0);
          const lineSub = qty * rate;
          const lineTax = (lineSub * taxRate) / 100;
          subtotal += lineSub;
          itemsTax += lineTax;
          return {
            ...item,
            receivedQty: qty,
            acceptedQty: qty,
            quantity: qty,
            unitPrice: rate,
            taxRate,
            subtotal: lineSub,
            tax: lineTax,
            totalWithTax: lineSub + lineTax
          };
        });
        invoice.subtotal = subtotal;
        invoice.totalTax = itemsTax;
      }
    }

    if (freight) {
      const amt = Number(freight.amount) || 0;
      const rate = Number(freight.taxRate) || 0;
      invoice.freight = { amount: amt, taxRate: rate, taxAmount: (amt * rate) / 100 };
    }
    if (insurance) {
      const amt = Number(insurance.amount) || 0;
      const rate = Number(insurance.taxRate) || 0;
      invoice.insurance = { amount: amt, taxRate: rate, taxAmount: (amt * rate) / 100 };
    }
    if (inventoryCharges) {
      const amt = Number(inventoryCharges.amount) || 0;
      const rate = Number(inventoryCharges.taxRate) || 0;
      invoice.inventoryCharges = { amount: amt, taxRate: rate, taxAmount: (amt * rate) / 100 };
    }

    const cSub =
      (Number(invoice.freight?.amount) || 0) +
      (Number(invoice.insurance?.amount) || 0) +
      (Number(invoice.inventoryCharges?.amount) || 0);
    const cTax =
      (Number(invoice.freight?.taxAmount) || 0) +
      (Number(invoice.insurance?.taxAmount) || 0) +
      (Number(invoice.inventoryCharges?.taxAmount) || 0);

    invoice.chargesSubtotal = cSub;
    invoice.chargesTax = cTax;
    invoice.totalTax =
      invoice.items.reduce((sum, item) => sum + Number(item.tax || 0), 0) + cTax;

    const exactTotal = (Number(invoice.subtotal) || 0) + cSub + invoice.totalTax;
    const isInternational = invoice.currency && invoice.currency !== 'INR';
    invoice.grandTotal = isInternational ? Number(exactTotal.toFixed(2)) : Math.round(exactTotal);
    invoice.roundOff = isInternational
      ? 0
      : Number((invoice.grandTotal - exactTotal).toFixed(2));

    const paymentCorrected = require('../utils/correctInvoicePayment')(invoice, req.body, req.user?.name || 'System');
    if (paymentCorrected) {
      const linkedReceipts = await GoodsReceipt.find({ $or: [{ _id: { $in: invoice.grnIds || [] } }, { invoiceId: invoice._id }, { consolidatedInvoiceId: invoice._id }] });
      if (linkedReceipts.length > 1) fail('This invoice combines multiple receipts. Correct its receipt-level payments individually.');
      await JournalEntry.deleteMany({ sourceModule: 'payment_disbursement', sourceId: invoice._id });
    }
    const returnCredit = Number(invoice.returnCredit || 0);
    const paidAmt = Number(invoice.paidAmount) || 0;
    invoice.remainingAmount = Math.max(0, invoice.grandTotal - returnCredit - paidAmt);
    invoice.paymentStatus =
      paidAmt + returnCredit >= invoice.grandTotal
        ? 'paid'
        : paidAmt > 0
        ? 'partial'
        : 'pending';
    invoice.status = invoice.paymentStatus === 'paid' ? 'paid' : 'generated';

    settleInvoice(invoice);
    invoice.markModified('items');
    await invoice.save();

    // Mirror synced totals back to the GRN
    if (grn) {
      if (paymentCorrected) {
        grn.payments = invoice.payments.map(plain);
        grn.paidAmount = invoice.paidAmount;
      }
      grn.subtotal = invoice.subtotal;
      grn.totalTax = invoice.totalTax;
      grn.chargesSubtotal = invoice.chargesSubtotal;
      grn.chargesTax = invoice.chargesTax;
      grn.roundOff = invoice.roundOff;
      grn.grandTotal = invoice.grandTotal;
      grn.freight = invoice.freight;
      grn.insurance = invoice.insurance;
      grn.inventoryCharges = invoice.inventoryCharges;
      grn.items = invoice.items;
      grn.gstType = invoice.gstType;
      if (!grn.consolidatedInvoiceId) grn.consolidatedInvoiceId = invoice._id;
      if (!grn.invoiceId) grn.invoiceId = invoice._id;
      grn.markModified('items');
      await grn.save();
    }

    res.json({
      success: true,
      data: invoice,
      message: `Invoice ${invoice.invoiceNumber} fully updated successfully`
    });
  } catch (error) {
    console.error('❌ Update consolidated invoice error:', error);
    throw error;
  }
};

// ============================================
// DELETE PURCHASE INVOICE
// ============================================
exports.getInvoiceDeletionContext = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.invoiceId)) return res.status(400).json({ success: false, message: 'Valid Invoice ID is required' });
    const invoice = await ConsolidatedInvoice.findById(req.params.invoiceId);
    if (!invoice) return res.status(404).json({ success: false, message: 'Purchase Invoice not found' });
    const receipts = await GoodsReceipt.find({ $or: [
      { _id: { $in: [...(invoice.grnIds || []), ...(invoice.grnId ? [invoice.grnId] : [])] } },
      { consolidatedInvoiceId: invoice._id }, { invoiceId: invoice._id }
    ] }).select('purchaseOrder');
    const purchaseOrder = await PurchaseOrder.findOne({ _id: { $in: [invoice.purchaseOrder, ...receipts.map(row => row.purchaseOrder)].filter(Boolean) } })
      .select('poNumber supplierName total currency');
    return res.json({ success: true, data: { purchaseOrder } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteConsolidatedInvoice = async (req, res) => {
  try {
    const invoiceId =
      req.params.invoiceId ||
      req.params.id ||
      req.query.invoiceId ||
      req.query.id ||
      req.body?.invoiceId;
    if (!invoiceId || !mongoose.isValidObjectId(invoiceId)) {
      return res.status(400).json({ success: false, message: 'Valid Invoice ID is required' });
    }

    const invoice = await ConsolidatedInvoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Purchase Invoice not found' });
    }

    await require('../utils/deletePurchaseInvoice')(invoice, req.user?.name || 'System');

    return res.json({
      success: true,
      message:
        'Purchase invoice and related entries deleted. Stock reversed.'
    });
  } catch (error) {
    console.error('❌ Delete Invoice error:', error);
    throw error;
  }
};

// ============================================
// ADD PAYMENT
// ============================================
exports.addPayment = async (req, res) => {
  try {
    const id = req.params.id || req.params.grnId || req.params.invoiceId;
    const {
      date,
      paymentDate,
      amount,
      method,
      paymentMethod,
      reference,
      transactionId,
      notes
    } = req.body;

    const paymentAmount = Number(amount) || 0;
    if (paymentAmount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: 'Payment amount must be greater than 0' });
    }

    let grn = null;
    let invoice = null;

    if (mongoose.isValidObjectId(id)) {
      grn = await GoodsReceipt.findById(id);
      if (grn) {
        if (grn.consolidatedInvoiceId) {
          invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
        }
        if (!invoice) {
          invoice = await ConsolidatedInvoice.findOne({ purchaseOrder: grn.purchaseOrder });
        }
      } else {
        invoice = await ConsolidatedInvoice.findById(id);
        if (invoice) {
          grn = await GoodsReceipt.findOne({ consolidatedInvoiceId: invoice._id });
        }
      }
    }

    if (!grn && !invoice) {
      return res
        .status(404)
        .json({ success: false, message: 'Goods Receipt or Invoice record not found' });
    }

    const cleanMethod = (method || paymentMethod || 'bank')
      .toLowerCase()
      .replace(/\s+/g, '_');
    const paymentEntry = {
      _id: new mongoose.Types.ObjectId(),
      date: date || paymentDate || new Date().toISOString().split('T')[0],
      amount: paymentAmount,
      method: cleanMethod,
      reference: reference || transactionId || '',
      notes: notes || '',
      receivedBy: req.user?.name || 'System'
    };

    if (grn) {
      if (!Array.isArray(grn.payments)) grn.payments = [];
      grn.payments.push(paymentEntry);
      grn.paidAmount = (Number(grn.paidAmount) || 0) + paymentAmount;
      await grn.save();
    }

    if (invoice) {
      if (!Array.isArray(invoice.payments)) invoice.payments = [];
      invoice.payments.push(paymentEntry);
      invoice.paidAmount = (Number(invoice.paidAmount) || 0) + paymentAmount;
      invoice.remainingAmount = Math.max(0, (invoice.grandTotal || 0) - invoice.paidAmount);
      invoice.paymentStatus =
        invoice.remainingAmount <= 0
          ? 'paid'
          : invoice.paidAmount > 0
          ? 'partial'
          : 'pending';
      invoice.status = invoice.paymentStatus === 'paid' ? 'paid' : 'generated';
      settleInvoice(invoice);
      await invoice.save();
    }

    return res.json({
      success: true,
      data: grn || invoice,
      message: `✅ Payment of ${paymentAmount} recorded and journal disbursement synced successfully!`
    });
  } catch (error) {
    console.error('❌ Add payment error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.addConsolidatedPayment = exports.addPayment;

// ============================================
// GET CONSOLIDATED INVOICES
// ============================================
exports.getConsolidatedInvoices = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 15,
      search,
      supplierId,
      paymentStatus,
      startDate,
      endDate
    } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { poNumber: { $regex: search, $options: 'i' } },
        { supplierName: { $regex: search, $options: 'i' } }
      ];
    }
    if (supplierId) query.supplierId = supplierId;
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (startDate || endDate) {
      query.invoiceDate = {};
      if (startDate) query.invoiceDate.$gte = startDate;
      if (endDate) query.invoiceDate.$lte = endDate;
    }

    const invoices = await ConsolidatedInvoice.find(query)
      .populate('createdBy', 'name')
      .populate('supplierId', 'companyName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await ConsolidatedInvoice.countDocuments(query);
    const stats = await ConsolidatedInvoice.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalInvoices: { $sum: 1 },
          totalValue: { $sum: '$grandTotal' },
          totalPaid: { $sum: '$paidAmount' },
          totalRemaining: { $sum: '$remainingAmount' },
          totalReceipts: { $sum: '$receiptCount' }
        }
      }
    ]);

    res.json({
      success: true,
      data: invoices,
      stats: stats[0] || {
        totalInvoices: 0,
        totalValue: 0,
        totalPaid: 0,
        totalRemaining: 0,
        totalReceipts: 0
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getConsolidatedInvoice = async (req, res) => {
  try {
    const invoice = await ConsolidatedInvoice.findById(req.params.invoiceId)
      .populate('createdBy', 'name email')
      .populate('supplierId', 'companyName gstNumber phone email address')
      .populate('purchaseOrder', 'poNumber status expectedDate creditAmount');

    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    const grns = await GoodsReceipt.find({ consolidatedInvoiceId: invoice._id }).select(
      'grnNumber receivedDate items subtotal grandTotal status'
    );

    res.json({ success: true, data: { ...invoice.toObject(), grns } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET GOODS RECEIPTS (GRN)
// ============================================
exports.getGRNs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 15,
      search,
      startDate,
      endDate,
      supplierId,
      status
    } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { grnNumber: { $regex: search, $options: 'i' } },
        { poNumber: { $regex: search, $options: 'i' } },
        { supplierName: { $regex: search, $options: 'i' } }
      ];
    }
    if (supplierId) query.supplierId = supplierId;
    if (status) query.status = status;
    if (startDate || endDate) {
      query.receivedDate = {};
      if (startDate) query.receivedDate.$gte = startDate;
      if (endDate) query.receivedDate.$lte = endDate;
    }

    const grns = await GoodsReceipt.find(query)
      .populate('createdBy', 'name')
      .populate('supplierId', 'companyName gstNumber phone email')
      .populate('consolidatedInvoiceId', 'invoiceNumber paymentStatus')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await GoodsReceipt.countDocuments(query);
    const stats = await GoodsReceipt.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalGRNs: { $sum: 1 },
          totalItems: { $sum: { $size: '$items' } },
          totalValue: { $sum: '$grandTotal' },
          avgValue: { $avg: '$grandTotal' }
        }
      }
    ]);

    res.json({
      success: true,
      data: grns,
      stats: stats[0] || { totalGRNs: 0, totalItems: 0, totalValue: 0, avgValue: 0 },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getGRN = async (req, res) => {
  try {
    const grn = await GoodsReceipt.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('purchaseOrder', 'poNumber status expectedDate items total creditAmount')
      .populate('supplierId', 'companyName gstNumber phone email address')
      .populate(
        'consolidatedInvoiceId',
        'invoiceNumber paymentStatus payments grandTotal paidAmount remainingAmount'
      );

    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });
    const po = grn.purchaseOrder;
    const totalOrdered =
      po?.items?.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0) || 0;
    const totalReceived =
      po?.items?.reduce((sum, i) => sum + (Number(i.receivedQty) || 0), 0) || 0;

    res.json({
      success: true,
      data: {
        ...grn.toObject(),
        paidAmount: grn.paidAmount || 0,
        payments: grn.payments || [],
        poSummary: {
          totalOrdered,
          totalReceived,
          remainingQty: totalOrdered - totalReceived,
          receivedPercentage:
            totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0,
          poGrandTotal: po?.total || 0,
          creditAmount: po?.creditAmount || 0
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// DELETE GRN
// ============================================
exports.deleteGRN = async (req, res) => {
  try {
    const grn = await GoodsReceipt.findById(req.params.id);
    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });

    const invoice = await ConsolidatedInvoice.findOne({ $or: [
      { _id: { $in: [grn.consolidatedInvoiceId, grn.invoiceId].filter(Boolean) } },
      { grnIds: grn._id }, { grnId: grn._id }
    ] });
    if (invoice) {
      await require('../utils/deletePurchaseInvoice')(invoice, req.user?.name || 'System');
      return res.json({ success: true, message: 'Invoice and related entries deleted. Stock reversed.' });
    }
    if (await require('../utils/deleteOrphanReceipt')(grn, req.user?.name || 'System')) {
      return res.json({ success: true, message: 'Leftover receipts and payments removed. Original and replacement stock reconciled from receipt history.' });
    }
    await JournalEntry.deleteMany({ sourceId: grn._id, sourceModule: { $in: ['purchase_invoice', 'payment_disbursement'] } });
    await reverseReceipt(grn, req.user?.name || 'System');

    await grn.deleteOne();
    res.json({
      success: true,
      message: 'GRN and linked journals deleted successfully with stock reversal'
    });
  } catch (error) {
    throw error;
  }
};

// ============================================
// RECEIPT DASHBOARD
// ============================================
exports.getReceiptDashboard = async (req, res) => {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const [
      totalGRNs,
      weeklyGRNs,
      bySupplier,
      recentGRNs,
      poStatus,
      invoiceStats,
      consolidatedInvoices
    ] = await Promise.all([
      GoodsReceipt.countDocuments(),
      GoodsReceipt.countDocuments({ receivedDate: { $gte: weekAgo } }),
      GoodsReceipt.aggregate([
        {
          $group: {
            _id: '$supplierName',
            count: { $sum: 1 },
            total: { $sum: '$grandTotal' }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      GoodsReceipt.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('supplierId', 'companyName'),
      PurchaseOrder.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            avgReceived: { $avg: '$receivedPercentage' }
          }
        }
      ]),
      ConsolidatedInvoice.aggregate([
        {
          $group: {
            _id: '$paymentStatus',
            count: { $sum: 1 },
            total: { $sum: '$grandTotal' }
          }
        }
      ]),
      ConsolidatedInvoice.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            totalValue: { $sum: '$grandTotal' },
            avgReceipts: { $avg: '$receiptCount' }
          }
        }
      ])
    ]);

    const totalValue = await GoodsReceipt.aggregate([
      { $group: { _id: null, total: { $sum: '$grandTotal' } } }
    ]);

    res.json({
      success: true,
      data: {
        totalGRNs,
        weeklyGRNs,
        totalValue: totalValue[0]?.total || 0,
        topSuppliers: bySupplier,
        recentGRNs,
        poStatus,
        invoiceStats,
        consolidatedInvoices: consolidatedInvoices[0] || {
          total: 0,
          totalValue: 0,
          avgReceipts: 0
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// SEND PURCHASE INVOICE VIA EMAIL
// ============================================
exports.sendPurchaseInvoiceEmail = async (req, res) => {
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
  const { to, cc, subject, body, invoiceNumber } = emailData;
  if (typeof to !== 'string' || !isEmail(to.trim()) ||
      (cc && (typeof cc !== 'string' || !isEmail(cc.trim()))) ||
      [subject, body, invoiceNumber].some(value => value != null && typeof value !== 'string')) {
    return res.status(400).json({ success: false, error: 'Enter a valid recipient and optional CC email address, with text email fields.' });
  }
  if (!req.file?.buffer || req.file.buffer.subarray(0, 5).toString() !== '%PDF-') {
    return res.status(400).json({ success: false, error: 'A valid purchase invoice PDF attachment is required.' });
  }
  try {
    const { transporter, user } = getTransport();
    const text = body || 'Please find attached our official Purchase Invoice #' + (invoiceNumber || '') + '.\n\nMedyra Pharmaceutical';
    const escaped = text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    // sendMail connects and authenticates itself; verify() would do that twice.
    const info = await transporter.sendMail({
      from: { name: 'Medyra Pharmaceutical', address: user },
      to: to.trim(),
      cc: cc?.trim() || undefined,
      subject: subject?.trim() || 'Purchase Invoice #' + (invoiceNumber || '') + ' - Medyra Pharmaceutical',
      text,
      html: '<div style="font-family:Arial,sans-serif;white-space:pre-wrap">' + escaped + '</div>',
      attachments: [{
        filename: 'PI-' + (invoiceNumber || 'document').replace(/[^a-zA-Z0-9_.-]/g, '_') + '.pdf',
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
    return res.status(200).json({
      success: true, message: 'Mail server accepted the purchase invoice for delivery.',
      messageId: info.messageId, warning: warnings.join(' ') || undefined
    });
  } catch (error) {
    console.error('PI email failed:', { code: error.code, command: error.command, responseCode: error.responseCode });
    return res.status(error.code === 'EMAIL_CONFIG' ? 503 : 502).json({
      success: false, code: error.code || 'EMAIL_SEND_FAILED', error: emailError(error, 'purchase invoice')
    });
  }
};


// Commit receipt, stock, purchase and invoice changes as one operation.
for (const name of [
  'addPayment',
  'createGRN',
  'updateGRN',
  'updateConsolidatedInvoice',
  'deleteGRN',
  'deleteConsolidatedInvoice'
]) {
  exports[name] = receiptTransaction(exports[name], syncAllAutomatedJournals);
}

exports.addConsolidatedPayment = exports.addPayment;
