// controllers/leadController.js
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Lead = require('../models/Lead');
const Revenue = require('../models/Revenue');
const User = require('../models/User');
const Invoice = require('../models/Invoice');

const isValidObjectId = (id) => id && mongoose.Types.ObjectId.isValid(id);

// ============================================
// ✅ DEDUCT STOCK ONLY ON INVOICE CONVERSION
// ============================================
const deductStockForItems = async (items = []) => {
  for (const item of items) {
    if (!item.productId || !isValidObjectId(item.productId) || !item.quantity) continue;

    try {
      const product = await Product.findById(item.productId);
      if (!product) continue;

      let qty = parseInt(item.quantity) || 0;
      if (qty <= 0) continue;

      if (product.productType === 'batch') {
        let remaining = qty;

        // 1. Pehle selected batch se stock deduct karo
        if (item.batch && item.batch !== 'NEW_BATCH') {
          const matchingBatches = (product.batches || []).filter(
            (b) => b.batchNumber === item.batch
          );
          for (const batch of matchingBatches) {
            if (remaining <= 0) break;
            const currentQty = batch.quantity || 0;
            const take = Math.min(currentQty, remaining);
            batch.quantity = Math.max(0, currentQty - take);
            remaining -= take;
          }
        }

        // 2. Agar bacha ho toh baaki batches se lo (FEFO)
        if (remaining > 0) {
          const sortedBatches = (product.batches || [])
            .filter((b) => (b.quantity || 0) > 0)
            .sort((a, b) => new Date(a.expDate || '9999-12-31') - new Date(b.expDate || '9999-12-31'));

          for (const batch of sortedBatches) {
            if (remaining <= 0) break;
            const currentQty = batch.quantity || 0;
            const take = Math.min(currentQty, remaining);
            batch.quantity = Math.max(0, currentQty - take);
            remaining -= take;
          }
        }

        product.stock = (product.batches || []).reduce((sum, b) => sum + (b.quantity || 0), 0);
      } else {
        // Non-batch product
        product.stock = Math.max(0, (product.stock || 0) - qty);
      }

      await product.save();
    } catch (err) {
      console.error(`Stock deduction error for product ${item.productId}:`, err);
    }
  }
};

// ============================================
// INCENTIVE CALCULATION HELPER
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
// ✅ CREATE LEAD
// ============================================
exports.createLead = async (req, res) => {
  try {
    const leadData = req.body;

    leadData.createdBy = req.user.id;
    leadData.assignedTo = req.user.id;
    leadData.assignedToName = req.user.name;

    if (leadData.country !== 'India') {
      leadData.type = 'international';
    } else {
      leadData.type = 'domestic';
    }

    if (leadData.items && leadData.items.length > 0) {
      for (let item of leadData.items) {
        if (item.productId && isValidObjectId(item.productId)) {
          const product = await Product.findById(item.productId);
          if (product) {
            item.productName = product.name;
            item.productSku = product.sku;
            if (!item.costPrice) {
              item.costPrice = product.pricing?.costPrice || 0;
            }
          }
        } else {
          item.productId = null;
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
      message: '✅ Lead created successfully'
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
      'drugLicense', 'state', 'stateCode', 'source', 'notes',
      'currency', 'country', 'countryCode', 'channel', 'salesPerson'
    ];

    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        lead[field] = updateData[field];
      }
    });

    if (updateData.country && updateData.country !== 'India') {
      lead.type = 'international';
    } else if (updateData.country === 'India') {
      lead.type = 'domestic';
    }

    if (updateData.proforma) {
      const incoming = updateData.proforma;
      const targetNumber = updateData.proformaNumber || incoming.number;

      if (lead.proformas && lead.proformas.length > 0 && targetNumber) {
        const pIndex = lead.proformas.findIndex(p => p.number === targetNumber);
        if (pIndex !== -1) {
          const existing = lead.proformas[pIndex].toObject
            ? lead.proformas[pIndex].toObject()
            : { ...lead.proformas[pIndex] };

          lead.proformas[pIndex] = {
            ...existing,
            ...incoming,
            number: existing.number,
            convertedToInvoice: existing.convertedToInvoice,
            invoiceNumber: existing.invoiceNumber,
            conversionDate: existing.conversionDate
          };
        }
      }

      if (lead.proforma && lead.proforma.number === targetNumber) {
        const existing = lead.proforma.toObject
          ? lead.proforma.toObject()
          : { ...lead.proforma };

        lead.proforma = {
          ...existing,
          ...incoming,
          number: existing.number,
          convertedToInvoice: existing.convertedToInvoice,
          invoiceNumber: existing.invoiceNumber,
          conversionDate: existing.conversionDate
        };
      } else if (!lead.proforma && incoming) {
        lead.proforma = incoming;
      }

      lead.markModified('proformas');
      lead.markModified('proforma');
    }

    if (updateData.items && updateData.items.length > 0) {
      lead.items = updateData.items;
      let totalValue = 0, totalProfit = 0, totalIncentive = 0;
      for (const item of lead.items) {
        totalValue += item.totalValue || 0;
        totalProfit += item.profitAmount || 0;
        totalIncentive += item.incentive || 0;
      }
      lead.totalIncentive = totalIncentive;
      lead.totalProfit = totalProfit;
      lead.totalValue = totalValue;
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

// ============================================
// ✅ GENERATE PROFORMA (CRASH-FREE & ACCURATE BATCH)
// ============================================
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
      deliveryTime = '15 Days',
      placeOfSupply = 'Gujarat (24)',
      notes = '',
      terms = 'This is a proforma invoice. Prices are valid for 7 days.',
      totalInWords = '',
      freight = 0,
      freightTaxRate = 18,
      freightQty = 1,
      insurance = 0,
      insuranceTaxRate = 18,
      insuranceQty = 1,
      channel = 'Domestic',
      salesPerson = '',
      exchangeRate = '1',
      currency = '',
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

    let proformaType = type;
    if (lead.country && lead.country !== 'India' && type === 'domestic') {
      proformaType = 'international';
    }

    // ===== Calculate Items =====
    let subtotal = 0;
    const proformaItems = [];

    for (const item of items) {
      const quantity = parseInt(item.quantity) || 1;
      const rate = parseFloat(item.rate) || 0;
      const taxRate = item.taxRate !== undefined && item.taxRate !== null && item.taxRate !== ''
        ? parseFloat(item.taxRate)
        : 18;
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

      const validProdId = (item.productId && isValidObjectId(item.productId)) ? item.productId : null;

      if (validProdId) {
        try {
          const product = await Product.findById(validProdId);
          if (product) {
            productName = product.name || productName;
            hsCode = product.hsnCode || hsCode;
            unit = product.unit || unit;
            countryOfOrigin = product.countryOfOrigin || countryOfOrigin;
            costPrice = product.pricing?.costPrice || costPrice;
            description = product.description || description;

            if (batchNumber && batchNumber !== 'NEW_BATCH') {
              const matchedBatch = (product.batches || []).find(b => b.batchNumber === batchNumber);
              if (matchedBatch) {
                mfgDate = matchedBatch.mfgDate || mfgDate;
                expiryDate = matchedBatch.expDate || expiryDate;
              }
            } else if (!batchNumber && product.batches && product.batches.length > 0) {
              const firstBatch = product.batches[0];
              batchNumber = firstBatch.batchNumber || '';
              mfgDate = firstBatch.mfgDate || mfgDate;
              expiryDate = firstBatch.expDate || expiryDate;
            }
          }
        } catch (err) {
          console.warn('Product lookup info:', validProdId);
        }
      }

      proformaItems.push({
        productId: validProdId,
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

    // ===== TAX + FREIGHT + INSURANCE =====
    let itemTax = 0;
    proformaItems.forEach(item => {
      itemTax += (item.total * (item.taxRate || 0)) / 100;
    });
    itemTax = Math.round(itemTax * 100) / 100;

    const parsedFreight = parseFloat(freight) || 0;
    const parsedFreightTaxRate = freightTaxRate !== undefined && freightTaxRate !== null && freightTaxRate !== ''
      ? parseFloat(freightTaxRate)
      : 18;
    const freightTax = Math.round((parsedFreight * parsedFreightTaxRate) / 100 * 100) / 100;

    const parsedInsurance = parseFloat(insurance) || 0;
    const parsedInsuranceTaxRate = insuranceTaxRate !== undefined && insuranceTaxRate !== null && insuranceTaxRate !== ''
      ? parseFloat(insuranceTaxRate)
      : 18;
    const insuranceTax = Math.round((parsedInsurance * parsedInsuranceTaxRate) / 100 * 100) / 100;

    const totalTax = itemTax + freightTax + insuranceTax;
    const rawTotal = subtotal + parsedFreight + parsedInsurance + totalTax;
    const grandTotal = Math.round(rawTotal);
    const rounding = Number((grandTotal - rawTotal).toFixed(2));

    // ===== Safe Proforma Number Generation =====
    const year = new Date().getFullYear();
    const prefix = proformaType === 'domestic' ? 'PF' : 'PFI';
    const regex = new RegExp(`^${prefix}-${year}/(\\d+)`);

    let maxNum = 0;
    const allExistingLeads = await Lead.find({
      $or: [
        { 'proformas.number': { $regex: `^${prefix}-${year}/` } },
        { 'proforma.number': { $regex: `^${prefix}-${year}/` } }
      ]
    }).select('proformas.number proforma.number').lean();

    allExistingLeads.forEach(l => {
      (l.proformas || []).forEach(p => {
        if (p && p.number) {
          const match = p.number.match(regex);
          if (match && match[1]) {
            const val = parseInt(match[1], 10);
            if (!isNaN(val) && val > maxNum) maxNum = val;
          }
        }
      });
      if (l.proforma && l.proforma.number) {
        const match = l.proforma.number.match(regex);
        if (match && match[1]) {
          const val = parseInt(match[1], 10);
          if (!isNaN(val) && val > maxNum) maxNum = val;
        }
      }
    });

    const nextNumber = maxNum + 1;
    const proformaNumber = `${prefix}-${year}/${String(nextNumber).padStart(4, '0')}`;

    const existingTotalIncentive = lead.totalIncentive || 0;
    const existingTotalProfit = lead.totalProfit || 0;
    const existingTotalValue = lead.totalValue || 0;
    const existingIncentive = lead.incentive || 0;
    const existingProfit = lead.profit || 0;
    const existingValue = lead.value || 0;

    const finalCurrency = currency || lead.currency || (proformaType === 'international' ? 'USD' : 'INR');

    // ===== CREATE PROFORMA OBJECT =====
    const newProforma = {
      number: proformaNumber,
      revision: 0,
      isLatest: true,
      parentProformaId: null,
      sentDate: new Date(),
      amount: grandTotal,
      type: proformaType,
      taxType,
      poNumber: poNumber || '',
      items: proformaItems,
      subtotal,
      tax: totalTax,
      total: grandTotal,
      rounding,
      currency: finalCurrency,
      exchangeRate: String(exchangeRate || '1'),

      freight: parsedFreight,
      freightTaxRate: parsedFreightTaxRate,
      freightQty: parseInt(freightQty) || 1,
      freightTax,

      insurance: parsedInsurance,
      insuranceTaxRate: parsedInsuranceTaxRate,
      insuranceQty: parseInt(insuranceQty) || 1,
      insuranceTax,

      channel: channel || 'Domestic',
      salesPerson: salesPerson || '',
      deliveryTime,
      validUntil: (validUntil && !isNaN(new Date(validUntil).getTime())) ? new Date(validUntil) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      paymentTerms,
      deliveryTerms,
      placeOfSupply,
      notes,
      terms,
      document: `Proforma ${proformaNumber}`,
      totalInWords: totalInWords || `${finalCurrency === 'INR' ? 'Indian Rupee' : 'United States Dollar'} ${Math.round(grandTotal)} Only`,
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
      conversionDate: null,
      createdBy: req.user?.id || req.user?._id || null,
      revisionNote: 'Original Proforma'
    };

    if (!lead.proformas) lead.proformas = [];
   lead.proformas.unshift(newProforma);
    
    lead.proforma = newProforma;

    lead.status = 'proforma_sent';
    lead.quotation = {
      sentDate: new Date(),
      amount: grandTotal,
      document: `Proforma ${proformaNumber}`,
      followUpDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      notes: `Proforma ${proformaNumber} sent`
    };

    lead._skipAutoCalculate = true;
    lead.totalIncentive = existingTotalIncentive;
    lead.totalProfit = existingTotalProfit;
    lead.totalValue = existingTotalValue;
    lead.incentive = existingIncentive;
    lead.profit = existingProfit;
    lead.value = existingValue;

    lead.markModified('proformas');
    lead.markModified('proforma');
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
    res.status(500).json({ success: false, message: error.message || 'Server error while generating proforma' });
  }
};

// ============================================
// ✅ CREATE PROFORMA REVISION
// ============================================
exports.createProformaRevision = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const {
      proformaNumber,
      revisionNote = '',
      items = [],
      type,
      taxType,
      poNumber,
      freight = 0,
      freightTaxRate = 18,
      freightQty = 1,
      insurance = 0,
      insuranceTaxRate = 18,
      insuranceQty = 1,
      channel,
      salesPerson,
      exchangeRate,
      currency = '',
      deliveryTime,
      placeOfSupply,
      notes,
      terms,
      totalInWords,
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
      paymentTerms,
      deliveryTerms
    } = req.body;

    if (!proformaNumber) {
      return res.status(400).json({ success: false, message: 'proformaNumber is required' });
    }

    let current = null;
    let currentIndex = -1;

    if (lead.proformas && lead.proformas.length) {
      const sameNumber = lead.proformas
        .map((p, idx) => ({ p, idx }))
        .filter(x => x.p.number === proformaNumber)
        .sort((a, b) => (b.p.revision || 0) - (a.p.revision || 0));

      if (sameNumber.length) {
        current = sameNumber[0].p;
        currentIndex = sameNumber[0].idx;
      }
    }

    if (!current && lead.proforma && lead.proforma.number === proformaNumber) {
      current = lead.proforma;
    }

    if (!current) {
      return res.status(404).json({ success: false, message: 'Proforma not found' });
    }

    if (current.convertedToInvoice) {
      return res.status(400).json({
        success: false,
        message: 'Cannot revise a proforma that is already converted to invoice'
      });
    }

    const newItems = items.length > 0 ? items : (current.items || []);

    if (currentIndex >= 0) {
      lead.proformas[currentIndex].isLatest = false;
    }
    if (lead.proforma && lead.proforma.number === proformaNumber) {
      lead.proforma.isLatest = false;
    }

    let subtotal = 0;
    const proformaItems = [];

    for (const item of newItems) {
      const quantity = parseInt(item.quantity) || 1;
      const rate = parseFloat(item.rate) || 0;
      const taxRate = item.taxRate !== undefined && item.taxRate !== null && item.taxRate !== ''
        ? parseFloat(item.taxRate) : 18;
      const total = quantity * rate;
      subtotal += total;

      const validProdId = (item.productId && isValidObjectId(item.productId)) ? item.productId : null;

      proformaItems.push({
        productId: validProdId,
        productName: item.productName || 'Product',
        description: item.description || '',
        quantity,
        unit: item.unit || 'Vial',
        rate,
        sellingPrice: rate,
        taxRate,
        total,
        totalValue: total,
        batch: item.batch || '',
        batchIndex: item.batchIndex ?? -1,
        hsCode: item.hsCode || '',
        mfgDate: item.mfgDate || '',
        expiryDate: item.expiryDate || '',
        countryOfOrigin: item.countryOfOrigin || 'India',
        costPrice: item.costPrice || 0,
        profitAmount: 0,
        profitPercentage: 0,
        incentive: 0
      });
    }

    let itemTax = 0;
    proformaItems.forEach(item => {
      itemTax += (item.total * (item.taxRate || 0)) / 100;
    });
    itemTax = Math.round(itemTax * 100) / 100;

    const parsedFreight = parseFloat(freight) || 0;
    const parsedFreightTaxRate = freightTaxRate !== undefined && freightTaxRate !== null && freightTaxRate !== ''
      ? parseFloat(freightTaxRate) : 18;
    const freightTax = Math.round((parsedFreight * parsedFreightTaxRate) / 100 * 100) / 100;

    const parsedInsurance = parseFloat(insurance) || 0;
    const parsedInsuranceTaxRate = insuranceTaxRate !== undefined && insuranceTaxRate !== null && insuranceTaxRate !== ''
      ? parseFloat(insuranceTaxRate) : 18;
    const insuranceTax = Math.round((parsedInsurance * parsedInsuranceTaxRate) / 100 * 100) / 100;

    const totalTax = itemTax + freightTax + insuranceTax;
    const rawTotal = subtotal + parsedFreight + parsedInsurance + totalTax;
    const grandTotal = Math.round(rawTotal);
    const rounding = Number((grandTotal - rawTotal).toFixed(2));

    const newRevision = (current.revision || 0) + 1;
    const finalCurrency = currency || current.currency || ((type || current.type) === 'international' ? 'USD' : 'INR');

    const revisedProforma = {
      number: proformaNumber,
      revision: newRevision,
      isLatest: true,
      parentProformaId: current._id ? String(current._id) : null,
      sentDate: new Date(),
      amount: grandTotal,
      type: type || current.type || 'domestic',
      taxType: taxType || current.taxType || 'cgst_sgst',
      poNumber: poNumber || current.poNumber || '',
      items: proformaItems,
      subtotal,
      tax: totalTax,
      total: grandTotal,
      rounding,
      freight: parsedFreight,
      freightTaxRate: parsedFreightTaxRate,
      freightQty: parseInt(freightQty) || 1,
      freightTax,
      insurance: parsedInsurance,
      insuranceTaxRate: parsedInsuranceTaxRate,
      insuranceQty: parseInt(insuranceQty) || 1,
      insuranceTax,
      channel: channel || current.channel || 'Domestic',
      salesPerson: salesPerson || current.salesPerson || '',
      exchangeRate: String(exchangeRate || current.exchangeRate || '1'),
      currency: finalCurrency,
      deliveryTime: deliveryTime || current.deliveryTime || '15 Days',
      validUntil: current.validUntil || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      paymentTerms: paymentTerms || current.paymentTerms || '100% Advance',
      deliveryTerms: deliveryTerms || current.deliveryTerms || '',
      placeOfSupply: placeOfSupply || current.placeOfSupply || '',
      notes: notes !== undefined ? notes : current.notes,
      terms: terms !== undefined ? terms : current.terms,
      document: `Proforma ${proformaNumber} (Rev ${newRevision})`,
      totalInWords: totalInWords || `${finalCurrency === 'INR' ? 'Indian Rupee' : 'United States Dollar'} ${Math.round(grandTotal)} Only`,
      portOfLoading: portOfLoading || current.portOfLoading || '',
      portOfDischarge: portOfDischarge || current.portOfDischarge || '',
      destinationCountry: destinationCountry || current.destinationCountry || '',
      grossWeight: grossWeight || current.grossWeight || '',
      netWeight: netWeight || current.netWeight || '',
      volumetricWeight: volumetricWeight || current.volumetricWeight || '',
      countryOfOriginGoods: countryOfOriginGoods || current.countryOfOriginGoods || 'India',
      totalBoxes: totalBoxes || current.totalBoxes || '',
      shippingMark: shippingMark || current.shippingMark || '',
      vesselNo: vesselNo || current.vesselNo || '',
      convertedToInvoice: false,
      invoiceNumber: '',
      incentive: 0,
      profit: 0,
      conversionDate: null,
      createdBy: req.user?.id || req.user?._id || null,
      revisionNote: revisionNote || `Revision ${newRevision}`
    };

   lead.proformas.unshift(revisedProforma);
    lead.proforma = revisedProforma;

    lead.markModified('proformas');
    lead.markModified('proforma');
    await lead.save();

    await lead.populate('assignedTo', 'name email');

    res.json({
      success: true,
      data: { lead, proforma: revisedProforma },
      message: `✅ Proforma ${proformaNumber} (Rev ${newRevision}) created successfully`
    });
  } catch (error) {
    console.error('Create proforma revision error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// ✅ CONVERT PROFORMA TO INVOICE
// ============================================
exports.convertProformaToInvoice = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).populate('assignedTo', 'name email role');
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const {
      proformaNumber,
      force = false,
      initialPayment = 0,
      paymentMethod = 'advance',
      paymentReference = '',
      paymentNotes = ''
    } = req.body;

    let proforma = null;
    let proformaIndex = -1;

    if (proformaNumber) {
      proformaIndex = lead.proformas.findIndex(p => p.number === proformaNumber && p.isLatest !== false);
      if (proformaIndex === -1) {
        proformaIndex = lead.proformas.findIndex(p => p.number === proformaNumber);
      }
      if (proformaIndex !== -1) {
        proforma = lead.proformas[proformaIndex];
      }
      if (!proforma && lead.proforma && lead.proforma.number === proformaNumber) {
        proforma = lead.proforma;
        proformaIndex = -2;
      }
    }

    if (!proforma) {
      for (let i = 0; i < (lead.proformas || []).length; i++) {
        if (!lead.proformas[i].convertedToInvoice && lead.proformas[i].isLatest !== false) {
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

    if (!proforma || !proforma.number) {
      return res.status(400).json({
        success: false,
        message: '⚠️ No proforma found for this lead.'
      });
    }

    const existingInvoice = await Invoice.findOne({ proformaNumber: proforma.number });

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

    if (existingInvoice && force) {
      if (existingInvoice.assignedTo && existingInvoice.incentive > 0) {
        try {
          const salesman = await User.findById(existingInvoice.assignedTo);
          if (salesman) {
            const historyIndex = (salesman.incentiveHistory || []).findIndex(
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
          }
        } catch (err) {
          console.error('Error reversing incentive:', err);
        }
      }

      await existingInvoice.deleteOne();

      if (proformaIndex >= 0 && proformaIndex < lead.proformas.length) {
        lead.proformas[proformaIndex].convertedToInvoice = false;
        lead.proformas[proformaIndex].invoiceNumber = '';
        lead.proformas[proformaIndex].conversionDate = null;
      } else if (proformaIndex === -2 && lead.proforma) {
        lead.proforma.convertedToInvoice = false;
        lead.proforma.invoiceNumber = '';
        lead.proforma.conversionDate = null;
      }

      await lead.save();
    }

    if (proforma.convertedToInvoice && !force) {
      return res.status(409).json({
        success: false,
        message: `⚠️ Proforma ${proforma.number} is already converted to invoice ${proforma.invoiceNumber}`,
        existingInvoice: proforma.invoiceNumber,
        proformaNumber: proforma.number
      });
    }

    // ===== Generate Invoice Number =====
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

    // ===== Incentive calculation =====
    let totalIncentive = 0;
    let totalProfit = 0;
    let totalValue = 0;
    let totalCost = 0;
    let overallProfitPercentage = 0;

    const invoiceItems = [];

    (proforma.items || []).forEach(item => {
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

      invoiceItems.push({
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
        costPrice,
        sellingPrice,
        profitAmount: profitAmountItem,
        profitPercentage: profitPercentageItem,
        incentive,
        freight: false
      });
    });

    const freightAmt = parseFloat(proforma.freight) || 0;
    const freightTaxRate = parseFloat(proforma.freightTaxRate) || 18;
    const freightQty = parseInt(proforma.freightQty) || 1;
    if (freightAmt > 0) {
      invoiceItems.push({
        description: 'Freight / Shipping Charges',
        quantity: freightQty,
        rate: freightAmt,
        taxRate: freightTaxRate,
        amount: freightAmt * freightQty,
        batch: '-',
        hsCode: '',
        mfgDate: '',
        expiryDate: '',
        unit: 'PCS',
        countryOfOrigin: 'India',
        costPrice: 0,
        sellingPrice: freightAmt,
        profitAmount: 0,
        profitPercentage: 0,
        incentive: 0,
        freight: true
      });
    }

    const insuranceAmt = parseFloat(proforma.insurance) || 0;
    const insuranceTaxRate = parseFloat(proforma.insuranceTaxRate) || 18;
    const insuranceQty = parseInt(proforma.insuranceQty) || 1;
    if (insuranceAmt > 0) {
      invoiceItems.push({
        description: 'Insurance Charges',
        quantity: insuranceQty,
        rate: insuranceAmt,
        taxRate: insuranceTaxRate,
        amount: insuranceAmt * insuranceQty,
        batch: '-',
        hsCode: '',
        mfgDate: '',
        expiryDate: '',
        unit: 'PCS',
        countryOfOrigin: 'India',
        costPrice: 0,
        sellingPrice: insuranceAmt,
        profitAmount: 0,
        profitPercentage: 0,
        incentive: 0,
        freight: false
      });
    }

    overallProfitPercentage = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    const finalSubtotal = Number(proforma.subtotal) || 0;
    const finalTax = Number(proforma.tax) || 0;
    const finalTotal = Number(proforma.total) || 0;
    const finalRounding = proforma.rounding != null ? Number(proforma.rounding) : 0;

    const finalCurrency = proforma.currency || lead.currency || (proforma.type === 'international' ? 'USD' : 'INR');

    const invoiceData = {
      invoiceNumber,
      type: proforma.type || 'domestic',
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      placeOfSupply: proforma.placeOfSupply || 'Gujarat (24)',
      paymentTerms: proforma.paymentTerms || '100% Advance',
      currency: finalCurrency,
      exchangeRate: parseFloat(proforma.exchangeRate) || 1,

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
      subtotal: finalSubtotal,
      tax: finalTax,
      total: finalTotal,
      rounding: finalRounding,
      totalInWords: proforma.totalInWords || '',
      notes: proforma.notes || 'Thanks for your business.',
      terms: proforma.terms || '"NOT COVER UNDER NARCOTICS & SCOMET LIST."',

      freight: freightAmt,
      freightTaxRate,
      freightQty,
      freightTax: (freightAmt * freightTaxRate) / 100,
      insurance: insuranceAmt,
      insuranceTaxRate,
      insuranceQty,
      insuranceTax: (insuranceAmt * insuranceTaxRate) / 100,

      salesPerson: proforma.salesPerson || lead.assignedToName || '',
      channel: proforma.channel || '',
      placeOfReceiptOfContainer: proforma.placeOfReceiptOfContainer || '',
      incoterms: proforma.incoterms || '',
      wayRoute: proforma.wayRoute || '',
      sgsNo: proforma.sgsNo || '',
      approxShipperCarton: proforma.approxShipperCarton || '',
      shipperCartonSize: proforma.shipperCartonSize || '',

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
      createdBy: req.user?.id || req.user?._id || null,
      incentive: totalIncentive,
      profit: totalProfit,
      profitPercentage: overallProfitPercentage,
      assignedTo: lead.assignedTo?._id || lead.assignedTo,
      assignedToName: lead.assignedToName || lead.assignedTo?.name || 'Unassigned',
      totalValue,
      totalCost
    };

    // ===== 🚀 DEDUCT STOCK DIRECTLY ON INVOICE CONVERSION =====
    await deductStockForItems(proforma.items || []);

    const invoice = new Invoice(invoiceData);

    // ===== INITIAL PAYMENT =====
    const initPay = parseFloat(initialPayment) || 0;
    if (initPay > 0) {
      invoice.payments = [{
        amount: initPay,
        date: new Date(),
        method: paymentMethod || 'advance',
        reference: paymentReference || '',
        notes: paymentNotes || 'Initial payment at conversion',
        receivedBy: req.user?.id || req.user?._id || null
      }];
      invoice.paidAmount = Math.round(initPay * 100) / 100;
      invoice.dueAmount = Math.max(0, Math.round((invoice.total - initPay) * 100) / 100);
      invoice.paymentStatus = initPay >= invoice.total ? 'paid' : 'partially_paid';

      if (initPay >= invoice.total) {
        invoice.status = 'paid';
        invoice.paymentDate = new Date();
      } else {
        invoice.status = 'sent';
      }
    } else {
      invoice.paidAmount = 0;
      invoice.dueAmount = invoice.total;
      invoice.paymentStatus = 'unpaid';
    }

    await invoice.save();

    lead._skipAutoCalculate = true;

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

    let totalLeadIncentive = 0;
    let totalLeadProfit = 0;
    let totalLeadValue = 0;

    (lead.proformas || []).forEach(p => {
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

    if (lead.status !== 'converted') {
      lead.status = 'converted';
      lead.conversionDate = new Date();
      lead.statusHistory = lead.statusHistory || [];
      lead.statusHistory.push({
        status: 'converted',
        date: new Date(),
        notes: `✅ Converted proforma ${proforma.number} to invoice ${invoiceNumber}`,
        updatedBy: req.user?.id || req.user?._id || null
      });
    }

    await lead.save();
    await lead.populate('assignedTo', 'name email');

    // Salesman Incentive
    if (lead.assignedTo && totalIncentive > 0) {
      try {
        const salesman = await User.findById(lead.assignedTo._id || lead.assignedTo);
        if (salesman) {
          const existingHistory = (salesman.incentiveHistory || []).find(
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
          }
        }
      } catch (err) {
        console.error('Error updating salesman incentive:', err);
      }
    }

    await invoice.populate('createdBy', 'name');

    res.status(201).json({
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
        }
      },
      message: `✅ Invoice ${invoiceNumber} created from proforma ${proforma.number} | Incentive: ₹${totalIncentive.toFixed(2)}`
    });

  } catch (error) {
    console.error('Convert proforma to invoice error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during conversion'
    });
  }
};

// ============================================
// ✅ DELETE PROFORMA (CLEAN & DIRECT DELETION)
// ============================================
exports.deleteProforma = async (req, res) => {
  try {
    const { id } = req.params;
    const proformaNumber = req.query.proformaNumber ? req.query.proformaNumber.trim() : '';
    
    if (!proformaNumber) {
      return res.status(400).json({
        success: false,
        message: '⚠️ Proforma number is required. Use ?proformaNumber=PF-2026/0001'
      });
    }
    
    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    // Check if already converted to invoice
    const isConvertedInArray = (lead.proformas || []).some(
      p => p.number === proformaNumber && p.convertedToInvoice
    );
    const isConvertedInSingle = lead.proforma && lead.proforma.number === proformaNumber && lead.proforma.convertedToInvoice;

    if (isConvertedInArray || isConvertedInSingle) {
      return res.status(400).json({
        success: false,
        message: `⚠️ Cannot delete proforma ${proformaNumber} as it has been converted to an invoice.`
      });
    }

    // Remove from proformas array
    if (lead.proformas && lead.proformas.length > 0) {
      lead.proformas = lead.proformas.filter(p => p.number !== proformaNumber);
    }

    // Clean single proforma object if matching
    if (lead.proforma && lead.proforma.number === proformaNumber) {
      lead.proforma = lead.proformas && lead.proformas.length > 0
        ? lead.proformas[lead.proformas.length - 1]
        : null;
    }

    // Status update if no proformas remain
    if (!lead.proformas || lead.proformas.length === 0) {
      if (lead.status === 'proforma_sent') {
        lead.status = 'qualified';
      }
      lead.proforma = null;
    }

    lead.markModified('proformas');
    lead.markModified('proforma');
    await lead.save();

    res.json({
      success: true,
      message: `✅ Proforma ${proformaNumber} deleted successfully`
    });
  } catch (error) {
    console.error('Delete proforma error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to delete proforma' });
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
      updatedBy: req.user?.id || req.user?._id || null
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