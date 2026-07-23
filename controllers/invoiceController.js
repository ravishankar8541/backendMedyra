// controllers/invoiceController.js - UPDATED WITH INCENTIVE REVERSAL

const Invoice = require('../models/Invoice');
const Lead = require('../models/Lead');
const User = require('../models/User');

// ============================================
// ✅ INCENTIVE CALCULATION
// ============================================
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

    invoiceData.subtotal = subtotal;
    invoiceData.tax = tax;
    invoiceData.total = subtotal + tax;
    
    invoiceData.incentive = totalIncentive;
    invoiceData.profit = totalProfit;
    invoiceData.totalValue = totalValue;
    invoiceData.totalCost = totalCost;
    invoiceData.profitPercentage = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
    
    if (invoiceData.leadId) {
      const lead = await Lead.findById(invoiceData.leadId).populate('assignedTo', 'name');
      if (lead) {
        invoiceData.assignedTo = lead.assignedTo?._id || lead.assignedTo;
        invoiceData.assignedToName = lead.assignedTo?.name || lead.assignedToName || 'Unassigned';
      }
    }

    const invoice = new Invoice(invoiceData);
    await invoice.save();

    // ✅ Credit incentive to salesman
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
          console.log(`✅ Incentive ₹${totalIncentive.toFixed(2)} credited to ${salesman.name}`);
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
    if (status) query.status = status;
    if (type) query.type = type;
    if (search) {
      query.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { 'customer.name': { $regex: search, $options: 'i' } }
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
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }
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

    // ✅ Store invoice data before deletion for reversal
    const invoiceData = {
      invoiceNumber: invoice.invoiceNumber,
      incentive: invoice.incentive || 0,
      profit: invoice.profit || 0,
      totalValue: invoice.totalValue || 0,
      totalCost: invoice.totalCost || 0,
      assignedTo: invoice.assignedTo,
      assignedToName: invoice.assignedToName,
      leadId: invoice.leadId,
      customerName: invoice.customer?.name || 'Unknown'
    };

    // ============================================
    // ✅ REVERSE INCENTIVE FROM SALESMAN
    // ============================================
    if (invoiceData.assignedTo && invoiceData.incentive > 0) {
      try {
        const salesman = await User.findById(invoiceData.assignedTo);
        if (salesman) {
          // ✅ Find the incentive history entry for this invoice
          const historyIndex = salesman.incentiveHistory.findIndex(
            h => h.invoiceNumber === invoiceData.invoiceNumber
          );

          if (historyIndex !== -1) {
            // ✅ Remove from incentive history
            const removedEntry = salesman.incentiveHistory[historyIndex];
            salesman.incentiveHistory.splice(historyIndex, 1);
            
            // ✅ Deduct from totals
            salesman.totalIncentiveEarned = Math.max(0, (salesman.totalIncentiveEarned || 0) - invoiceData.incentive);
            salesman.totalSalesValue = Math.max(0, (salesman.totalSalesValue || 0) - invoiceData.totalValue);
            salesman.totalConversions = Math.max(0, (salesman.totalConversions || 0) - 1);
            salesman.totalProfitGenerated = Math.max(0, (salesman.totalProfitGenerated || 0) - invoiceData.profit);
            
            await salesman.save();
            console.log(`🔄 Incentive ₹${invoiceData.incentive.toFixed(2)} reversed from ${salesman.name} for invoice ${invoiceData.invoiceNumber}`);
          } else {
            // ✅ If not found in history, still deduct from totals
            salesman.totalIncentiveEarned = Math.max(0, (salesman.totalIncentiveEarned || 0) - invoiceData.incentive);
            salesman.totalSalesValue = Math.max(0, (salesman.totalSalesValue || 0) - invoiceData.totalValue);
            salesman.totalConversions = Math.max(0, (salesman.totalConversions || 0) - 1);
            salesman.totalProfitGenerated = Math.max(0, (salesman.totalProfitGenerated || 0) - invoiceData.profit);
            
            await salesman.save();
            console.log(`🔄 Incentive ₹${invoiceData.incentive.toFixed(2)} reversed from ${salesman.name} (history entry not found)`);
          }
        }
      } catch (err) {
        console.error('Error reversing salesman incentive:', err);
        // Don't fail the main operation if incentive reversal fails
      }
    }

    // ============================================
    // ✅ UPDATE LEAD (if linked)
    // ============================================
    if (invoiceData.leadId) {
      try {
        const lead = await Lead.findById(invoiceData.leadId);
        if (lead && lead.status === 'converted') {
          // ✅ Reverse the lead status back to proforma_sent
          lead.status = 'proforma_sent';
          
          // ✅ Deduct incentives from lead
          lead.totalIncentive = Math.max(0, (lead.totalIncentive || 0) - invoiceData.incentive);
          lead.totalProfit = Math.max(0, (lead.totalProfit || 0) - invoiceData.profit);
          lead.totalValue = Math.max(0, (lead.totalValue || 0) - invoiceData.totalValue);
          lead.incentive = Math.max(0, (lead.incentive || 0) - invoiceData.incentive);
          lead.profit = Math.max(0, (lead.profit || 0) - invoiceData.profit);
          lead.value = Math.max(0, (lead.value || 0) - invoiceData.totalValue);
          
          // ✅ Remove conversion date
          lead.conversionDate = null;
          
          // ✅ Add to status history
          lead.statusHistory.push({
            status: 'proforma_sent',
            date: new Date(),
            notes: `🔄 Invoice ${invoiceData.invoiceNumber} deleted. Incentive reversed.`,
            updatedBy: req.user.id
          });
          
          await lead.save();
          console.log(`🔄 Lead ${lead.name} status reverted to proforma_sent`);
        }
      } catch (err) {
        console.error('Error updating lead on invoice delete:', err);
      }
    }

    // ✅ Delete the invoice
    await invoice.deleteOne();

    res.json({
      success: true,
      message: `✅ Invoice ${invoiceData.invoiceNumber} deleted successfully`,
      incentiveReversed: invoiceData.incentive > 0 ? {
        amount: invoiceData.incentive,
        from: invoiceData.assignedToName || 'Unknown',
        reversed: true
      } : null
    });
  } catch (error) {
    console.error('Delete invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// ============================================
// ✅ CREATE INVOICE FROM QUOTATION
// ============================================
exports.createInvoiceFromQuotation = async (req, res) => {
  try {
    const { quotationId } = req.body;
    
    const Quotation = require('../models/Quotation');
    const quotation = await Quotation.findById(quotationId)
      .populate('leadId', 'name phone email address assignedTo assignedToName');
    
    if (!quotation) {
      return res.status(404).json({ 
        success: false, 
        message: 'Quotation not found' 
      });
    }
    
    const existingInvoice = await Invoice.findOne({ quotationId });
    if (existingInvoice) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invoice already exists for this quotation' 
      });
    }
    
    const year = new Date().getFullYear();
    const count = await Invoice.countDocuments();
    const invoiceNumber = `MPDMS${year}/${String(count + 1).padStart(3, '0')}`;
    
    let totalIncentive = 0;
    let totalProfit = 0;
    let totalValue = 0;
    let totalCost = 0;
    
    const itemsWithIncentive = quotation.items.map(item => {
      const quantity = item.quantity || 1;
      const sellingPrice = item.rate || 0;
      const costPrice = item.costPrice || 0;
      const totalValueItem = sellingPrice * quantity;
      const totalCostItem = costPrice * quantity;
      const profitAmountItem = totalValueItem - totalCostItem;
      const profitPercentageItem = totalCostItem > 0 ? (profitAmountItem / totalCostItem) * 100 : 0;
      const incentive = calculateIncentive(totalValueItem, profitPercentageItem);
      
      totalIncentive += incentive;
      totalProfit += profitAmountItem;
      totalValue += totalValueItem;
      totalCost += totalCostItem;
      
      return {
        description: item.productName || item.description || 'Product',
        quantity: item.quantity,
        rate: item.rate,
        taxRate: item.taxRate || 18,
        amount: item.total || (item.quantity * item.rate),
        batch: item.batch || '',
        hsCode: item.hsCode || '',
        mfgDate: item.mfgDate || '',
        expiryDate: item.expiryDate || '',
        unit: item.unit || 'Vial',
        costPrice: costPrice,
        sellingPrice: sellingPrice,
        profitAmount: profitAmountItem,
        profitPercentage: profitPercentageItem,
        incentive: incentive
      };
    });
    
    const invoiceData = {
      invoiceNumber,
      type: quotation.type || 'domestic',
      
      customer: {
        name: quotation.customer?.name || quotation.leadId?.name || 'N/A',
        phone: quotation.customer?.phone || quotation.leadId?.phone || 'N/A',
        email: quotation.customer?.email || quotation.leadId?.email || '',
        address: quotation.customer?.address || quotation.leadId?.address || 'N/A',
        gst: quotation.customer?.gst || '',
        drugLicense: quotation.customer?.drugLicense || '',
        state: quotation.customer?.state || '',
        stateCode: quotation.customer?.stateCode || '',
        country: quotation.customer?.country || 'India'
      },
      
      items: itemsWithIncentive,
      
      subtotal: quotation.subtotal || 0,
      tax: quotation.tax || 0,
      total: quotation.total || 0,
      rounding: quotation.rounding || 0,
      totalInWords: quotation.totalInWords || '',
      
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      
      paymentTerms: quotation.paymentTerms || '100% Advance',
      placeOfSupply: quotation.placeOfSupply || 'Gujarat (24)',
      notes: quotation.notes || 'Thanks for your business.',
      terms: quotation.terms || '"NOT COVER UNDER NARCOTICS & SCOMET LIST."',
      
      portOfLoading: quotation.portOfLoading || '',
      portOfDischarge: quotation.portOfDischarge || '',
      destinationCountry: quotation.destinationCountry || '',
      grossWeight: quotation.grossWeight || '',
      netWeight: quotation.netWeight || '',
      volumetricWeight: quotation.volumetricWeight || '',
      countryOfOriginGoods: quotation.countryOfOriginGoods || 'India',
      totalBoxes: quotation.totalBoxes || '',
      
      quotationId: quotation._id,
      leadId: quotation.leadId?._id || quotation.leadId,
      
      status: 'draft',
      createdBy: req.user.id,
      
      incentive: totalIncentive,
      profit: totalProfit,
      totalValue: totalValue,
      totalCost: totalCost,
      profitPercentage: totalCost > 0 ? (totalProfit / totalCost) * 100 : 0,
      assignedTo: quotation.leadId?.assignedTo || null,
      assignedToName: quotation.leadId?.assignedToName || 'Unassigned'
    };
    
    const invoice = new Invoice(invoiceData);
    await invoice.save();
    
    if (quotation.leadId) {
      await Lead.findByIdAndUpdate(quotation.leadId, {
        status: 'converted',
        conversionDate: new Date()
      });
    }
    
    quotation.status = 'invoiced';
    await quotation.save();
    
    if (quotation.leadId?.assignedTo && totalIncentive > 0) {
      try {
        const salesman = await User.findById(quotation.leadId.assignedTo);
        if (salesman) {
          salesman.totalIncentiveEarned = (salesman.totalIncentiveEarned || 0) + totalIncentive;
          salesman.totalSalesValue = (salesman.totalSalesValue || 0) + totalValue;
          salesman.totalConversions = (salesman.totalConversions || 0) + 1;
          salesman.totalProfitGenerated = (salesman.totalProfitGenerated || 0) + totalProfit;
          
          if (!salesman.incentiveHistory) salesman.incentiveHistory = [];
          salesman.incentiveHistory.push({
            leadId: quotation.leadId._id,
            leadName: quotation.leadId.name || 'Unknown',
            invoiceNumber: invoiceNumber,
            amount: totalIncentive,
            value: totalValue,
            profit: totalProfit,
            profitPercentage: totalCost > 0 ? (totalProfit / totalCost) * 100 : 0,
            date: new Date(),
            status: 'credited'
          });
          
          await salesman.save();
          console.log(`✅ Incentive ₹${totalIncentive.toFixed(2)} credited to ${salesman.name}`);
        }
      } catch (err) {
        console.error('Error updating salesman incentive:', err);
      }
    }
    
    await invoice.populate('createdBy', 'name');
    
    res.status(201).json({
      success: true,
      data: invoice,
      incentive: {
        total: totalIncentive,
        profit: totalProfit,
        value: totalValue,
        profitPercentage: totalCost > 0 ? (totalProfit / totalCost) * 100 : 0,
        salesman: invoiceData.assignedToName || 'Unassigned'
      },
      message: `✅ Invoice ${invoiceNumber} created successfully from quotation!`
    });
    
  } catch (error) {
    console.error('❌ Create invoice from quotation error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to create invoice' 
    });
  }
};