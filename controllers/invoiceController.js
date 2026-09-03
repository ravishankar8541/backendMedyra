// controllers/invoiceController.js
const Invoice = require('../models/Invoice');
const Lead = require('../models/Lead');
const User = require('../models/User');
const Product = require('../models/Product');

const calculateIncentive = (revenue, profitPercentage) => {
  if (profitPercentage >= 35) {
    return revenue * 0.02;
  } else if (profitPercentage >= 25 && profitPercentage < 35) {
    return revenue * 0.0185;
  } else if (profitPercentage >= 20 && profitPercentage < 25) {
    return revenue * 0.0165;
  } else if (profitPercentage >= 15 && profitPercentage < 20) {
    return revenue * 0.0125;
  } else if (profitPercentage >= 10 && profitPercentage < 15) {
    return revenue * 0.004;
  } else {
    return 0;
  }
};

// ============================================
// ✅ ADD PAYMENT / INSTALLMENT TO INVOICE
// ============================================
exports.addInvoicePayment = async (req, res) => {
  try {
    const { amount, method, reference, notes, date } = req.body;
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const payAmount = parseFloat(amount) || 0;
    if (payAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment amount' });
    }

    const currentDue = invoice.dueAmount !== undefined ? invoice.dueAmount : (invoice.total - (invoice.paidAmount || 0));
    
    if (payAmount > currentDue + 0.5) {
      return res.status(400).json({
        success: false,
        message: `Payment amount (₹${payAmount}) exceeds remaining balance (₹${currentDue.toFixed(2)})`
      });
    }

    const newPayment = {
      amount: payAmount,
      date: date ? new Date(date) : new Date(),
      method: method || 'bank_transfer',
      reference: reference || '',
      notes: notes || '',
      receivedBy: req.user?.id
    };

    if (!invoice.payments) invoice.payments = [];
    invoice.payments.push(newPayment);

    let totalPaid = 0;
    invoice.payments.forEach(p => {
      totalPaid += p.amount || 0;
    });

    invoice.paidAmount = Math.round(totalPaid * 100) / 100;
    invoice.dueAmount = Math.max(0, Math.round((invoice.total - totalPaid) * 100) / 100);

    if (invoice.dueAmount <= 0.01) {
      invoice.paymentStatus = 'paid';
      invoice.status = 'paid';
      invoice.paymentDate = new Date();
    } else {
      invoice.paymentStatus = 'partially_paid';
    }

    await invoice.save();

    if (invoice.leadId) {
      try {
        const lead = await Lead.findById(invoice.leadId);
        if (lead) {
          if (invoice.paymentStatus === 'paid') {
            lead.payment = {
              status: 'paid',
              amount: invoice.total,
              method: method || 'bank_transfer',
              date: new Date(),
              reference: reference || ''
            };
          } else {
            lead.payment = {
              status: 'partial',
              amount: totalPaid,
              method: method || 'bank_transfer',
              date: new Date(),
              reference: reference || ''
            };
          }
          await lead.save();
        }
      } catch (err) {
        console.error('Error updating lead payment:', err);
      }
    }

    res.json({
      success: true,
      data: invoice,
      message: `✅ Payment of ₹${payAmount} recorded successfully! Remaining: ₹${invoice.dueAmount.toFixed(2)}`
    });
  } catch (error) {
    console.error('Add payment error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// ============================================
// ✅ UPDATE INVOICE ITEMS / QUANTITY (FIXED BATCH LOTS STOCK CHECK)
// ============================================
exports.updateInvoiceItems = async (req, res) => {
  try {
    const { id } = req.params;
    const { items: newItems } = req.body;

    if (!newItems || !Array.isArray(newItems) || newItems.length === 0) {
      return res.status(400).json({ success: false, message: 'Items are required' });
    }

    const invoice = await Invoice.findById(id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    let proformaItems = [];
    if (invoice.leadId && invoice.proformaNumber) {
      const lead = await Lead.findById(invoice.leadId);
      if (lead) {
        const pf = (lead.proformas || []).find(p => p.number === invoice.proformaNumber) || 
                   (lead.proforma?.number === invoice.proformaNumber ? lead.proforma : null);
        if (pf && pf.items) proformaItems = pf.items;
      }
    }

    // Process each item & adjust stock difference
    for (const newItem of newItems) {
      if (newItem.freight) continue;

      const cleanItemName = (newItem.description || newItem.productName || '').trim().toLowerCase();

      const oldItem = invoice.items.find(i => 
        (i.description || '').trim().toLowerCase() === cleanItemName
      );

      const oldQty = oldItem ? Number(oldItem.quantity) || 0 : 0;
      const targetQty = Number(newItem.quantity) || 0;
      const diff = targetQty - oldQty; // e.g. 2 - 1 = +1 extra required

      // 1. Proforma max limit check
      const originalPfItem = proformaItems.find(pi => 
        (pi.productName || pi.description || '').trim().toLowerCase() === cleanItemName
      );
      if (originalPfItem) {
        const maxPfQty = Number(originalPfItem.quantity) || 0;
        if (targetQty > maxPfQty) {
          return res.status(400).json({
            success: false,
            message: `⚠️ Quantity for "${newItem.description}" cannot exceed proforma limit (${maxPfQty}).`
          });
        }
      }

      // 2. Stock check across all matching batch lots
      if (diff !== 0) {
        let product = null;
        if (newItem.productId) {
          product = await Product.findById(newItem.productId);
        }
        if (!product) {
          product = await Product.findOne({
            name: new RegExp(`^${(newItem.description || newItem.productName || '').trim()}$`, 'i')
          });
        }

        if (product) {
          if (product.productType === 'batch') {
            const batchName = (newItem.batch || '').trim().toLowerCase();
            
            let matchingBatches = (product.batches || []).filter(
              b => (b.batchNumber || '').trim().toLowerCase() === batchName
            );

            if (matchingBatches.length === 0) {
              matchingBatches = product.batches || [];
            }

            // Calculate total available across all matching lots
            const totalAvailable = matchingBatches.reduce(
              (sum, b) => sum + Math.max(0, (Number(b.quantity) || 0) - (Number(b.reservedQuantity) || 0)),
              0
            );

            if (diff > 0) {
              if (totalAvailable < diff) {
                return res.status(400).json({
                  success: false,
                  message: `⚠️ Insufficient stock for ${product.name}. Available: ${totalAvailable}, Extra required: ${diff}`
                });
              }

              // Deduct from lots that have available stock
              let remainingToDeduct = diff;
              for (const batch of matchingBatches) {
                if (remainingToDeduct <= 0) break;
                const availInBatch = Math.max(0, (Number(batch.quantity) || 0) - (Number(batch.reservedQuantity) || 0));
                const take = Math.min(availInBatch, remainingToDeduct);
                batch.quantity = Math.max(0, (Number(batch.quantity) || 0) - take);
                remainingToDeduct -= take;
              }
            } else if (diff < 0) {
              // Add back stock to the latest lot
              const restoreQty = Math.abs(diff);
              if (matchingBatches.length > 0) {
                matchingBatches[matchingBatches.length - 1].quantity = 
                  (Number(matchingBatches[matchingBatches.length - 1].quantity) || 0) + restoreQty;
              }
            }

            product.stock = (product.batches || []).reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
            product.reservedStock = (product.batches || []).reduce((sum, b) => sum + (Number(b.reservedQuantity) || 0), 0);
          } else {
            const available = Math.max(0, (Number(product.stock) || 0) - (Number(product.reservedStock) || 0));
            if (diff > 0 && available < diff) {
              return res.status(400).json({
                success: false,
                message: `⚠️ Insufficient stock for ${product.name}. Available: ${available}, Extra required: ${diff}`
              });
            }
            product.stock = Math.max(0, (Number(product.stock) || 0) - diff);
          }

          await product.save();
        }
      }
    }

    // Recalculate invoice totals
    let subtotal = 0;
    let tax = 0;
    let totalIncentive = 0;
    let totalProfit = 0;
    let totalValue = 0;
    let totalCost = 0;

    const updatedInvoiceItems = newItems.map(item => {
      const qty = Number(item.quantity) || 1;
      const rate = Number(item.rate) || 0;
      const taxRate = Number(item.taxRate) || 0;
      const costPrice = Number(item.costPrice) || 0;
      const amount = qty * rate;

      subtotal += amount;
      tax += (amount * taxRate) / 100;

      const totalVal = rate * qty;
      const totalCst = costPrice * qty;
      const profitAmt = totalVal - totalCst;
      const profitPct = totalCst > 0 ? (profitAmt / totalCst) * 100 : 0;
      const incentive = calculateIncentive(totalVal, profitPct);

      if (!item.freight) {
        totalIncentive += incentive;
        totalProfit += profitAmt;
        totalValue += totalVal;
        totalCost += totalCst;
      }

      return {
        description: item.description || item.productName || 'Product',
        quantity: qty,
        rate,
        taxRate,
        amount,
        batch: item.batch || '',
        hsCode: item.hsCode || '',
        mfgDate: item.mfgDate || '',
        expiryDate: item.expiryDate || '',
        unit: item.unit || 'Vial',
        countryOfOrigin: item.countryOfOrigin || 'India',
        costPrice,
        sellingPrice: rate,
        profitAmount: profitAmt,
        profitPercentage: profitPct,
        incentive,
        freight: !!item.freight
      };
    });

    const grandTotal = Math.round(subtotal + tax);
    const rounding = Number((grandTotal - (subtotal + tax)).toFixed(2));

    invoice.items = updatedInvoiceItems;
    invoice.subtotal = Math.round(subtotal * 100) / 100;
    invoice.tax = Math.round(tax * 100) / 100;
    invoice.total = grandTotal;
    invoice.rounding = rounding;
    invoice.incentive = totalIncentive;
    invoice.profit = totalProfit;
    invoice.totalValue = totalValue;
    invoice.totalCost = totalCost;

    const paid = Number(invoice.paidAmount) || 0;
    invoice.dueAmount = Math.max(0, Math.round((grandTotal - paid) * 100) / 100);
    invoice.paymentStatus = invoice.dueAmount <= 0.01 ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid';

    await invoice.save();

    res.json({
      success: true,
      data: invoice,
      message: `✅ Invoice quantity updated successfully!`
    });
  } catch (error) {
    console.error('Update invoice items error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// ============================================
// ✅ CREATE INVOICE
// ============================================
exports.createInvoice = async (req, res) => {
  try {
    const invoiceData = req.body;
    invoiceData.createdBy = req.user?.id;

    if (!invoiceData.customer || !invoiceData.customer.name) {
      return res.status(400).json({
        success: false,
        message: 'Customer information required'
      });
    }

    let subtotal = 0;
    let tax = 0;
    let totalIncentive = 0;
    let totalProfit = 0;
    let totalValue = 0;
    let totalCost = 0;

    if (invoiceData.items && invoiceData.items.length > 0) {
      invoiceData.items.forEach(item => {
        const itemAmount = item.quantity * item.rate;
        const itemTax = (itemAmount * (item.taxRate || 0)) / 100;
        subtotal += itemAmount;
        tax += itemTax;
        item.amount = itemAmount;
        
        const costPrice = item.costPrice || 0;
        const sellingPrice = item.rate || 0;
        const quantity = item.quantity || 1;
        const totalValueItem = sellingPrice * quantity;
        const totalCostItem = costPrice * quantity;
        const profitAmountItem = totalValueItem - totalCostItem;
        const profitPercentageItem = totalCostItem > 0 ? (profitAmountItem / totalCostItem) * 100 : 0;
        const incentive = calculateIncentive(totalValueItem, profitPercentageItem);
        
        item.sellingPrice = sellingPrice;
        item.costPrice = costPrice;
        item.profitAmount = profitAmountItem;
        item.profitPercentage = profitPercentageItem;
        item.incentive = incentive;
        
        totalIncentive += incentive;
        totalProfit += profitAmountItem;
        totalValue += totalValueItem;
        totalCost += totalCostItem;
      });
    }

    const totalInvoiceAmount = subtotal + tax;
    invoiceData.subtotal = subtotal;
    invoiceData.tax = tax;
    invoiceData.total = totalInvoiceAmount;
    invoiceData.incentive = totalIncentive;
    invoiceData.profit = totalProfit;
    invoiceData.totalValue = totalValue;
    invoiceData.totalCost = totalCost;
    invoiceData.profitPercentage = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
    
    const initPay = parseFloat(invoiceData.initialPayment) || 0;
    if (initPay > 0) {
      invoiceData.payments = [{
        amount: initPay,
        date: new Date(),
        method: invoiceData.paymentMethod || 'advance',
        reference: invoiceData.paymentReference || '',
        notes: invoiceData.paymentNotes || 'Advance payment',
        receivedBy: req.user?.id
      }];
      invoiceData.paidAmount = initPay;
      invoiceData.dueAmount = Math.max(0, Math.round((totalInvoiceAmount - initPay) * 100) / 100);
      invoiceData.paymentStatus = initPay >= totalInvoiceAmount ? 'paid' : 'partially_paid';
      if (initPay >= totalInvoiceAmount) invoiceData.status = 'paid';
    } else {
      invoiceData.paidAmount = 0;
      invoiceData.dueAmount = totalInvoiceAmount;
      invoiceData.paymentStatus = 'unpaid';
    }

    if (invoiceData.leadId) {
      const lead = await Lead.findById(invoiceData.leadId).populate('assignedTo', 'name');
      if (lead) {
        invoiceData.assignedTo = lead.assignedTo?._id || lead.assignedTo;
        invoiceData.assignedToName = lead.assignedTo?.name || lead.assignedToName || 'Unassigned';
      }
    }

    const invoice = new Invoice(invoiceData);
    await invoice.save();

    res.status(201).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// ============================================
// ✅ GET ALL INVOICES
// ============================================
exports.getInvoices = async (req, res) => {
  try {
    const { page = 1, limit = 100, status, type, search } = req.query;

    const query = {};
    if (status && status !== 'all') query.status = status;
    if (type && type !== 'all') query.type = type;
    if (search) {
      query.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { 'customer.name': { $regex: search, $options: 'i' } },
        { 'customer.phone': { $regex: search, $options: 'i' } }
      ];
    }

    const invoices = await Invoice.find(query)
      .populate('createdBy', 'name email')
      .populate('assignedTo', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Invoice.countDocuments(query);

    res.json({
      success: true,
      data: invoices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// ============================================
// ✅ GET SINGLE INVOICE
// ============================================
exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('assignedTo', 'name email');

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    res.json({ success: true, data: invoice });
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// ============================================
// ✅ UPDATE INVOICE STATUS
// ============================================
exports.updateInvoiceStatus = async (req, res) => {
  try {
    const { status, paymentDate } = req.body;
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    invoice.status = status;
    if (status === 'paid' && paymentDate) {
      invoice.paymentDate = paymentDate;
      invoice.dueAmount = 0;
      invoice.paidAmount = invoice.total;
      invoice.paymentStatus = 'paid';
    }

    await invoice.save();
    res.json({ success: true, data: invoice });
  } catch (error) {
    console.error('Update invoice status error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    // ⭐ Automatically clean up double-entry journal vouchers for this invoice
    const JournalEntry = require('../models/JournalEntry');
    await JournalEntry.deleteMany({
      $or: [
        { sourceId: invoice._id },
        { referenceNumber: invoice.invoiceNumber }
      ]
    });

    await invoice.deleteOne();
    res.json({ success: true, message: `✅ Invoice and associated journal vouchers deleted successfully` });
  } catch (error) {
    console.error('Delete invoice error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};