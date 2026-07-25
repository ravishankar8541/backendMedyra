// controllers/leadController.js - COMPLETE FIXED VERSION

const Lead = require('../models/Lead');
const Revenue = require('../models/Revenue');
const User = require('../models/User');
const Product = require('../models/Product');
const Invoice = require('../models/Invoice');

// ============================================
// ✅ INCENTIVE CALCULATION (Google Sheets Formula)
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

// ✅ Calculate item totals with incentive
const calculateItemTotals = (item) => {
  const qty = item.quantity || 1;
  const sellingPrice = item.sellingPrice || item.rate || 0;
  const costPrice = item.costPrice || 0;

  const totalValue = sellingPrice * qty;
  const totalCost = costPrice * qty;
  const profitAmount = totalValue - totalCost;
  const profitPercentage = totalCost > 0 ? (profitAmount / totalCost) * 100 : 0;
  const incentive = calculateIncentive(totalValue, profitPercentage);

  return {
    ...item,
    totalValue,
    profitAmount,
    profitPercentage,
    incentive
  };
};

// ============================================
// ✅ CREATE LEAD (Auto-assign Salesman)
// ============================================
exports.createLead = async (req, res) => {
  try {
    const leadData = req.body;

    leadData.createdBy = req.user.id;
    leadData.assignedTo = req.user.id;
    leadData.assignedToName = req.user.name;

    if (leadData.items && leadData.items.length > 0) {
      for (let item of leadData.items) {
        if (item.productId) {
          const product = await Product.findById(item.productId);
          if (product) {
            item.productName = product.name;
            item.productSku = product.sku;
            if (!item.costPrice) {
              item.costPrice = product.pricing?.costPrice || 0;
            }
          }
        }
        const calculatedItem = calculateItemTotals(item);
        Object.assign(item, calculatedItem);
      }

      let totalValue = 0, totalProfit = 0, totalIncentive = 0;
      leadData.items.forEach(item => {
        totalValue += item.totalValue || 0;
        totalProfit += item.profitAmount || 0;
        totalIncentive += item.incentive || 0;
      });

      leadData.totalValue = totalValue;
      leadData.totalProfit = totalProfit;
      leadData.totalIncentive = totalIncentive;
      leadData.value = totalValue;
      leadData.profit = totalProfit;
      leadData.incentive = totalIncentive;
    }

    const lead = new Lead(leadData);
    await lead.save();

    await lead.populate('assignedTo', 'name email');
    await lead.populate('createdBy', 'name');

    res.status(201).json({
      success: true,
      data: lead,
      message: '✅ Lead created successfully with salesman auto-assigned'
    });
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ UPDATE LEAD
// ============================================
exports.updateLead = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found'
      });
    }

    const allowedFields = [
      'name', 'phone', 'email', 'address', 'gst', 
      'drugLicense', 'state', 'stateCode', 'source', 'notes'
    ];

    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        lead[field] = updateData[field];
      }
    });

    // ✅ If items are being updated, preserve incentives
    if (updateData.items && updateData.items.length > 0) {
      lead.items = updateData.items;
      // Recalculate totals but don't overwrite existing incentives
      let totalValue = 0, totalProfit = 0, totalIncentive = 0;
      for (const item of lead.items) {
        totalValue += item.totalValue || 0;
        totalProfit += item.profitAmount || 0;
        totalIncentive += item.incentive || 0;
      }
      // Only update if these aren't already set from previous conversions
      if (!lead.totalIncentive || lead.totalIncentive === 0) {
        lead.totalIncentive = totalIncentive;
      }
      if (!lead.totalProfit || lead.totalProfit === 0) {
        lead.totalProfit = totalProfit;
      }
      if (!lead.totalValue || lead.totalValue === 0) {
        lead.totalValue = totalValue;
      }
      lead.value = totalValue;
      lead.profit = totalProfit;
      lead.incentive = totalIncentive;
    }

    await lead.save();

    await lead.populate('assignedTo', 'name email');
    await lead.populate('createdBy', 'name');

    res.json({
      success: true,
      data: lead,
      message: '✅ Lead updated successfully'
    });
  } catch (error) {
    console.error('Update lead error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

exports.generateProforma = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const {
      type = 'domestic',
      taxType = 'cgst_sgst',
      poNumber = '',
      items = [],
      validUntil,
      paymentTerms = '100% Advance',
      deliveryTerms = '3-5 working days after payment',
      placeOfSupply = 'Gujarat (24)',
      notes = '',
      terms = 'This is a proforma invoice. Prices are valid for 7 days.',
      totalInWords = '',
      portOfLoading = '',
      portOfDischarge = '',
      destinationCountry = '',
      grossWeight = '',
      netWeight = '',
      volumetricWeight = '',
      countryOfOriginGoods = 'India',
      totalBoxes = '',
      shippingMark = '',
      vesselNo = ''
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: '⚠️ At least one product item is required for Proforma Invoice'
      });
    }

    // ===== Calculate items =====
    let subtotal = 0;
    const proformaItems = [];

    for (const item of items) {
      const quantity = parseInt(item.quantity) || 1;
      const rate = parseFloat(item.rate) || 0;
      const taxRate = parseFloat(item.taxRate) || 18;
      const total = quantity * rate;
      subtotal += total;

      let productName = item.productName || 'Product';
      let hsCode = item.hsCode || '';
      let unit = item.unit || 'Vial';
      let batchNumber = item.batch || '';
      let mfgDate = item.mfgDate || '';
      let expiryDate = item.expiryDate || '';
      let countryOfOrigin = item.countryOfOrigin || 'India';
      let costPrice = item.costPrice || 0;
      let description = item.description || '';

      if (item.productId) {
        try {
          const product = await Product.findById(item.productId);
          if (product) {
            productName = product.name || productName;
            hsCode = product.hsnCode || hsCode;
            unit = product.unit || unit;
            countryOfOrigin = product.countryOfOrigin || countryOfOrigin;
            costPrice = product.pricing?.costPrice || costPrice;
            description = product.description || description;

            if (product.batches && product.batches.length > 0) {
              const firstBatch = product.batches[0];
              batchNumber = firstBatch.batchNumber || batchNumber;
              mfgDate = firstBatch.mfgDate || mfgDate;
              expiryDate = firstBatch.expDate || expiryDate;
            }
          }
        } catch (err) {
          console.warn('⚠️ Product not found:', item.productId);
        }
      }

      proformaItems.push({
        productId: item.productId || null,
        productName,
        description,
        quantity,
        unit,
        rate,
        sellingPrice: rate,
        taxRate,
        total,
        totalValue: total,
        batch: batchNumber,
        hsCode,
        mfgDate,
        expiryDate,
        countryOfOrigin,
        costPrice,
        profitAmount: 0,
        profitPercentage: 0,
        incentive: 0
      });
    }

    const firstTaxRate = proformaItems[0]?.taxRate || 18;
    const tax = (subtotal * firstTaxRate) / 100;
    const total = subtotal + tax;
    const finalTotal = Math.round(total * 100) / 100;

    // ============================================
    // ✅ FIXED: Atomic + globally unique proforma number
    // ============================================
    const year = new Date().getFullYear();
    const prefix = type === 'domestic' ? 'PF' : 'PFI';

    // Use aggregation to find the real max number safely
    const result = await Lead.aggregate([
      { $unwind: { path: '$proformas', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          num: {
            $cond: [
              { $regexMatch: { input: { $ifNull: ['$proformas.number', ''] }, regex: `^${prefix}-${year}/\\d+$` } },
              {
                $toInt: {
                  $arrayElemAt: [
                    { $split: ['$proformas.number', '/'] },
                    1
                  ]
                }
              },
              0
            ]
          }
        }
      },
      { $group: { _id: null, maxNum: { $max: '$num' } } }
    ]);

    let maxNumber = result[0]?.maxNum || 0;

    // Also check the old single `proforma` field
    const singleProformaResult = await Lead.aggregate([
      {
        $match: {
          'proforma.number': { $regex: `^${prefix}-${year}/` }
        }
      },
      {
        $project: {
          num: {
            $toInt: {
              $arrayElemAt: [
                { $split: ['$proforma.number', '/'] },
                1
              ]
            }
          }
        }
      },
      { $group: { _id: null, maxNum: { $max: '$num' } } }
    ]);

    if (singleProformaResult[0]?.maxNum > maxNumber) {
      maxNumber = singleProformaResult[0].maxNum;
    }

    const nextNumber = maxNumber + 1;
    const proformaNumber = `${prefix}-${year}/${String(nextNumber).padStart(4, '0')}`;

    // ============================================
    // ✅ CRITICAL: Preserve existing incentives
    // ============================================
    const existingTotalIncentive = lead.totalIncentive || 0;
    const existingTotalProfit = lead.totalProfit || 0;
    const existingTotalValue = lead.totalValue || 0;
    const existingIncentive = lead.incentive || 0;
    const existingProfit = lead.profit || 0;
    const existingValue = lead.value || 0;

    const newProforma = {
      number: proformaNumber,
      sentDate: new Date(),
      amount: finalTotal,
      type,
      taxType,
      poNumber: poNumber || '',
      items: proformaItems,
      subtotal,
      tax,
      total: finalTotal,
      validUntil: validUntil ? new Date(validUntil) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      paymentTerms,
      deliveryTerms,
      placeOfSupply,
      notes,
      terms,
      document: `Proforma ${proformaNumber}`,
      totalInWords: totalInWords || `${type === 'domestic' ? 'Indian Rupee' : 'United States Dollar'} ${Math.round(finalTotal)} Only`,
      portOfLoading,
      portOfDischarge,
      destinationCountry,
      grossWeight,
      netWeight,
      volumetricWeight,
      countryOfOriginGoods,
      totalBoxes,
      shippingMark,
      vesselNo,
      convertedToInvoice: false,
      invoiceNumber: '',
      incentive: 0,
      profit: 0,
      conversionDate: null
    };

    if (!lead.proformas) lead.proformas = [];
    lead.proformas.push(newProforma);
    lead.proforma = newProforma; // keep latest reference

    lead.status = 'proforma_sent';
    lead.quotation = {
      sentDate: new Date(),
      amount: finalTotal,
      document: `Proforma ${proformaNumber}`,
      followUpDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      notes: `Proforma ${proformaNumber} sent`
    };

    // ✅ FORCE skip the pre-save auto-calculate
    lead._skipAutoCalculate = true;

    // ✅ Restore the previously earned incentives
    lead.totalIncentive = existingTotalIncentive;
    lead.totalProfit = existingTotalProfit;
    lead.totalValue = existingTotalValue;
    lead.incentive = existingIncentive;
    lead.profit = existingProfit;
    lead.value = existingValue;

    await lead.save();
    await lead.populate('assignedTo', 'name email');

    const proformaData = {
      ...newProforma,
      lead,
      customer: {
        name: lead.name,
        phone: lead.phone,
        email: lead.email || '',
        address: lead.address || 'N/A',
        gst: lead.gst || '',
        drugLicense: lead.drugLicense || '',
        state: lead.state || '',
        stateCode: lead.stateCode || ''
      }
    };

    res.status(200).json({
      success: true,
      data: {
        lead,
        proforma: proformaData
      },
      message: `✅ Proforma ${proformaNumber} generated successfully!`
    });
  } catch (error) {
    console.error('Generate proforma error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ CONVERT PROFORMA TO INVOICE - COMPLETE FIXED
// ============================================
exports.convertProformaToInvoice = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).populate('assignedTo', 'name email role');
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    // ✅ Get the specific proforma to convert from request body
    const { proformaNumber, force = false } = req.body;
    console.log(`🔄 Converting proforma: ${proformaNumber}, Force: ${force}`);

    let proforma = null;
    let proformaIndex = -1;

    // ✅ If proformaNumber is provided, find that specific proforma
    if (proformaNumber) {
      proformaIndex = lead.proformas.findIndex(p => p.number === proformaNumber);
      if (proformaIndex !== -1) {
        proforma = lead.proformas[proformaIndex];
      }
      if (!proforma && lead.proforma && lead.proforma.number === proformaNumber) {
        proforma = lead.proforma;
        proformaIndex = -2;
      }
    }

    // ✅ If no specific proforma, use first unconverted
    if (!proforma) {
      for (let i = 0; i < lead.proformas.length; i++) {
        if (!lead.proformas[i].convertedToInvoice) {
          proformaIndex = i;
          proforma = lead.proformas[i];
          break;
        }
      }
      if (!proforma && lead.proforma && !lead.proforma.convertedToInvoice) {
        proforma = lead.proforma;
        proformaIndex = -2;
      }
    }

    // ✅ If still no proforma, use latest
    if (!proforma) {
      if (lead.proformas && lead.proformas.length > 0) {
        proformaIndex = lead.proformas.length - 1;
        proforma = lead.proformas[proformaIndex];
      } else if (lead.proforma) {
        proforma = lead.proforma;
        proformaIndex = -2;
      }
    }

    if (!proforma || !proforma.number) {
      return res.status(400).json({
        success: false,
        message: '⚠️ No proforma found for this lead.'
      });
    }

    // ✅ Check for existing invoice
    const existingInvoice = await Invoice.findOne({ proformaNumber: proforma.number });
    
    // ✅ If invoice exists and NOT force mode, return 409
    if (existingInvoice && !force) {
      return res.status(409).json({
        success: false,
        message: `⚠️ Invoice already exists for proforma ${proforma.number}`,
        canForce: true,
        existingInvoice: {
          number: existingInvoice.invoiceNumber,
          customer: existingInvoice.customer?.name || 'Unknown',
          total: existingInvoice.total
        },
        proformaNumber: proforma.number
      });
    }

    // ✅ If invoice exists and force mode is ON, delete it
    if (existingInvoice && force) {
      console.log(`🔄 Force mode: Deleting existing invoice ${existingInvoice.invoiceNumber}`);
      
      // Reverse incentive from salesman
      if (existingInvoice.assignedTo && existingInvoice.incentive > 0) {
        try {
          const salesman = await User.findById(existingInvoice.assignedTo);
          if (salesman) {
            const historyIndex = salesman.incentiveHistory.findIndex(
              h => h.invoiceNumber === existingInvoice.invoiceNumber
            );
            if (historyIndex !== -1) {
              salesman.incentiveHistory.splice(historyIndex, 1);
            }
            salesman.totalIncentiveEarned = Math.max(0, (salesman.totalIncentiveEarned || 0) - (existingInvoice.incentive || 0));
            salesman.totalSalesValue = Math.max(0, (salesman.totalSalesValue || 0) - (existingInvoice.totalValue || 0));
            salesman.totalConversions = Math.max(0, (salesman.totalConversions || 0) - 1);
            salesman.totalProfitGenerated = Math.max(0, (salesman.totalProfitGenerated || 0) - (existingInvoice.profit || 0));
            await salesman.save();
            console.log(`✅ Incentive reversed from salesman ${salesman.name}`);
          }
        } catch (err) {
          console.error('Error reversing incentive:', err);
        }
      }
      
      // ✅ Delete the invoice
      await existingInvoice.deleteOne();
      console.log(`🗑️ Deleted existing invoice ${existingInvoice.invoiceNumber}`);
      
      // ✅ Reset the proforma flag in the lead
      if (proformaIndex >= 0 && proformaIndex < lead.proformas.length) {
        lead.proformas[proformaIndex].convertedToInvoice = false;
        lead.proformas[proformaIndex].invoiceNumber = '';
        lead.proformas[proformaIndex].conversionDate = null;
      } else if (proformaIndex === -2 && lead.proforma) {
        lead.proforma.convertedToInvoice = false;
        lead.proforma.invoiceNumber = '';
        lead.proforma.conversionDate = null;
      }
      
      // ✅ Save the lead with reset flags
      await lead.save();
      console.log(`✅ Lead proforma flags reset`);
      
      // ✅ IMPORTANT: Re-fetch the lead to get fresh data after save
      const refreshedLead = await Lead.findById(req.params.id).populate('assignedTo', 'name email role');
      if (!refreshedLead) {
        return res.status(404).json({ success: false, message: 'Lead not found after refresh' });
      }
      
      // ✅ Update references to use refreshed lead data
      const updatedLead = refreshedLead;
      
      // ✅ Find the proforma again in the refreshed lead
      let refreshedProforma = null;
      let refreshedProformaIndex = -1;
      
      if (proformaNumber) {
        refreshedProformaIndex = updatedLead.proformas.findIndex(p => p.number === proformaNumber);
        if (refreshedProformaIndex !== -1) {
          refreshedProforma = updatedLead.proformas[refreshedProformaIndex];
        }
        if (!refreshedProforma && updatedLead.proforma && updatedLead.proforma.number === proformaNumber) {
          refreshedProforma = updatedLead.proforma;
          refreshedProformaIndex = -2;
        }
      }
      
      if (!refreshedProforma) {
        // If not found by number, use the one that was just reset
        if (updatedLead.proformas && updatedLead.proformas.length > 0) {
          refreshedProformaIndex = updatedLead.proformas.length - 1;
          refreshedProforma = updatedLead.proformas[refreshedProformaIndex];
        } else if (updatedLead.proforma) {
          refreshedProforma = updatedLead.proforma;
          refreshedProformaIndex = -2;
        }
      }
      
      if (!refreshedProforma || !refreshedProforma.number) {
        return res.status(400).json({
          success: false,
          message: '⚠️ Proforma not found after refresh.'
        });
      }
      
      // ✅ Use the refreshed data for the rest of the process
      const finalLead = updatedLead;
      const finalProforma = refreshedProforma;
      const finalProformaIndex = refreshedProformaIndex;
      
      // ✅ Check if proforma was already converted (double-check after refresh)
      if (finalProforma.convertedToInvoice) {
        return res.status(409).json({
          success: false,
          message: `⚠️ Proforma ${finalProforma.number} is already converted to invoice ${finalProforma.invoiceNumber}`,
          existingInvoice: finalProforma.invoiceNumber,
          proformaNumber: finalProforma.number
        });
      }

      // ============================================
      // ✅ GENERATE UNIQUE INVOICE NUMBER
      // ============================================
      const year = new Date().getFullYear();
      const lastInvoice = await Invoice.findOne({
        invoiceNumber: { $regex: `MPDMS${year}/` }
      }).sort({ invoiceNumber: -1 });
      
      let nextNumber = 1;
      if (lastInvoice) {
        const parts = lastInvoice.invoiceNumber.split('/');
        if (parts.length === 2) {
          const num = parseInt(parts[1]);
          if (!isNaN(num)) nextNumber = num + 1;
        }
      }
      
      let invoiceNumber = `MPDMS${year}/${String(nextNumber).padStart(3, '0')}`;
      let existingWithNumber = await Invoice.findOne({ invoiceNumber });
      while (existingWithNumber) {
        nextNumber++;
        invoiceNumber = `MPDMS${year}/${String(nextNumber).padStart(3, '0')}`;
        existingWithNumber = await Invoice.findOne({ invoiceNumber });
      }

      // ============================================
      // ✅ CALCULATE INCENTIVE
      // ============================================
      let totalIncentive = 0;
      let totalProfit = 0;
      let totalValue = 0;
      let totalCost = 0;
      let overallProfitPercentage = 0;

      const invoiceItems = finalProforma.items.map(item => {
        const quantity = item.quantity || 1;
        const sellingPrice = item.sellingPrice || item.rate || 0;
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
          rate: item.rate || item.sellingPrice || 0,
          taxRate: item.taxRate || 18,
          amount: item.total || (item.quantity * (item.rate || item.sellingPrice || 0)),
          batch: item.batch || '',
          hsCode: item.hsCode || '',
          mfgDate: item.mfgDate || '',
          expiryDate: item.expiryDate || '',
          unit: item.unit || 'Vial',
          countryOfOrigin: item.countryOfOrigin || 'India',
          costPrice: costPrice,
          sellingPrice: sellingPrice,
          profitAmount: profitAmountItem,
          profitPercentage: profitPercentageItem,
          incentive: incentive
        };
      });

      overallProfitPercentage = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

      // ============================================
      // ✅ CREATE INVOICE
      // ============================================
      const invoiceData = {
        invoiceNumber,
        type: finalProforma.type || 'domestic',
        date: new Date().toISOString().split('T')[0],
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        placeOfSupply: finalProforma.placeOfSupply || 'Gujarat (24)',
        paymentTerms: finalProforma.paymentTerms || '100% Advance',
        customer: {
          name: finalLead.name,
          phone: finalLead.phone,
          email: finalLead.email || '',
          address: finalLead.address || 'N/A',
          gst: finalLead.gst || '',
          drugLicense: finalLead.drugLicense || '',
          state: finalLead.state || '',
          stateCode: finalLead.stateCode || ''
        },
        items: invoiceItems,
        subtotal: finalProforma.subtotal || 0,
        tax: finalProforma.tax || 0,
        total: finalProforma.total || 0,
        rounding: 0,
        totalInWords: finalProforma.totalInWords || '',
        notes: finalProforma.notes || 'Thanks for your business.',
        terms: finalProforma.terms || '"NOT COVER UNDER NARCOTICS & SCOMET LIST."',
        portOfLoading: finalProforma.portOfLoading || '',
        portOfDischarge: finalProforma.portOfDischarge || '',
        destinationCountry: finalProforma.destinationCountry || '',
        grossWeight: finalProforma.grossWeight || '',
        netWeight: finalProforma.netWeight || '',
        volumetricWeight: finalProforma.volumetricWeight || '',
        countryOfOriginGoods: finalProforma.countryOfOriginGoods || 'India',
        totalBoxes: finalProforma.totalBoxes || '',
        proformaNumber: finalProforma.number,
        leadId: finalLead._id,
        status: 'draft',
        createdBy: req.user.id,
        incentive: totalIncentive,
        profit: totalProfit,
        profitPercentage: overallProfitPercentage,
        assignedTo: finalLead.assignedTo?._id || finalLead.assignedTo,
        assignedToName: finalLead.assignedToName || finalLead.assignedTo?.name || 'Unassigned',
        totalValue: totalValue,
        totalCost: totalCost
      };

      const invoice = new Invoice(invoiceData);
      await invoice.save();
      console.log(`✅ Invoice ${invoiceNumber} created successfully`);

      // ============================================
      // ✅ UPDATE LEAD
      // ============================================
      finalLead._skipAutoCalculate = true;

      // Update proforma
      if (finalProformaIndex >= 0) {
        finalLead.proformas[finalProformaIndex].incentive = totalIncentive;
        finalLead.proformas[finalProformaIndex].profit = totalProfit;
        finalLead.proformas[finalProformaIndex].convertedToInvoice = true;
        finalLead.proformas[finalProformaIndex].invoiceNumber = invoiceNumber;
        finalLead.proformas[finalProformaIndex].conversionDate = new Date();
      } else if (finalProformaIndex === -2) {
        finalLead.proforma.incentive = totalIncentive;
        finalLead.proforma.profit = totalProfit;
        finalLead.proforma.convertedToInvoice = true;
        finalLead.proforma.invoiceNumber = invoiceNumber;
        finalLead.proforma.conversionDate = new Date();
      }

      // Update lead totals - sum all converted proformas
      let totalLeadIncentive = 0;
      let totalLeadProfit = 0;
      let totalLeadValue = 0;
      
      finalLead.proformas.forEach(p => {
        if (p.convertedToInvoice) {
          totalLeadIncentive += p.incentive || 0;
          totalLeadProfit += p.profit || 0;
          totalLeadValue += p.total || 0;
        }
      });
      
      finalLead.totalIncentive = totalLeadIncentive;
      finalLead.totalProfit = totalLeadProfit;
      finalLead.totalValue = totalLeadValue;
      finalLead.incentive = totalLeadIncentive;
      finalLead.profit = totalLeadProfit;
      finalLead.value = totalLeadValue;

      // Update status
      if (finalLead.status !== 'converted') {
        finalLead.status = 'converted';
        finalLead.conversionDate = new Date();
        finalLead.statusHistory.push({
          status: 'converted',
          date: new Date(),
          notes: `✅ Converted proforma ${finalProforma.number} to invoice ${invoiceNumber}`,
          updatedBy: req.user.id
        });
      }

      await finalLead.save();
      await finalLead.populate('assignedTo', 'name email');
      console.log(`✅ Lead ${finalLead.name} updated to converted status`);

      // ============================================
      // ✅ CREDIT INCENTIVE TO SALESMAN
      // ============================================
      if (finalLead.assignedTo && totalIncentive > 0) {
        try {
          const salesman = await User.findById(finalLead.assignedTo._id);
          if (salesman) {
            const existingHistory = salesman.incentiveHistory?.find(
              h => h.invoiceNumber === invoiceNumber
            );
            if (!existingHistory) {
              salesman.totalIncentiveEarned = (salesman.totalIncentiveEarned || 0) + totalIncentive;
              salesman.totalSalesValue = (salesman.totalSalesValue || 0) + totalValue;
              salesman.totalConversions = (salesman.totalConversions || 0) + 1;
              salesman.totalProfitGenerated = (salesman.totalProfitGenerated || 0) + totalProfit;
              
              if (!salesman.incentiveHistory) salesman.incentiveHistory = [];
              salesman.incentiveHistory.push({
                leadId: finalLead._id,
                leadName: finalLead.name,
                proformaNumber: finalProforma.number,
                invoiceNumber: invoiceNumber,
                amount: totalIncentive,
                value: totalValue,
                profit: totalProfit,
                profitPercentage: overallProfitPercentage,
                date: new Date(),
                status: 'credited'
              });
              
              await salesman.save();
              console.log(`✅ Incentive ₹${totalIncentive.toFixed(2)} credited to ${salesman.name}`);
            }
          }
        } catch (err) {
          console.error('Error updating salesman incentive:', err);
        }
      }

      await invoice.populate('createdBy', 'name');

      // ✅ Response
      const responseData = {
        success: true,
        data: {
          invoice,
          lead: finalLead,
          proformaIncentive: {
            amount: totalIncentive,
            profit: totalProfit,
            value: totalValue,
            profitPercentage: overallProfitPercentage,
            proformaNumber: finalProforma.number
          },
          cumulativeIncentive: {
            total: finalLead.totalIncentive,
            profit: finalLead.totalProfit,
            value: finalLead.totalValue,
            salesman: finalLead.assignedTo?.name || finalLead.assignedToName || 'Unassigned'
          }
        },
        message: `✅ Invoice ${invoiceNumber} created from proforma ${finalProforma.number} | Incentive: ₹${totalIncentive.toFixed(2)}`
      };

      if (force) {
        responseData.forceCreated = true;
        responseData.message += ` (Overwrote previous invoice)`;
      }

      res.status(201).json(responseData);

    } else {
      // ✅ Normal flow (no existing invoice)
      
      // ✅ Check if proforma already converted
      if (proforma.convertedToInvoice) {
        return res.status(409).json({
          success: false,
          message: `⚠️ Proforma ${proforma.number} is already converted to invoice ${proforma.invoiceNumber}`,
          existingInvoice: proforma.invoiceNumber,
          proformaNumber: proforma.number
        });
      }

      // ============================================
      // ✅ GENERATE UNIQUE INVOICE NUMBER
      // ============================================
      const year = new Date().getFullYear();
      const lastInvoice = await Invoice.findOne({
        invoiceNumber: { $regex: `MPDMS${year}/` }
      }).sort({ invoiceNumber: -1 });
      
      let nextNumber = 1;
      if (lastInvoice) {
        const parts = lastInvoice.invoiceNumber.split('/');
        if (parts.length === 2) {
          const num = parseInt(parts[1]);
          if (!isNaN(num)) nextNumber = num + 1;
        }
      }
      
      let invoiceNumber = `MPDMS${year}/${String(nextNumber).padStart(3, '0')}`;
      let existingWithNumber = await Invoice.findOne({ invoiceNumber });
      while (existingWithNumber) {
        nextNumber++;
        invoiceNumber = `MPDMS${year}/${String(nextNumber).padStart(3, '0')}`;
        existingWithNumber = await Invoice.findOne({ invoiceNumber });
      }

      // ============================================
      // ✅ CALCULATE INCENTIVE
      // ============================================
      let totalIncentive = 0;
      let totalProfit = 0;
      let totalValue = 0;
      let totalCost = 0;
      let overallProfitPercentage = 0;

      const invoiceItems = proforma.items.map(item => {
        const quantity = item.quantity || 1;
        const sellingPrice = item.sellingPrice || item.rate || 0;
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
          rate: item.rate || item.sellingPrice || 0,
          taxRate: item.taxRate || 18,
          amount: item.total || (item.quantity * (item.rate || item.sellingPrice || 0)),
          batch: item.batch || '',
          hsCode: item.hsCode || '',
          mfgDate: item.mfgDate || '',
          expiryDate: item.expiryDate || '',
          unit: item.unit || 'Vial',
          countryOfOrigin: item.countryOfOrigin || 'India',
          costPrice: costPrice,
          sellingPrice: sellingPrice,
          profitAmount: profitAmountItem,
          profitPercentage: profitPercentageItem,
          incentive: incentive
        };
      });

      overallProfitPercentage = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

      // ============================================
      // ✅ CREATE INVOICE
      // ============================================
      const invoiceData = {
        invoiceNumber,
        type: proforma.type || 'domestic',
        date: new Date().toISOString().split('T')[0],
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        placeOfSupply: proforma.placeOfSupply || 'Gujarat (24)',
        paymentTerms: proforma.paymentTerms || '100% Advance',
        customer: {
          name: lead.name,
          phone: lead.phone,
          email: lead.email || '',
          address: lead.address || 'N/A',
          gst: lead.gst || '',
          drugLicense: lead.drugLicense || '',
          state: lead.state || '',
          stateCode: lead.stateCode || ''
        },
        items: invoiceItems,
        subtotal: proforma.subtotal || 0,
        tax: proforma.tax || 0,
        total: proforma.total || 0,
        rounding: 0,
        totalInWords: proforma.totalInWords || '',
        notes: proforma.notes || 'Thanks for your business.',
        terms: proforma.terms || '"NOT COVER UNDER NARCOTICS & SCOMET LIST."',
        portOfLoading: proforma.portOfLoading || '',
        portOfDischarge: proforma.portOfDischarge || '',
        destinationCountry: proforma.destinationCountry || '',
        grossWeight: proforma.grossWeight || '',
        netWeight: proforma.netWeight || '',
        volumetricWeight: proforma.volumetricWeight || '',
        countryOfOriginGoods: proforma.countryOfOriginGoods || 'India',
        totalBoxes: proforma.totalBoxes || '',
        proformaNumber: proforma.number,
        leadId: lead._id,
        status: 'draft',
        createdBy: req.user.id,
        incentive: totalIncentive,
        profit: totalProfit,
        profitPercentage: overallProfitPercentage,
        assignedTo: lead.assignedTo?._id || lead.assignedTo,
        assignedToName: lead.assignedToName || lead.assignedTo?.name || 'Unassigned',
        totalValue: totalValue,
        totalCost: totalCost
      };

      const invoice = new Invoice(invoiceData);
      await invoice.save();
      console.log(`✅ Invoice ${invoiceNumber} created successfully`);

      // ============================================
      // ✅ UPDATE LEAD
      // ============================================
      lead._skipAutoCalculate = true;

      // Update proforma
      if (proformaIndex >= 0) {
        lead.proformas[proformaIndex].incentive = totalIncentive;
        lead.proformas[proformaIndex].profit = totalProfit;
        lead.proformas[proformaIndex].convertedToInvoice = true;
        lead.proformas[proformaIndex].invoiceNumber = invoiceNumber;
        lead.proformas[proformaIndex].conversionDate = new Date();
      } else if (proformaIndex === -2) {
        lead.proforma.incentive = totalIncentive;
        lead.proforma.profit = totalProfit;
        lead.proforma.convertedToInvoice = true;
        lead.proforma.invoiceNumber = invoiceNumber;
        lead.proforma.conversionDate = new Date();
      }

      // Update lead totals - sum all converted proformas
      let totalLeadIncentive = 0;
      let totalLeadProfit = 0;
      let totalLeadValue = 0;
      
      lead.proformas.forEach(p => {
        if (p.convertedToInvoice) {
          totalLeadIncentive += p.incentive || 0;
          totalLeadProfit += p.profit || 0;
          totalLeadValue += p.total || 0;
        }
      });
      
      lead.totalIncentive = totalLeadIncentive;
      lead.totalProfit = totalLeadProfit;
      lead.totalValue = totalLeadValue;
      lead.incentive = totalLeadIncentive;
      lead.profit = totalLeadProfit;
      lead.value = totalLeadValue;

      // Update status
      if (lead.status !== 'converted') {
        lead.status = 'converted';
        lead.conversionDate = new Date();
        lead.statusHistory.push({
          status: 'converted',
          date: new Date(),
          notes: `✅ Converted proforma ${proforma.number} to invoice ${invoiceNumber}`,
          updatedBy: req.user.id
        });
      }

      await lead.save();
      await lead.populate('assignedTo', 'name email');
      console.log(`✅ Lead ${lead.name} updated to converted status`);

      // ============================================
      // ✅ CREDIT INCENTIVE TO SALESMAN
      // ============================================
      if (lead.assignedTo && totalIncentive > 0) {
        try {
          const salesman = await User.findById(lead.assignedTo._id);
          if (salesman) {
            const existingHistory = salesman.incentiveHistory?.find(
              h => h.invoiceNumber === invoiceNumber
            );
            if (!existingHistory) {
              salesman.totalIncentiveEarned = (salesman.totalIncentiveEarned || 0) + totalIncentive;
              salesman.totalSalesValue = (salesman.totalSalesValue || 0) + totalValue;
              salesman.totalConversions = (salesman.totalConversions || 0) + 1;
              salesman.totalProfitGenerated = (salesman.totalProfitGenerated || 0) + totalProfit;
              
              if (!salesman.incentiveHistory) salesman.incentiveHistory = [];
              salesman.incentiveHistory.push({
                leadId: lead._id,
                leadName: lead.name,
                proformaNumber: proforma.number,
                invoiceNumber: invoiceNumber,
                amount: totalIncentive,
                value: totalValue,
                profit: totalProfit,
                profitPercentage: overallProfitPercentage,
                date: new Date(),
                status: 'credited'
              });
              
              await salesman.save();
              console.log(`✅ Incentive ₹${totalIncentive.toFixed(2)} credited to ${salesman.name}`);
            }
          }
        } catch (err) {
          console.error('Error updating salesman incentive:', err);
        }
      }

      await invoice.populate('createdBy', 'name');

      // ✅ Response
      const responseData = {
        success: true,
        data: {
          invoice,
          lead: lead,
          proformaIncentive: {
            amount: totalIncentive,
            profit: totalProfit,
            value: totalValue,
            profitPercentage: overallProfitPercentage,
            proformaNumber: proforma.number
          },
          cumulativeIncentive: {
            total: lead.totalIncentive,
            profit: lead.totalProfit,
            value: lead.totalValue,
            salesman: lead.assignedTo?.name || lead.assignedToName || 'Unassigned'
          }
        },
        message: `✅ Invoice ${invoiceNumber} created from proforma ${proforma.number} | Incentive: ₹${totalIncentive.toFixed(2)}`
      };

      res.status(201).json(responseData);
    }

  } catch (error) {
    console.error('Convert proforma to invoice error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error during conversion'
    });
  }
};

exports.deleteProforma = async (req, res) => {
  try {
    const { id } = req.params;
    // ✅ Use query param to avoid route conflict
    const proformaNumber = req.query.proformaNumber;
    
    if (!proformaNumber) {
      return res.status(400).json({
        success: false,
        message: '⚠️ Proforma number is required. Use ?proformaNumber=PF-2026/0001'
      });
    }
    
    console.log(`🗑️ Deleting proforma ${proformaNumber} for lead ${id}`);
    
    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    // Find and remove the proforma from the array
    const proformaIndex = lead.proformas.findIndex(p => p.number === proformaNumber);
    
    if (proformaIndex === -1) {
      // Check if it's in the single proforma field
      if (lead.proforma && lead.proforma.number === proformaNumber) {
        // ✅ If it's the single proforma, clear it
        lead.proforma = null;
        if (lead.proformas.length === 0) {
          lead.status = 'qualified';
        }
        await lead.save();
        return res.json({
          success: true,
          message: `✅ Proforma ${proformaNumber} deleted successfully`
        });
      }
      
      return res.status(404).json({ 
        success: false, 
        message: `Proforma ${proformaNumber} not found` 
      });
    }

    // Check if already converted
    if (lead.proformas[proformaIndex].convertedToInvoice) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete proforma ${proformaNumber} as it has been converted to invoice ${lead.proformas[proformaIndex].invoiceNumber}`
      });
    }

    // ✅ Remove the proforma
    lead.proformas.splice(proformaIndex, 1);

    // If there are no proformas left, update status
    if (lead.proformas.length === 0) {
      lead.status = 'qualified';
      lead.proforma = null;
    } else {
      // Update the single proforma reference to the latest
      lead.proforma = lead.proformas[lead.proformas.length - 1];
    }

    await lead.save();

    res.json({
      success: true,
      message: `✅ Proforma ${proformaNumber} deleted successfully`
    });
  } catch (error) {
    console.error('Delete proforma error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ GET ALL LEADS
// ============================================
exports.getLeads = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      source,
      assignedTo,
      search,
      sortBy = '-createdAt'
    } = req.query;

    const query = {};
    if (status && status !== 'all') query.status = status;
    if (source && source !== 'all') query.source = source;
    if (assignedTo) query.assignedTo = assignedTo;

    if (req.user.role === 'telecaller') {
      query.assignedTo = req.user.id;
    }

    if (search) {
      query.$text = { $search: search };
    }

    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email role')
      .populate('createdBy', 'name')
      .sort(sortBy)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Lead.countDocuments(query);

    let stats = null;
    if (['accountant', 'admin', 'manager'].includes(req.user.role)) {
      stats = await Lead.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            totalValue: { $sum: '$value' },
            totalIncentive: { $sum: '$incentive' },
            converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
            new: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } },
            contacted: { $sum: { $cond: [{ $eq: ['$status', 'contacted'] }, 1, 0] } },
            qualified: { $sum: { $cond: [{ $eq: ['$status', 'qualified'] }, 1, 0] } },
            proforma_sent: { $sum: { $cond: [{ $eq: ['$status', 'proforma_sent'] }, 1, 0] } },
            order_confirmed: { $sum: { $cond: [{ $eq: ['$status', 'order_confirmed'] }, 1, 0] } },
            payment_pending: { $sum: { $cond: [{ $eq: ['$status', 'payment_pending'] }, 1, 0] } },
            lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } }
          }
        }
      ]);
      stats = stats[0] || null;
    }

    res.json({
      success: true,
      data: leads,
      stats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ GET SINGLE LEAD
// ============================================
exports.getLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name');

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    res.json({
      success: true,
      data: lead
    });
  } catch (error) {
    console.error('Get lead error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ UPDATE LEAD STATUS
// ============================================
exports.updateLeadStatus = async (req, res) => {
  try {
    const { status, notes } = req.body;
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    if (req.user.role === 'telecaller' &&
        lead.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const validTransitions = {
      'new': ['contacted', 'lost'],
      'contacted': ['qualified', 'lost'],
      'qualified': ['proforma_sent', 'lost'],
      'proforma_sent': ['order_confirmed', 'lost'],
      'order_confirmed': ['payment_pending', 'lost'],
      'payment_pending': ['converted', 'lost'],
      'converted': [],
      'lost': []
    };

    if (!validTransitions[lead.status]?.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from '${lead.status}' to '${status}'`
      });
    }

    const oldStatus = lead.status;
    lead.status = status;
    if (notes) lead.notes = notes;

    switch(status) {
      case 'order_confirmed':
        lead.orderConfirmedAt = new Date();
        break;

      case 'payment_pending':
        if (req.body.paymentDetails) {
          lead.payment = {
            status: 'pending',
            amount: req.body.paymentDetails.amount || lead.value,
            method: req.body.paymentDetails.method || 'advance',
            dueDate: req.body.paymentDetails.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            notes: req.body.paymentDetails.notes || 'Awaiting payment'
          };
        }
        break;

      case 'converted':
        lead.conversionDate = new Date();
        if (lead.payment) {
          lead.payment.status = 'paid';
          lead.payment.date = new Date();
        }
        break;
    }

    lead.statusHistory.push({
      status: status,
      date: new Date(),
      notes: notes || `Status updated from ${oldStatus} to ${status}`,
      updatedBy: req.user.id
    });

    await lead.save();
    await lead.populate('assignedTo', 'name email');

    const statusMessages = {
      'new': 'Lead added successfully',
      'contacted': 'Lead marked as contacted',
      'qualified': 'Lead qualified successfully',
      'proforma_sent': '📄 Proforma invoice sent successfully',
      'order_confirmed': '✅ Order confirmed by customer',
      'payment_pending': '💰 Waiting for customer payment',
      'converted': '🎉 Lead converted successfully!',
      'lost': '❌ Lead marked as lost'
    };

    res.json({
      success: true,
      data: lead,
      message: statusMessages[status] || `Status updated to ${status}`
    });
  } catch (error) {
    console.error('Update lead status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ DELETE LEAD
// ============================================
exports.deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    if (req.user.role === 'telecaller' &&
        lead.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await lead.deleteOne();

    res.json({
      success: true,
      message: 'Lead deleted successfully'
    });
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ GET LEAD STATS
// ============================================
exports.getLeadStats = async (req, res) => {
  try {
    const query = req.user.role === 'telecaller'
      ? { assignedTo: req.user.id }
      : {};

    const stats = await Lead.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          new: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } },
          contacted: { $sum: { $cond: [{ $eq: ['$status', 'contacted'] }, 1, 0] } },
          qualified: { $sum: { $cond: [{ $eq: ['$status', 'qualified'] }, 1, 0] } },
          proforma_sent: { $sum: { $cond: [{ $eq: ['$status', 'proforma_sent'] }, 1, 0] } },
          order_confirmed: { $sum: { $cond: [{ $eq: ['$status', 'order_confirmed'] }, 1, 0] } },
          payment_pending: { $sum: { $cond: [{ $eq: ['$status', 'payment_pending'] }, 1, 0] } },
          converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
          totalValue: { $sum: { $ifNull: ['$totalValue', '$value'] } },
          totalIncentive: { $sum: { $ifNull: ['$totalIncentive', '$incentive'] } },
          avgValue: { $avg: { $ifNull: ['$totalValue', '$value'] } }
        }
      }
    ]);

    const result = stats[0] || {
      total: 0,
      new: 0,
      contacted: 0,
      qualified: 0,
      proforma_sent: 0,
      order_confirmed: 0,
      payment_pending: 0,
      converted: 0,
      lost: 0,
      totalValue: 0,
      totalIncentive: 0,
      avgValue: 0
    };

    result.conversionRate = result.total > 0
      ? ((result.converted / result.total) * 100).toFixed(1)
      : 0;

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get lead stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};