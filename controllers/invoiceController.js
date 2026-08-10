// controllers/invoiceController.js - FULL UPDATED VERSION WITH INSTALLMENTS
const Invoice = require('../models/Invoice');
const Lead = require('../models/Lead');
const User = require('../models/User');

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
      receivedBy: req.user.id
    };

    if (!invoice.payments) invoice.payments = [];
    invoice.payments.push(newPayment);

    // Recalculate totals
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

    // ✅ Update lead payment status if linked
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
// ✅ CREATE INVOICE
// ============================================
exports.createInvoice = async (req, res) => {
  try {
    const invoiceData = req.body;
    invoiceData.createdBy = req.user.id;

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
    
    // Handle initial payment
    const initPay = parseFloat(invoiceData.initialPayment) || 0;
    if (initPay > 0) {
      invoiceData.payments = [{
        amount: initPay,
        date: new Date(),
        method: invoiceData.paymentMethod || 'advance',
        reference: invoiceData.paymentReference || '',
        notes: invoiceData.paymentNotes || 'Advance payment',
        receivedBy: req.user.id
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

    // Credit incentive to salesman
    if (invoiceData.assignedTo && totalIncentive > 0) {
      try {
        const salesman = await User.findById(invoiceData.assignedTo);
        if (salesman) {
          salesman.totalIncentiveEarned = (salesman.totalIncentiveEarned || 0) + totalIncentive;
          salesman.totalSalesValue = (salesman.totalSalesValue || 0) + totalValue;
          salesman.totalConversions = (salesman.totalConversions || 0) + 1;
          salesman.totalProfitGenerated = (salesman.totalProfitGenerated || 0) + totalProfit;
          
          if (!salesman.incentiveHistory) salesman.incentiveHistory = [];
          salesman.incentiveHistory.push({
            leadId: invoiceData.leadId,
            leadName: invoiceData.customer?.name || 'Unknown',
            invoiceNumber: invoice.invoiceNumber,
            amount: totalIncentive,
            value: totalValue,
            profit: totalProfit,
            profitPercentage: totalCost > 0 ? (totalProfit / totalCost) * 100 : 0,
            date: new Date(),
            status: 'credited'
          });
          
          await salesman.save();
        }
      } catch (err) {
        console.error('Error updating salesman incentive:', err);
      }
    }

    res.status(201).json({
      success: true,
      data: invoice,
      incentive: {
        total: totalIncentive,
        profit: totalProfit,
        value: totalValue,
        profitPercentage: totalCost > 0 ? (totalProfit / totalCost) * 100 : 0,
        salesman: invoiceData.assignedToName || 'Unassigned'
      }
    });
  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// ============================================
// ✅ GET ALL INVOICES
// ============================================
exports.getInvoices = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, type, search } = req.query;

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
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
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
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    res.json({
      success: true,
      data: invoice
    });
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
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
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    invoice.status = status;
    if (status === 'paid' && paymentDate) {
      invoice.paymentDate = paymentDate;
      invoice.dueAmount = 0;
      invoice.paidAmount = invoice.total;
      invoice.paymentStatus = 'paid';
    }

    await invoice.save();

    res.json({
      success: true,
      data: invoice
    });
  } catch (error) {
    console.error('Update invoice status error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// ============================================
// ✅ DELETE INVOICE WITH INCENTIVE REVERSAL
// ============================================
exports.deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    const invoiceData = {
      invoiceNumber: invoice.invoiceNumber,
      incentive: invoice.incentive || 0,
      profit: invoice.profit || 0,
      totalValue: invoice.totalValue || 0,
      assignedTo: invoice.assignedTo,
      leadId: invoice.leadId
    };

    if (invoiceData.assignedTo && invoiceData.incentive > 0) {
      try {
        const salesman = await User.findById(invoiceData.assignedTo);
        if (salesman) {
          const historyIndex = (salesman.incentiveHistory || []).findIndex(
            h => h.invoiceNumber === invoiceData.invoiceNumber
          );

          if (historyIndex !== -1) {
            salesman.incentiveHistory.splice(historyIndex, 1);
          }
          salesman.totalIncentiveEarned = Math.max(0, (salesman.totalIncentiveEarned || 0) - invoiceData.incentive);
          salesman.totalSalesValue = Math.max(0, (salesman.totalSalesValue || 0) - invoiceData.totalValue);
          salesman.totalConversions = Math.max(0, (salesman.totalConversions || 0) - 1);
          salesman.totalProfitGenerated = Math.max(0, (salesman.totalProfitGenerated || 0) - invoiceData.profit);
          await salesman.save();
        }
      } catch (err) {
        console.error('Error reversing salesman incentive:', err);
      }
    }

    if (invoiceData.leadId) {
      try {
        const lead = await Lead.findById(invoiceData.leadId);
        if (lead && lead.status === 'converted') {
          lead.status = 'proforma_sent';
          lead.totalIncentive = Math.max(0, (lead.totalIncentive || 0) - invoiceData.incentive);
          lead.totalProfit = Math.max(0, (lead.totalProfit || 0) - invoiceData.profit);
          lead.totalValue = Math.max(0, (lead.totalValue || 0) - invoiceData.totalValue);
          lead.conversionDate = null;
          await lead.save();
        }
      } catch (err) {
        console.error('Error updating lead on invoice delete:', err);
      }
    }

    await invoice.deleteOne();

    res.json({
      success: true,
      message: `✅ Invoice ${invoiceData.invoiceNumber} deleted successfully`
    });
  } catch (error) {
    console.error('Delete invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};