

// controllers/goodsReceiptController.js
const mongoose = require('mongoose');
const { GoodsReceipt, ConsolidatedInvoice } = require('../models/GoodsReceipt');
const PurchaseOrder = require('../models/PurchaseOrder');
const Product = require('../models/Product');

// ============================================
// GENERATE UNIQUE GRN NUMBER
// ============================================
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

// ============================================
// GENERATE UNIQUE PURCHASE INVOICE NUMBER (PI)
// ============================================
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

    if (!purchaseOrderId || !items || items.length === 0) {
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

    let finalSupplierName = (supplierName && supplierName.trim() !== '' && supplierName !== 'N/A') ? supplierName.trim() : '';
    if (!finalSupplierName && po) {
      finalSupplierName = po.supplierName || po.supplier?.companyName || po.supplier?.name || '';
    }
    const possibleSupId = supplierId || po?.supplierId || po?.supplier?._id || po?.supplier;
    if (!finalSupplierName && possibleSupId) {
      try {
        const supDoc = await mongoose.connection.collection('suppliers').findOne({
          _id: mongoose.isValidObjectId(possibleSupId) ? new mongoose.Types.ObjectId(possibleSupId) : possibleSupId
        });
        if (supDoc) {
          finalSupplierName = supDoc.companyName || supDoc.name || supDoc.supplierName || '';
        }
      } catch (err) {
        console.log('Supplier DB Lookup Error:', err.message);
      }
    }
    if (!finalSupplierName) finalSupplierName = 'Vendor / Supplier';

    const poCurrency = currency || po.currency || 'INR';
    const effExchangeRate = Number(exchangeRate || po.exchangeRate || 1) || 1;

    let existingGRN = await GoodsReceipt.findOne({ purchaseOrder: purchaseOrderId });
    const isFirstReceipt = !existingGRN;

    let subtotal = 0;
    let itemsTax = 0;
    const processedItems = [];

    for (const item of items) {
      const receivedQty = Number(item.receivedQty) || Number(item.acceptedQty) || 0;
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
        product = await Product.findOne({ $or: [{ sku: item.sku }, { 'basicInfo.sku': item.sku }] });
      }
      if (!product && item.productName) {
        product = await Product.findOne({ $or: [{ name: item.productName }, { 'basicInfo.name': item.productName }] });
      }

      const rate = Number(item.unitPrice) || 0;
      const taxRate = Number(item.taxRate) || 0;
      const itemSubtotal = receivedQty * rate;
      const itemTax = itemSubtotal * (taxRate / 100);

      subtotal += itemSubtotal;
      itemsTax += itemTax;

      const userMfgDate = item.mfgDate || '';
      const userExpDate = item.expDate || '';

      const costInINR = rate > 0
        ? (poCurrency !== 'INR' && effExchangeRate > 0 ? Number((rate * effExchangeRate).toFixed(2)) : rate)
        : (product?.pricing?.costPrice || 0);

      const rawMrp = (item.mrp !== undefined && item.mrp !== null && item.mrp !== '' && !isNaN(Number(item.mrp)))
        ? Number(item.mrp)
        : 0;
      const rawSellingPrice = (item.sellingPrice !== undefined && item.sellingPrice !== null && item.sellingPrice !== '' && !isNaN(Number(item.sellingPrice)))
        ? Number(item.sellingPrice)
        : 0;

      let finalMrpInINR = rawMrp > 0
        ? (poCurrency !== 'INR' && effExchangeRate > 0 ? Number((rawMrp * effExchangeRate).toFixed(2)) : rawMrp)
        : (product?.pricing?.mrp || 0);

      let finalSellingPriceInINR = rawSellingPrice > 0
        ? (poCurrency !== 'INR' && effExchangeRate > 0 ? Number((rawSellingPrice * effExchangeRate).toFixed(2)) : rawSellingPrice)
        : (product?.pricing?.sellingPrice || (costInINR > 0 ? Number((costInINR * 1.2).toFixed(2)) : 0));

      if (product) {
        const productType = product.productType || product.basicInfo?.productType || 'batch';
        const isBatchProduct = productType !== 'non-batch';

        if (isBatchProduct) {
          if (!Array.isArray(product.batches)) product.batches = [];
          const batchNumber = (item.batchNumber && item.batchNumber !== 'N/A')
            ? item.batchNumber.trim()
            : `BATCH-${Date.now().toString().slice(-6)}`;

          product.batches.push({
            batchNumber,
            mfgDate: userMfgDate,
            expDate: userExpDate,
            quantity: receivedQty,
            costPrice: costInINR,
            sellingPrice: finalSellingPriceInINR,
            mrp: finalMrpInINR,
            supplierName: finalSupplierName,
            supplier: possibleSupId,
            manufacturer: product.manufacturer || product.basicInfo?.manufacturer || 'N/A',
            addedDate: receivedDate || new Date().toISOString().split('T')[0],
            addedBy: req.user?.name || receivedBy || 'System',
            reason: poCurrency !== 'INR'
              ? `GRN ${existingGRN?.grnNumber || po.poNumber} (${rate} ${poCurrency} @ Exch ${effExchangeRate} = ₹${costInINR.toFixed(2)})`
              : `GRN ${existingGRN?.grnNumber || po.poNumber} @ ₹${costInINR.toFixed(2)}`
          });
          product.stock = product.batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
          product.markModified('batches');
        } else {
          product.stock = (Number(product.stock) || 0) + receivedQty;
          if (!Array.isArray(product.stockMovements)) product.stockMovements = [];
          product.stockMovements.push({
            date: new Date(),
            type: 'add',
            quantity: receivedQty,
            mrp: finalMrpInINR,
            costPrice: costInINR,
            sellingPrice: finalSellingPriceInINR,
            supplierName: finalSupplierName,
            reason: `Received via GRN (${po.poNumber || 'GRN'})`
          });
          product.markModified('stockMovements');
        }

        const minStock = product.minStock || product.basicInfo?.minStock || 0;
        if (product.stock <= 0) product.status = 'inactive';
        else if (product.stock <= minStock) product.status = 'low_stock';
        else product.status = 'active';

        await product.save();
      }

      const orderedQty = Number(item.orderedQty) || 0;
      const alreadyReceived = Number(item.alreadyReceived) || 0;
      const remainingQty = Math.max(0, orderedQty - alreadyReceived - receivedQty);

      processedItems.push({
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
        mrp: rawMrp,
        sellingPrice: rawSellingPrice,
        taxRate,
        subtotal: itemSubtotal,
        tax: itemTax,
        totalWithTax: itemSubtotal + itemTax,
        remarks: item.remarks || ''
      });
    }

    if (processedItems.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid items with received quantity found' });
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
      const grnNumber = await generateGRNNumber();

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
        taxAmount: ((Number(inventoryCharges?.amount) || 0) * (Number(inventoryCharges?.taxRate) || 0)) / 100
      };

      const chargesSubtotal = freightData.amount + insuranceData.amount + inventoryData.amount;
      const chargesTax = freightData.taxAmount + insuranceData.taxAmount + inventoryData.taxAmount;

      // ✅ 100% Exact PO match (Includes both items tax and charges tax)
      const totalTax = itemsTax + chargesTax;
      const exactTotal = subtotal + chargesSubtotal + totalTax;
      const isInternational = poCurrency && poCurrency !== 'INR';
      const grandTotal = isInternational ? Number(exactTotal.toFixed(2)) : Math.round(exactTotal);
      const roundOff = isInternational ? 0 : Number((grandTotal - exactTotal).toFixed(2));

      grn = new GoodsReceipt({
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

      processedItems.forEach(newItem => {
        const existingIdx = mergedItems.findIndex(
          item =>
            (item.productId && newItem.productId && item.productId.toString() === newItem.productId.toString()) ||
            (item.productName && item.productName === newItem.productName)
        );

        if (existingIdx > -1) {
          const ex = mergedItems[existingIdx];
          ex.receivedQty = (ex.receivedQty || 0) + (newItem.receivedQty || 0);
          ex.acceptedQty = (ex.acceptedQty || 0) + (newItem.receivedQty || 0);
          ex.remainingQty = Math.max(0, (ex.orderedQty || 0) - (ex.receivedQty || 0));
          ex.subtotal = (ex.receivedQty || 0) * (ex.unitPrice || 0);
          ex.tax = (ex.subtotal || 0) * ((ex.taxRate || 0) / 100);
          ex.totalWithTax = (ex.subtotal || 0) + (ex.tax || 0);
          if (newItem.batchNumber && newItem.batchNumber !== 'N/A') ex.batchNumber = newItem.batchNumber;
          if (newItem.mfgDate) ex.mfgDate = newItem.mfgDate;
          if (newItem.expDate) ex.expDate = newItem.expDate;
          if (newItem.mrp) ex.mrp = newItem.mrp;
          if (newItem.sellingPrice) ex.sellingPrice = newItem.sellingPrice;
        } else {
          mergedItems.push(newItem);
        }
      });

      let newSubtotal = 0;
      let newItemsTax = 0;
      mergedItems.forEach(item => {
        newSubtotal += (item.subtotal || 0);
        newItemsTax += (item.tax || 0);
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
      grn.grandTotal = isInternational ? Number(exactTotal.toFixed(2)) : Math.round(exactTotal);
      grn.roundOff = isInternational ? 0 : Number((grn.grandTotal - exactTotal).toFixed(2));

      if (paymentEntry) {
        if (!Array.isArray(grn.payments)) grn.payments = [];
        grn.payments.push(paymentEntry);
        grn.paidAmount = (grn.paidAmount || 0) + payAmt;
      }

      if (grn.paidAmount > grn.grandTotal) overpaymentCredit = grn.paidAmount - grn.grandTotal;
      grn.receivedDate = receivedDate || grn.receivedDate;
      grn.notes = notes ? `${grn.notes ? grn.notes + ' | ' : ''}${notes}` : grn.notes;
    }

    await grn.save();

    // PO Status sync
    const totalOrdered = po.items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
    let totalReceived = 0;

    po.items.forEach((poItem) => {
      const receivedItem = processedItems.find(
        (i) =>
          (i.productId && poItem.productId && i.productId.toString() === poItem.productId.toString()) ||
          (i.productId && poItem.product && i.productId.toString() === poItem.product.toString()) ||
          (i.productName && (i.productName === poItem.productName || i.productName === poItem.name))
      );

      if (receivedItem) {
        poItem.receivedQty = (Number(poItem.receivedQty) || 0) + Number(receivedItem.receivedQty);
        poItem.remainingQty = Math.max(0, (Number(poItem.quantity) || 0) - Number(poItem.receivedQty));
      }
      totalReceived += Number(poItem.receivedQty || 0);
    });

    po.receivedPercentage = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0;
    po.partiallyReceived = totalReceived > 0 && totalReceived < totalOrdered;
    if (totalReceived >= totalOrdered) {
      po.status = 'delivered';
      po.deliveryDate = receivedDate || new Date().toISOString().split('T')[0];
    } else if (totalReceived > 0) {
      po.status = 'partially_received';
    }

    if (overpaymentCredit > 0) {
      po.creditAmount = (Number(po.creditAmount) || 0) + overpaymentCredit;
    }
    await po.save();

    // Consolidated Purchase Invoice (PI)
    let existingInvoice = await ConsolidatedInvoice.findOne({
      purchaseOrder: purchaseOrderId,
      status: { $in: ['draft', 'generated'] }
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
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
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
        paymentStatus: (grn.paidAmount || 0) >= grn.grandTotal ? 'paid' : (grn.paidAmount > 0 ? 'partial' : 'pending'),
        status: 'generated',
        notes: notes || '',
        createdBy: req.user?.id || req.user?._id,
        receiptCount: 1
      });
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
      existingInvoice.remainingAmount = Math.max(0, grn.grandTotal - (grn.paidAmount || 0));
      existingInvoice.paymentStatus = (grn.paidAmount || 0) >= grn.grandTotal ? 'paid' : (grn.paidAmount > 0 ? 'partial' : 'pending');
      existingInvoice.payments = grn.payments || [];
      existingInvoice.receiptCount = (existingInvoice.receiptCount || 0) + 1;
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
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// UPDATE GRN (FULL EDIT - WITH STOCK, CHARGES & PO RE-SYNC)
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

    // Charges Update
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

    // Items & Stock Adjustments
    if (Array.isArray(items)) {
      let newSubtotal = 0;
      let newItemsTax = 0;

      for (const upd of items) {
        const grnItem = grn.items.id(upd._id) || grn.items.find(i => String(i._id) === String(upd._id));
        if (!grnItem) continue;

        const oldQty = Number(grnItem.receivedQty) || Number(grnItem.acceptedQty) || 0;
        const newQty = upd.receivedQty !== undefined ? Number(upd.receivedQty) || 0 : oldQty;
        const qtyDelta = newQty - oldQty;
        const oldBatchNumber = grnItem.batchNumber;

        if (qtyDelta !== 0 && grnItem.productId) {
          const product = await Product.findById(grnItem.productId);
          if (product) {
            const isBatch = (product.productType || 'batch') !== 'non-batch';
            if (isBatch && Array.isArray(product.batches)) {
              let batch = product.batches.find(b => b.batchNumber === oldBatchNumber) ||
                          (upd.batchNumber ? product.batches.find(b => b.batchNumber === upd.batchNumber) : null);

              if (batch) {
                batch.quantity = Math.max(0, (Number(batch.quantity) || 0) + qtyDelta);
                if (upd.mfgDate !== undefined) batch.mfgDate = upd.mfgDate;
                if (upd.expDate !== undefined) batch.expDate = upd.expDate;
                if (upd.mrp !== undefined && upd.mrp !== '') batch.mrp = Number(upd.mrp) || batch.mrp;
                if (upd.sellingPrice !== undefined && upd.sellingPrice !== '') batch.sellingPrice = Number(upd.sellingPrice) || batch.sellingPrice;
                if (upd.batchNumber) batch.batchNumber = upd.batchNumber;
                if (batch.quantity === 0) product.batches = product.batches.filter(b => b !== batch);
              } else if (qtyDelta > 0 && upd.batchNumber) {
                product.batches.push({
                  batchNumber: upd.batchNumber,
                  quantity: qtyDelta,
                  mfgDate: upd.mfgDate || '',
                  expDate: upd.expDate || '',
                  mrp: Number(upd.mrp) || 0,
                  sellingPrice: Number(upd.sellingPrice) || 0
                });
              }
              product.stock = product.batches.reduce((s, b) => s + (Number(b.quantity) || 0), 0);
              product.markModified('batches');
              await product.save();
            } else {
              product.stock = Math.max(0, (Number(product.stock) || 0) + qtyDelta);
              await product.save();
            }
          }
        }

        if (upd.receivedQty !== undefined) {
          grnItem.receivedQty = newQty;
          grnItem.acceptedQty = newQty;
          if (grnItem.orderedQty) grnItem.remainingQty = Math.max(0, grnItem.orderedQty - newQty);
        }
        if (upd.unitPrice !== undefined) grnItem.unitPrice = Number(upd.unitPrice) || 0;
        if (upd.taxRate !== undefined) grnItem.taxRate = Number(upd.taxRate) || 0;
        if (upd.batchNumber) grnItem.batchNumber = upd.batchNumber;
        if (upd.mfgDate !== undefined) grnItem.mfgDate = upd.mfgDate;
        if (upd.expDate !== undefined) grnItem.expDate = upd.expDate;
        if (upd.mrp !== undefined && upd.mrp !== '') grnItem.mrp = Number(upd.mrp) || 0;
        if (upd.sellingPrice !== undefined && upd.sellingPrice !== '') grnItem.sellingPrice = Number(upd.sellingPrice) || 0;

        const lineTotal = (Number(grnItem.receivedQty) || 0) * (Number(grnItem.unitPrice) || 0);
        const lineTax = (lineTotal * (Number(grnItem.taxRate) || 0)) / 100;
        grnItem.subtotal = lineTotal;
        grnItem.tax = lineTax;
        grnItem.totalWithTax = lineTotal + lineTax;

        newSubtotal += lineTotal;
        newItemsTax += lineTax;
      }

      grn.markModified('items');
      grn.subtotal = newSubtotal;
      grn.totalTax = newItemsTax;
    }

    const cSub =
      (Number(grn.freight?.amount) || 0) +
      (Number(grn.insurance?.amount) || 0) +
      (Number(grn.inventoryCharges?.amount) || 0);
    const cTax =
      (Number(grn.freight?.taxAmount) || 0) +
      (Number(grn.insurance?.taxAmount) || 0) +
      (Number(grn.inventoryCharges?.taxAmount) || 0);

    grn.chargesSubtotal = cSub;
    grn.chargesTax = cTax;

    // ✅ Combine items tax + charges tax for true total
    const totalTaxCombined = (Number(grn.totalTax) || 0) + cTax;
    grn.totalTax = totalTaxCombined;

    const exactTotal = (Number(grn.subtotal) || 0) + cSub + totalTaxCombined;
    const isInternational = grn.currency && grn.currency !== 'INR';
    grn.grandTotal = isInternational ? Number(exactTotal.toFixed(2)) : Math.round(exactTotal);
    grn.roundOff = isInternational ? 0 : Number((grn.grandTotal - exactTotal).toFixed(2));

    await grn.save();

    // Re-sync Purchase Order status
    if (grn.purchaseOrder) {
      const po = await PurchaseOrder.findById(grn.purchaseOrder);
      if (po) {
        let totalOrdered = 0;
        let totalReceived = 0;
        po.items.forEach((poItem) => {
          totalOrdered += Number(poItem.quantity) || 0;
          const matched = grn.items.find(gi => String(gi.productId) === String(poItem.productId || poItem.product));
          if (matched) {
            poItem.receivedQty = Number(matched.receivedQty) || 0;
            poItem.remainingQty = Math.max(0, (Number(poItem.quantity) || 0) - (Number(matched.receivedQty) || 0));
          }
          totalReceived += Number(poItem.receivedQty) || 0;
        });
        po.receivedPercentage = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0;
        po.partiallyReceived = totalReceived > 0 && totalReceived < totalOrdered;
        if (totalReceived >= totalOrdered) {
          po.status = 'delivered';
        } else if (totalReceived > 0) {
          po.status = 'partially_received';
        }
        po.markModified('items');
        await po.save();
      }
    }

    // Sync Consolidated Invoice (PI)
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
      inv.remainingAmount = Math.max(0, inv.grandTotal - (Number(inv.paidAmount) || 0));
      inv.paymentStatus = (inv.paidAmount || 0) >= inv.grandTotal ? 'paid' : (inv.paidAmount > 0 ? 'partial' : 'pending');
      await inv.save();
    }

    res.json({
      success: true,
      data: grn,
      message: `GRN ${grn.grnNumber} updated successfully`
    });
  } catch (error) {
    console.error('❌ Update GRN error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// UPDATE PURCHASE INVOICE (FULL EDIT CONTROL)
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

    if (dueDate !== undefined) invoice.dueDate = dueDate;
    if (notes !== undefined) invoice.notes = notes;
    if (invoiceDate !== undefined) invoice.invoiceDate = invoiceDate;
    if (paymentTerms !== undefined) invoice.paymentTerms = paymentTerms;
    if (supplierGST !== undefined) invoice.supplierGST = supplierGST;
    if (supplierContact !== undefined) invoice.supplierContact = supplierContact;
    if (supplierAddress !== undefined) invoice.supplierAddress = supplierAddress;
    if (gstType !== undefined) invoice.gstType = gstType;

    // Full Items update
    if (Array.isArray(items)) {
      let newSubtotal = 0;
      let newItemsTax = 0;

      invoice.items = items.map(upd => {
        const qty = Number(upd.acceptedQty ?? upd.receivedQty ?? upd.quantity) || 0;
        const rate = Number(upd.unitPrice ?? upd.rate) || 0;
        const taxRate = Number(upd.taxRate) || 0;
        const lineTotal = qty * rate;
        const lineTax = (lineTotal * taxRate) / 100;

        newSubtotal += lineTotal;
        newItemsTax += lineTax;

        return {
          productId: upd.productId,
          productName: upd.productName,
          sku: upd.sku || '',
          hsn: upd.hsn || '',
          unit: upd.unit || 'Strips',
          orderedQty: Number(upd.orderedQty) || qty,
          alreadyReceived: Number(upd.alreadyReceived) || 0,
          receivedQty: qty,
          acceptedQty: qty,
          rejectedQty: 0,
          remainingQty: 0,
          batchNumber: upd.batchNumber || 'N/A',
          mfgDate: upd.mfgDate || '',
          expDate: upd.expDate || '',
          unitPrice: rate,
          taxRate,
          subtotal: lineTotal,
          tax: lineTax,
          totalWithTax: lineTotal + lineTax
        };
      });

      invoice.subtotal = newSubtotal;
      invoice.totalTax = newItemsTax;
    }

    // Charges
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
    invoice.totalTax = (Number(invoice.totalTax) || 0) + cTax;

    const exactTotal = (Number(invoice.subtotal) || 0) + cSub + invoice.totalTax;
    const isInternational = invoice.currency && invoice.currency !== 'INR';
    invoice.grandTotal = isInternational ? Number(exactTotal.toFixed(2)) : Math.round(exactTotal);
    invoice.roundOff = isInternational ? 0 : Number((invoice.grandTotal - exactTotal).toFixed(2));

    invoice.remainingAmount = Math.max(0, invoice.grandTotal - (Number(invoice.paidAmount) || 0));
    invoice.paymentStatus = (invoice.paidAmount || 0) >= invoice.grandTotal ? 'paid' : (invoice.paidAmount > 0 ? 'partial' : 'pending');

    await invoice.save();

    // Also sync the Goods Receipt
    if (invoice.grnIds && invoice.grnIds.length > 0) {
      const grn = await GoodsReceipt.findById(invoice.grnIds[0]);
      if (grn) {
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
        await grn.save();
      }
    }

    res.json({
      success: true,
      data: invoice,
      message: `Invoice ${invoice.invoiceNumber} fully updated successfully`
    });
  } catch (error) {
    console.error('❌ Update consolidated invoice error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// DELETE PURCHASE INVOICE
// ============================================
exports.deleteConsolidatedInvoice = async (req, res) => {
  try {
    const invoiceId = req.params.invoiceId || req.params.id || req.query.invoiceId || req.query.id || req.body.invoiceId;
    if (!invoiceId || !mongoose.isValidObjectId(invoiceId)) {
      return res.status(400).json({ success: false, message: 'Valid Invoice ID is required' });
    }

    const invoice = await ConsolidatedInvoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Purchase Invoice not found' });
    }

    const grnIds = invoice.grnIds || (invoice.grnId ? [invoice.grnId] : []);
    if ((!grnIds || grnIds.length === 0) && invoice._id) {
      const linked = await GoodsReceipt.find({ consolidatedInvoiceId: invoice._id }).select('_id');
      linked.forEach(g => grnIds.push(g._id));
    }

    for (const grnId of grnIds) {
      const grn = await GoodsReceipt.findById(grnId);
      if (!grn) continue;

      for (const item of grn.items || []) {
        const receivedQty = Number(item.receivedQty) || Number(item.acceptedQty) || 0;
        if (receivedQty <= 0) continue;

        let product = null;
        if (item.productId && mongoose.isValidObjectId(item.productId)) {
          product = await Product.findById(item.productId);
        }
        if (!product && item.sku) {
          product = await Product.findOne({ $or: [{ sku: item.sku }, { 'basicInfo.sku': item.sku }] });
        }
        if (!product && item.productName) {
          product = await Product.findOne({ $or: [{ name: item.productName }, { 'basicInfo.name': item.productName }] });
        }

        if (product) {
          const isBatch = (product.productType || 'batch') !== 'non-batch';
          if (isBatch && Array.isArray(product.batches)) {
            const idx = product.batches.findIndex(b => b.batchNumber === item.batchNumber);
            if (idx > -1) {
              product.batches[idx].quantity = Math.max(0, (Number(product.batches[idx].quantity) || 0) - receivedQty);
              if (product.batches[idx].quantity === 0) product.batches.splice(idx, 1);
            }
            product.stock = product.batches.reduce((s, b) => s + (Number(b.quantity) || 0), 0);
            product.markModified('batches');
          } else {
            product.stock = Math.max(0, (Number(product.stock) || 0) - receivedQty);
          }
          await product.save();
        }
      }

      grn.invoiceGenerated = false;
      grn.consolidatedInvoiceId = null;
      grn.invoiceId = null;
      await grn.save();
    }

    if (invoice.purchaseOrder) {
      const po = await PurchaseOrder.findById(invoice.purchaseOrder);
      if (po) {
        (po.items || []).forEach(item => {
          item.receivedQty = 0;
          item.remainingQty = Number(item.quantity) || 0;
        });
        po.receivedPercentage = 0;
        po.partiallyReceived = false;
        if (['delivered', 'partially_received'].includes(po.status)) {
          po.status = 'shipped';
        }
        po.markModified('items');
        await po.save();
      }
    }

    await invoice.deleteOne();

    return res.json({
      success: true,
      message: 'Purchase Invoice deleted. Stock reversed and GRN is available again for Create GRN.'
    });
  } catch (error) {
    console.error('❌ Delete Invoice error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ADD PAYMENT
// ============================================
exports.addPayment = async (req, res) => {
  try {
    const id = req.params.id || req.params.grnId || req.params.invoiceId;
    const { date, paymentDate, amount, method, paymentMethod, reference, transactionId, notes } = req.body;

    const paymentAmount = Number(amount) || 0;
    if (paymentAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Payment amount must be greater than 0' });
    }

    let grn = null;
    let invoice = null;

    if (mongoose.isValidObjectId(id)) {
      grn = await GoodsReceipt.findById(id);
      if (grn) {
        if (grn.consolidatedInvoiceId) invoice = await ConsolidatedInvoice.findById(grn.consolidatedInvoiceId);
        if (!invoice) invoice = await ConsolidatedInvoice.findOne({ purchaseOrder: grn.purchaseOrder });
      } else {
        invoice = await ConsolidatedInvoice.findById(id);
        if (invoice) grn = await GoodsReceipt.findOne({ consolidatedInvoiceId: invoice._id });
      }
    }

    if (!grn && !invoice) {
      return res.status(404).json({ success: false, message: 'Goods Receipt or Invoice record not found' });
    }

    const paymentEntry = {
      date: date || paymentDate || new Date().toISOString().split('T')[0],
      amount: paymentAmount,
      method: method || paymentMethod || 'bank',
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
      invoice.paymentStatus = invoice.remainingAmount <= 0 ? 'paid' : (invoice.paidAmount > 0 ? 'partial' : 'pending');
      invoice.status = invoice.paymentStatus;
      await invoice.save();
    }

    return res.json({
      success: true,
      data: grn || invoice,
      message: `✅ Payment of ${paymentAmount} recorded successfully!`
    });
  } catch (error) {
    console.error('❌ Add payment error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.addConsolidatedPayment = exports.addPayment;

exports.getConsolidatedInvoices = async (req, res) => {
  try {
    const { page = 1, limit = 15, search, supplierId, paymentStatus, startDate, endDate } = req.query;
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
      stats: stats[0] || { totalInvoices: 0, totalValue: 0, totalPaid: 0, totalRemaining: 0, totalReceipts: 0 },
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
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
    const grns = await GoodsReceipt.find({ consolidatedInvoiceId: invoice._id }).select('grnNumber receivedDate items subtotal grandTotal status');

    res.json({ success: true, data: { ...invoice.toObject(), grns } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getGRNs = async (req, res) => {
  try {
    const { page = 1, limit = 15, search, startDate, endDate, supplierId, status } = req.query;
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
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
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
      .populate('consolidatedInvoiceId', 'invoiceNumber paymentStatus payments grandTotal paidAmount remainingAmount');

    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });
    const po = grn.purchaseOrder;
    const totalOrdered = po?.items?.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0) || 0;
    const totalReceived = po?.items?.reduce((sum, i) => sum + (Number(i.receivedQty) || 0), 0) || 0;

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
          receivedPercentage: totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0,
          poGrandTotal: po?.total || 0,
          creditAmount: po?.creditAmount || 0
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteGRN = async (req, res) => {
  try {
    const grn = await GoodsReceipt.findById(req.params.id);
    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });

    for (const item of grn.items) {
      const receivedQty = Number(item.receivedQty) || Number(item.acceptedQty) || 0;
      if (receivedQty <= 0) continue;

      let product = null;
      if (item.productId && mongoose.isValidObjectId(item.productId)) {
        product = await Product.findById(item.productId);
      }
      if (!product && item.sku) {
        product = await Product.findOne({ $or: [{ sku: item.sku }, { 'basicInfo.sku': item.sku }] });
      }

      if (product) {
        const isBatch = (product.productType || 'batch') !== 'non-batch';
        if (isBatch && Array.isArray(product.batches)) {
          const batchIndex = product.batches.findIndex((b) => b.batchNumber === item.batchNumber);
          if (batchIndex > -1) {
            product.batches[batchIndex].quantity = Math.max(0, (product.batches[batchIndex].quantity || 0) - receivedQty);
            if (product.batches[batchIndex].quantity === 0) product.batches.splice(batchIndex, 1);
          }
          product.stock = product.batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
          product.markModified('batches');
        } else {
          product.stock = Math.max(0, (Number(product.stock) || 0) - receivedQty);
        }
        await product.save();
      }
    }

    const po = await PurchaseOrder.findById(grn.purchaseOrder);
    if (po) {
      po.items.forEach((poItem) => {
        poItem.receivedQty = 0;
        poItem.remainingQty = Number(poItem.quantity) || 0;
      });
      po.receivedPercentage = 0;
      po.partiallyReceived = false;
      po.status = 'pending';
      await po.save();
    }

    await grn.deleteOne();
    res.json({ success: true, message: 'GRN deleted successfully with stock reversal' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getReceiptDashboard = async (req, res) => {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const [totalGRNs, weeklyGRNs, bySupplier, recentGRNs, poStatus, invoiceStats, consolidatedInvoices] = await Promise.all([
      GoodsReceipt.countDocuments(),
      GoodsReceipt.countDocuments({ receivedDate: { $gte: weekAgo } }),
      GoodsReceipt.aggregate([
        { $group: { _id: '$supplierName', count: { $sum: 1 }, total: { $sum: '$grandTotal' } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      GoodsReceipt.find().sort({ createdAt: -1 }).limit(10).populate('supplierId', 'companyName'),
      PurchaseOrder.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, avgReceived: { $avg: '$receivedPercentage' } } }
      ]),
      ConsolidatedInvoice.aggregate([
        { $group: { _id: '$paymentStatus', count: { $sum: 1 }, total: { $sum: '$grandTotal' } } }
      ]),
      ConsolidatedInvoice.aggregate([
        { $group: { _id: null, total: { $sum: 1 }, totalValue: { $sum: '$grandTotal' }, avgReceipts: { $avg: '$receiptCount' } } }
      ])
    ]);

    const totalValue = await GoodsReceipt.aggregate([{ $group: { _id: null, total: { $sum: '$grandTotal' } } }]);

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
        consolidatedInvoices: consolidatedInvoices[0] || { total: 0, totalValue: 0, avgReceipts: 0 }
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

    const { to, cc, subject, body, html, invoiceNumber } = emailData;

    if (!to || !to.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Recipient email is required'
      });
    }

    const attachments = [];
    if (req.file && req.file.buffer) {
      attachments.push({
        filename: req.file.originalname || `PI-${invoiceNumber || 'document'}.pdf`,
        content: req.file.buffer,
        contentType: 'application/pdf'
      });
    }

    const mailHtml =
      html ||
      (body
        ? body.replace(/\n/g, '<br/>')
        : `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;">
        <p>Dear Sir/Madam,</p>
        <p>Please find attached our Purchase Invoice <strong>#${invoiceNumber || ''}</strong>.</p>
        <p>Thank you,<br/>Medyra Pharmaceutical</p>
      </div>
    `);

    const mailUser = (process.env.EMAIL_USER || '').trim();
    const mailPass = (process.env.EMAIL_PASS || '').replace(/\s+/g, '');

    if (!mailUser || !mailPass) {
      return res.status(500).json({
        success: false,
        error: 'EMAIL_USER / EMAIL_PASS not configured'
      });
    }

    const validCc =
      cc &&
      typeof cc === 'string' &&
      cc.trim().length > 3 &&
      cc.includes('@') &&
      !cc.includes('example.com')
        ? cc.trim()
        : undefined;

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: mailUser,
        pass: mailPass
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
      tls: { rejectUnauthorized: false }
    });

    await transporter.verify();

    const info = await transporter.sendMail({
      from: `"Medyra Pharmaceutical" <${mailUser}>`,
      to: to.trim(),
      cc: validCc,
      subject: subject || `Purchase Invoice #${invoiceNumber || ''} - Medyra Pharmaceutical`,
      html: mailHtml,
      attachments
    });

    return res.status(200).json({
      success: true,
      message: `Email successfully sent to ${to.trim()}`,
      messageId: info.messageId
    });
  } catch (error) {
    console.error('❌ Send Purchase Invoice Email Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to send email',
      code: error.code || null
    });
  }
};