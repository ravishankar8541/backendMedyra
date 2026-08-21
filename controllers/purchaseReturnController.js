const PurchaseReturn = require('../models/PurchaseReturn');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');

// ============================================
// GENERATE RETURN NUMBER
// ============================================
const generateReturnNumber = async () => {
  const year = new Date().getFullYear();
  const last = await PurchaseReturn.findOne({
    returnNumber: new RegExp(`^PR-${year}/`)
  }).sort({ createdAt: -1 });

  let next = 1;
  if (last?.returnNumber) {
    const parts = last.returnNumber.split('/');
    if (parts[1]) next = parseInt(parts[1], 10) + 1;
  }

  let returnNumber = `PR-${year}/${String(next).padStart(3, '0')}`;
  while (await PurchaseReturn.exists({ returnNumber })) {
    next++;
    returnNumber = `PR-${year}/${String(next).padStart(3, '0')}`;
  }
  return returnNumber;
};

// ============================================
// CREATE PURCHASE RETURN - COMPLETE
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
      exchangeRate
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one return item is required' });
    }

    if (!supplierId) {
      return res.status(400).json({ success: false, message: 'Supplier is required' });
    }

    const returnNumber = await generateReturnNumber();
    
    let subtotal = 0;
    let totalTax = 0;
    const formattedItems = [];

    // Process each item - Deduct stock
    for (const item of items) {
      const productId = item.product || item.productId;
      const qty = parseInt(item.quantity) || 0;
      const rate = parseFloat(item.unitPrice) || 0;
      const taxRate = parseFloat(item.taxRate) || 0;
      const itemSubtotal = qty * rate;
      const itemTax = itemSubtotal * (taxRate / 100);
      const itemTotalWithTax = itemSubtotal + itemTax;

      subtotal += itemSubtotal;
      totalTax += itemTax;

      if (productId) {
        const product = await Product.findById(productId);
        if (product) {
          // Deduct from batch or general stock
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

    const grandTotal = subtotal + totalTax;

    // Get supplier details if not provided
    let supplierData = supplier;
    if (supplierId && !supplierName) {
      const supp = await Supplier.findById(supplierId);
      if (supp) {
        supplierData = supp.companyName;
      }
    }

    const purchaseReturn = new PurchaseReturn({
      returnNumber,
      poNumber: poNumber || 'N/A',
      purchaseOrder: purchaseOrder || null,
      supplier: supplierData || supplierName || '',
      supplierId,
      supplierName: supplierName || supplierData || '',
      supplierAddress: supplierAddress || 'N/A',
      supplierGST: supplierGST || 'N/A',
      supplierContact: supplierContact || 'N/A',
      supplierEmail: supplierEmail || '',
      returnDate: returnDate || new Date().toISOString().split('T')[0],
      items: formattedItems,
      currency: currency || 'INR',
      exchangeRate: parseFloat(exchangeRate) || 1,
      subtotal: subtotal,
      gstType: gstType || 'igst',
      totalTax: totalTax,
      igst: gstType === 'igst' ? totalTax : 0,
      cgst: gstType === 'cgst_sgst' ? (totalTax / 2) : 0,
      sgst: gstType === 'cgst_sgst' ? (totalTax / 2) : 0,
      total: grandTotal,
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
      .populate('supplierId', 'companyName')
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
      .populate('createdBy', 'name')
      .populate('supplierId', 'companyName gstNumber phone email');

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

    // Optionally reverse stock deduction here
    
    await purchaseReturn.deleteOne();
    res.json({ success: true, message: 'Purchase return deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};