// controllers/purchaseReturnController.js
const PurchaseReturn = require('../models/PurchaseReturn');
const Product = require('../models/Product');

// ============================================
// CREATE PURCHASE RETURN & DEDUCT STOCK
// ============================================
exports.createPurchaseReturn = async (req, res) => {
  try {
    const {
      poNumber,
      purchaseOrder,
      supplier,
      supplierId,
      supplierName,
      supplierAddress,
      supplierGST,
      supplierContact,
      supplierEmail,
      returnDate,
      items,
      returnReason,
      notes,
      gstType,
      currency,
      exchangeRate,
      subtotal,
      totalTax,
      total
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one return item is required' });
    }

    if (!supplierId) {
      return res.status(400).json({ success: false, message: 'Supplier is required' });
    }

    // Safe PR Number Generation
    const year = new Date().getFullYear();
    const lastReturn = await PurchaseReturn.findOne({
      returnNumber: new RegExp(`^PR-${year}/`)
    }).sort({ createdAt: -1 });

    let nextSeq = 1;
    if (lastReturn && lastReturn.returnNumber) {
      const parts = lastReturn.returnNumber.split('/');
      if (parts.length === 2) {
        const lastNum = parseInt(parts[1], 10);
        if (!isNaN(lastNum)) nextSeq = lastNum + 1;
      }
    }

    let returnNumber = `PR-${year}/${String(nextSeq).padStart(3, '0')}`;
    while (await PurchaseReturn.exists({ returnNumber })) {
      nextSeq++;
      returnNumber = `PR-${year}/${String(nextSeq).padStart(3, '0')}`;
    }

    const formattedItems = [];

    // Deduct stock for each item
    for (const item of items) {
      const productId = item.product || item.productId;
      const qty = parseInt(item.quantity) || 0;
      const rate = parseFloat(item.unitPrice) || 0;
      const taxRate = parseFloat(item.taxRate) || 0;
      const itemSubtotal = qty * rate;
      const itemTax = itemSubtotal * (taxRate / 100);
      const itemTotalWithTax = itemSubtotal + itemTax;

      if (productId) {
        const product = await Product.findById(productId);
        if (product) {
          if (product.productType === 'batch' && item.batchNumber && item.batchNumber !== 'N/A') {
            const batchIdx = product.batches.findIndex(b => b.batchNumber === item.batchNumber);
            if (batchIdx !== -1) {
              product.batches[batchIdx].quantity = Math.max(0, product.batches[batchIdx].quantity - qty);
              if (product.batches[batchIdx].quantity === 0) {
                product.batches.splice(batchIdx, 1);
              }
            }
          } else {
            product.stock = Math.max(0, product.stock - qty);
          }
          await product.save();
        }
      }

      formattedItems.push({
        product: productId,
        productName: item.productName || item.name || 'N/A',
        batchNumber: item.batchNumber || 'N/A',
        sku: item.sku || '',
        hsn: item.hsn || '',
        quantity: qty,
        unit: item.unit || 'Pcs',
        unitPrice: rate,
        taxRate: taxRate,
        total: itemSubtotal,
        totalWithTax: itemTotalWithTax,
        reason: item.reason || returnReason || 'Return to supplier'
      });
    }

    const calcSubtotal = subtotal !== undefined ? parseFloat(subtotal) : formattedItems.reduce((s, i) => s + i.total, 0);
    const calcTax = totalTax !== undefined ? parseFloat(totalTax) : formattedItems.reduce((s, i) => s + (i.totalWithTax - i.total), 0);
    const calcGrandTotal = total !== undefined ? parseFloat(total) : (calcSubtotal + calcTax);

    const purchaseReturn = new PurchaseReturn({
      returnNumber,
      poNumber: poNumber || 'N/A',
      purchaseOrder: purchaseOrder || null,
      supplier: supplier || supplierName || 'N/A',
      supplierId,
      supplierName: supplierName || supplier || '',
      supplierAddress: supplierAddress || 'N/A',
      supplierGST: supplierGST || 'N/A',
      supplierContact: supplierContact || 'N/A',
      supplierEmail: supplierEmail || '',
      returnDate: returnDate || new Date().toISOString().split('T')[0],
      items: formattedItems,
      currency: currency || 'INR',
      exchangeRate: parseFloat(exchangeRate) || 1,
      subtotal: calcSubtotal,
      gstType: gstType || 'igst',
      totalTax: calcTax,
      igst: gstType === 'igst' ? calcTax : 0,
      cgst: gstType === 'cgst_sgst' ? (calcTax / 2) : 0,
      sgst: gstType === 'cgst_sgst' ? (calcTax / 2) : 0,
      total: calcGrandTotal,
      returnReason: returnReason || 'Stock return to supplier',
      status: 'completed',
      notes: notes || '',
      createdBy: req.user.id
    });

    await purchaseReturn.save();

    console.log(`✅ Purchase Return ${returnNumber} created successfully`);

    res.status(201).json({
      success: true,
      data: purchaseReturn,
      message: `Purchase Return ${returnNumber} created and stock deducted!`
    });

  } catch (error) {
    console.error('❌ Create purchase return error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET ALL PURCHASE RETURNS
// ============================================
exports.getPurchaseReturns = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { returnNumber: { $regex: search, $options: 'i' } },
        { poNumber: { $regex: search, $options: 'i' } },
        { supplier: { $regex: search, $options: 'i' } },
        { supplierName: { $regex: search, $options: 'i' } }
      ];
    }

    const returns = await PurchaseReturn.find(query)
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await PurchaseReturn.countDocuments(query);

    res.json({
      success: true,
      data: returns,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ Get purchase returns error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET SINGLE RETURN
// ============================================
exports.getPurchaseReturn = async (req, res) => {
  try {
    const purchaseReturn = await PurchaseReturn.findById(req.params.id)
      .populate('createdBy', 'name');

    if (!purchaseReturn) {
      return res.status(404).json({ success: false, message: 'Purchase return not found' });
    }

    res.json({ success: true, data: purchaseReturn });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// DELETE RETURN
// ============================================
exports.deletePurchaseReturn = async (req, res) => {
  try {
    const purchaseReturn = await PurchaseReturn.findById(req.params.id);
    if (!purchaseReturn) {
      return res.status(404).json({ success: false, message: 'Purchase return not found' });
    }

    await purchaseReturn.deleteOne();
    res.json({ success: true, message: 'Purchase return deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};