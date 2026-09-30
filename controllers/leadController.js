const { can } = require('../utils/accessPolicy');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Lead = require('../models/Lead');
const Revenue = require('../models/Revenue');
const User = require('../models/User');
const Invoice = require('../models/Invoice');

const isValidObjectId = (id) => id && mongoose.Types.ObjectId.isValid(id);

// ============================================
// ✅ CHECK STOCK (Live - Reserved) — HARD BLOCK
// ============================================
const checkStockAvailability = async (items = []) => {
  const shortages = [];

  for (const item of items) {
    if (!item.productId || !isValidObjectId(item.productId)) continue;

    const qty = parseInt(item.quantity) || 0;
    if (qty <= 0) continue;

    const product = await Product.findById(item.productId);
    if (!product) {
      shortages.push({
        productName: item.productName || 'Unknown',
        batch: item.batch || '-',
        required: qty,
        available: 0,
        live: 0,
        reserved: 0,
        message: 'Product not found in inventory'
      });
      continue;
    }

    if (product.productType === 'batch') {
      let available = 0;
      let live = 0;
      let reserved = 0;

      if (item.batch && item.batch !== 'NEW_BATCH') {
        const matching = (product.batches || []).filter(
          (b) => b.batchNumber === item.batch
        );
        matching.forEach((b) => {
          const q = Number(b.quantity) || 0;
          const r = Number(b.reservedQuantity) || 0;
          live += q;
          reserved += r;
          available += Math.max(0, q - r);
        });
      } else {
        (product.batches || []).forEach((b) => {
          const q = Number(b.quantity) || 0;
          const r = Number(b.reservedQuantity) || 0;
          live += q;
          reserved += r;
          available += Math.max(0, q - r);
        });
      }

      if (available < qty) {
        shortages.push({
          productName: product.name || item.productName,
          batch: item.batch || 'Any',
          required: qty,
          available,
          live,
          reserved,
          message: `Only ${available} available (Live: ${live}, Reserved: ${reserved})`
        });
      }
    } else {
      const live = Number(product.stock) || 0;
      const reserved = Number(product.reservedStock) || 0;
      const available = Math.max(0, live - reserved);

      if (available < qty) {
        shortages.push({
          productName: product.name || item.productName,
          batch: '-',
          required: qty,
          available,
          live,
          reserved,
          message: `Only ${available} available (Live: ${live}, Reserved: ${reserved})`
        });
      }
    }
  }

  return {
    ok: shortages.length === 0,
    shortages
  };
};

// ============================================
// ✅ DEDUCT STOCK (Available = Live - Reserved)
// ============================================
const deductStockForItems = async (items = []) => {
  for (const item of items) {
    if (!item.productId || !isValidObjectId(item.productId) || !item.quantity) continue;

    const product = await Product.findById(item.productId);
    if (!product) continue;

    let qty = parseInt(item.quantity) || 0;
    if (qty <= 0) continue;

    if (product.productType === 'batch') {
      let remaining = qty;

      if (item.batch && item.batch !== 'NEW_BATCH') {
        const matchingBatches = (product.batches || []).filter(
          (b) => b.batchNumber === item.batch
        );
        for (const batch of matchingBatches) {
          if (remaining <= 0) break;
          const available = Math.max(
            0,
            (batch.quantity || 0) - (batch.reservedQuantity || 0)
          );
          const take = Math.min(available, remaining);
          batch.quantity = Math.max(0, (batch.quantity || 0) - take);
          remaining -= take;
        }
      }

      if (remaining > 0) {
        const sortedBatches = (product.batches || [])
          .filter(
            (b) =>
              Math.max(0, (b.quantity || 0) - (b.reservedQuantity || 0)) > 0
          )
          .sort(
            (a, b) =>
              new Date(a.expDate || '9999-12-31') -
              new Date(b.expDate || '9999-12-31')
          );

        for (const batch of sortedBatches) {
          if (remaining <= 0) break;
          const available = Math.max(
            0,
            (batch.quantity || 0) - (batch.reservedQuantity || 0)
          );
          const take = Math.min(available, remaining);
          batch.quantity = Math.max(0, (batch.quantity || 0) - take);
          remaining -= take;
        }
      }

      if (remaining > 0) {
        throw new Error(
          `Insufficient stock for ${product.name}. Still need ${remaining} more units.`
        );
      }

      product.stock = (product.batches || []).reduce(
        (sum, b) => sum + (b.quantity || 0),
        0
      );
      product.reservedStock = (product.batches || []).reduce(
        (sum, b) => sum + (b.reservedQuantity || 0),
        0
      );
    } else {
      const available = Math.max(
        0,
        (product.stock || 0) - (product.reservedStock || 0)
      );
      if (available < qty) {
        throw new Error(
          `Insufficient stock for ${product.name}. Available: ${available}, Required: ${qty}`
        );
      }
      product.stock = Math.max(0, (product.stock || 0) - qty);
    }

    await product.save();
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

const calculateItemTotals = (item, exchangeRate = 1) => {
  const qty = item.quantity || 1;
  const sellingPriceForeign = item.sellingPrice || item.rate || 0;
  const costPriceInINR = item.costPrice || 0;
  const exRate = parseFloat(exchangeRate) || 1;

  const sellingPriceInINR = sellingPriceForeign * exRate;
  const totalValueInINR = sellingPriceInINR * qty;
  const totalCostInINR = costPriceInINR * qty;
  const profitAmountInINR = totalValueInINR - totalCostInINR;
  const profitPercentage = totalCostInINR > 0 ? (profitAmountInINR / totalCostInINR) * 100 : 0;
  const incentiveInINR = calculateIncentive(totalValueInINR, profitPercentage);

  return {
    ...item,
    totalValue: sellingPriceForeign * qty,
    profitAmount: profitAmountInINR,
    profitPercentage,
    incentive: incentiveInINR
  };
};

// ============================================
// CREATE LEAD
// ============================================
exports.createLead = async (req, res) => {
  try {
    const leadData = req.body;

    leadData.createdBy = req.user.id;
    leadData.assignedTo = req.user.id;
    leadData.assignedToName = req.user.name;

    if (leadData.country && leadData.country !== 'India') {
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

            if (item.batch && item.batch !== 'NEW_BATCH') {
              const matchedBatch = (product.batches || []).find(b => b.batchNumber === item.batch);
              if (matchedBatch && matchedBatch.costPrice !== undefined) {
                item.costPrice = matchedBatch.costPrice;
              } else if (!item.costPrice) {
                item.costPrice = product.pricing?.costPrice || 0;
              }
            } else if (!item.costPrice) {
              item.costPrice = product.pricing?.costPrice || 0;
            }
          }
        } else {
          item.productId = null;
        }
        const calculatedItem = calculateItemTotals(item, 1);
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
// UPDATE LEAD
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
      'currency', 'country', 'countryCode', 'channel', 'salesPerson', 'companyName',
      'contactPerson', 'alternativePhone', 'website', 'city', 'postalCode', 'ntfnNumber',
      'businessType', 'bankName', 'accountTitle', 'accountNumber', 'branchCode', 'paymentTerms'
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
// GENERATE PROFORMA
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
      placeOfSupply = '',
      notes = '',
      terms = 'This is a proforma invoice. Prices are valid for 7 days.',
      totalInWords = '',
      freight = 0,
      freightTaxRate = 0,
      freightQty = 1,
      insurance = 0,
      insuranceTaxRate = 0,
      insuranceQty = 1,
      channel = '',
      salesPerson = '',
      exchangeRate = '1',
      currency = '',
      portOfLoading = 'IGI Delhi Air Port',
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

    const finalCurrency = currency || lead.currency || (proformaType === 'international' ? 'USD' : 'INR');
    const effectiveExchangeRate = parseFloat(exchangeRate) || 1;

    let subtotal = 0;
    const proformaItems = [];

    for (const item of items) {
      const quantity = parseInt(item.quantity) || 1;
      const rate = parseFloat(item.rate) || 0;
      const taxRate = item.taxRate !== undefined && item.taxRate !== null && item.taxRate !== ''
        ? parseFloat(item.taxRate)
        : (proformaType === 'international' ? 0 : 5);
      const total = quantity * rate;
      subtotal += total;

      let productName = item.productName || 'Product';
      let hsCode = item.hsCode || '30049011';
      let unit = item.unit || 'Bottle';
      let batchNumber = ''; // Batch allocation happens at invoice conversion.
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
            description = product.description || description;

            if (batchNumber && batchNumber !== 'NEW_BATCH') {
              const matchedBatch = (product.batches || []).find(b => b.batchNumber === batchNumber);
              if (matchedBatch) {
                mfgDate = matchedBatch.mfgDate || mfgDate;
                expiryDate = matchedBatch.expDate || expiryDate;
                if (matchedBatch.costPrice !== undefined && matchedBatch.costPrice !== null) {
                  costPrice = matchedBatch.costPrice;
                } else {
                  costPrice = product.pricing?.costPrice || costPrice;
                }
              }
            } else if (!costPrice) {
              costPrice = product.pricing?.costPrice || 0;
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

    let itemTax = 0;
    proformaItems.forEach(item => {
      itemTax += (item.total * (item.taxRate || 0)) / 100;
    });
    itemTax = Math.round(itemTax * 100) / 100;

    const parsedFreight = parseFloat(freight) || 0;
    const parsedFreightTaxRate = freightTaxRate !== undefined && freightTaxRate !== null && freightTaxRate !== ''
      ? parseFloat(freightTaxRate)
      : 0;
    const freightTax = Math.round((parsedFreight * parsedFreightTaxRate) / 100 * 100) / 100;

    const parsedInsurance = parseFloat(insurance) || 0;
    const parsedInsuranceTaxRate = insuranceTaxRate !== undefined && insuranceTaxRate !== null && insuranceTaxRate !== ''
      ? parseFloat(insuranceTaxRate)
      : 0;
    const insuranceTax = Math.round((parsedInsurance * parsedInsuranceTaxRate) / 100 * 100) / 100;

    const totalTax = itemTax + freightTax + insuranceTax;
    const rawTotal = subtotal + parsedFreight + parsedInsurance + totalTax;

    let grandTotal, rounding;
    if (finalCurrency === 'INR' || proformaType === 'domestic') {
      grandTotal = Math.round(rawTotal);
      rounding = Number((grandTotal - rawTotal).toFixed(2));
    } else {
      grandTotal = Math.round(rawTotal * 100) / 100;
      rounding = 0;
    }

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
      exchangeRate: String(effectiveExchangeRate),

      freight: parsedFreight,
      freightTaxRate: parsedFreightTaxRate,
      freightQty: parseInt(freightQty) || 1,
      freightTax,

      insurance: parsedInsurance,
      insuranceTaxRate: parsedInsuranceTaxRate,
      insuranceQty: parseInt(insuranceQty) || 1,
      insuranceTax,

      channel: channel || (proformaType === 'international' ? 'International' : 'Domestic'),
      salesPerson: salesPerson || (req.user?.name || ''),
      deliveryTime,
      validUntil: (validUntil && !isNaN(new Date(validUntil).getTime())) ? new Date(validUntil) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      paymentTerms,
      deliveryTerms,
      placeOfSupply: placeOfSupply || (lead.country !== 'India' ? (lead.country || 'Export') : 'Gujarat (24)'),
      notes,
      terms,
      document: `Proforma ${proformaNumber}`,
      totalInWords: totalInWords || `${finalCurrency} ${Math.round(grandTotal)} Only`,
      portOfLoading,
      portOfDischarge,
      destinationCountry: destinationCountry || lead.country || '',
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
        country: lead.country || 'India',
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
// CONVERT PROFORMA TO INVOICE (NORMALIZED INCENTIVE)
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
      paymentNotes = '',
      items: customItems = []
    } = req.body;

    let proforma = null;
    let proformaIndex = -1;

    if (proformaNumber) {
      proformaIndex = lead.proformas.findIndex(p => p.number === proformaNumber && p.isLatest !== false);
      if (proformaIndex === -1) {
        proformaIndex = lead.proformas.findIndex(p => p.number === proformaNumber);
      }
      if (proformaIndex !== -1) proforma = lead.proformas[proformaIndex];
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

    if (proforma.convertedToInvoice) {
      return res.status(409).json({
        success: false,
        message: `⚠️ Proforma ${proforma.number} is already converted to invoice ${proforma.invoiceNumber}`
      });
    }

    const sourceItems = (customItems && customItems.length > 0) ? customItems : (proforma.items || []);
    if (sourceItems.some(item => item.rate == null || String(item.rate).trim() === '' || !Number.isFinite(Number(item.rate)) || Number(item.rate) < 0)) {
      return res.status(400).json({ success: false, message: 'Enter a valid non-negative rate for every invoice line.' });
    }
    const invoiceTaxType = req.body.taxType ?? proforma.taxType ?? 'cgst_sgst';
    const { supplyState } = require('../utils/supplyState');
    const destinationState = supplyState(req.body.placeOfSupply || proforma.placeOfSupply);
    const supplierState = process.env.COMPANY_STATE_CODE || '07';
    if ((proforma.type || 'domestic') === 'domestic' && destinationState && invoiceTaxType !== (destinationState === supplierState ? 'cgst_sgst' : 'igst')) {
      return res.status(400).json({ success: false, message: `GST structure does not match Place of Supply. Select ${destinationState === supplierState ? 'CGST + SGST' : 'IGST'} for this invoice.` });
    }
    if (!['cgst_sgst', 'igst'].includes(invoiceTaxType)) {
      return res.status(400).json({ success: false, message: 'Select CGST + SGST or IGST.' });
    }
    if (sourceItems.some(item => !Number.isFinite(Number(item.taxRate ?? 0)) || Number(item.taxRate ?? 0) < 0 || Number(item.taxRate ?? 0) > 100)) {
      return res.status(400).json({ success: false, message: 'Enter a valid GST rate between 0 and 100.' });
    }

    try {
      await require('../utils/allocateSalesBatches')(sourceItems, proforma.items || [], Product);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

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

    let totalIncentive = 0;
    let totalProfit = 0;
    let totalValue = 0;
    let totalCost = 0;
    let subtotal = 0;
    let tax = 0;

    const exchangeRateVal = parseFloat(proforma.exchangeRate) || 1;
    const invoiceItems = [];

    for (const item of sourceItems) {
      const qty = parseInt(item.quantity) || 1;
      const rate = parseFloat(item.rate) || 0;
      const taxRate = parseFloat(item.taxRate) || 0;
      const amount = qty * rate;

      let costPriceInINR = parseFloat(item.costPrice) || 0;
      if (costPriceInINR <= 0) {
        const originalPfItem = (proforma.items || []).find(pi => 
          (pi.productId && String(pi.productId) === String(item.productId)) ||
          pi.productName === (item.description || item.productName)
        );
        if (originalPfItem && originalPfItem.costPrice > 0) {
          costPriceInINR = parseFloat(originalPfItem.costPrice);
        } else if (item.productId) {
          const prod = await Product.findById(item.productId);
          if (prod) costPriceInINR = parseFloat(prod.pricing?.costPrice) || 0;
        }
      }

      subtotal += amount;
      tax += (amount * taxRate) / 100;

      const rateInINR = rate * exchangeRateVal;
      const totalValueItemInINR = rateInINR * qty;
      const totalCostItemInINR = costPriceInINR * qty;
      const profitAmountItemInINR = totalValueItemInINR - totalCostItemInINR;
      const profitPercentageItem = totalCostItemInINR > 0 ? (profitAmountItemInINR / totalCostItemInINR) * 100 : 0;
      const incentive = calculateIncentive(totalValueItemInINR, profitPercentageItem);

      if (!item.freight) {
        totalIncentive += incentive;
        totalProfit += profitAmountItemInINR;
        totalValue += totalValueItemInINR;
        totalCost += totalCostItemInINR;
      }

      invoiceItems.push({
        productId: item.productId,
        stockBatchId: item.stockBatchId,
        description: item.description || item.productName || 'Product',
        quantity: qty,
        rate,
        taxRate,
        amount,
        batch: item.batch || '',
        hsCode: item.hsCode || '',
        mfgDate: item.mfgDate || '',
        expiryDate: item.expiryDate || '',
        unit: item.unit || 'Bottle',
        countryOfOrigin: item.countryOfOrigin || 'India',
        costPrice: costPriceInINR,
        sellingPrice: rate,
        profitAmount: profitAmountItemInINR,
        profitPercentage: profitPercentageItem,
        incentive,
        freight: !!item.freight
      });
    }

    const rawInvoiceTotal = subtotal + tax;
    const finalCurrency = proforma.currency || lead.currency || (proforma.type === 'international' ? 'USD' : 'INR');

    let grandTotal, rounding;
    if (finalCurrency === 'INR' || proforma.type === 'domestic') {
      grandTotal = Math.round(rawInvoiceTotal);
      rounding = Number((grandTotal - rawInvoiceTotal).toFixed(2));
    } else {
      grandTotal = Math.round(rawInvoiceTotal * 100) / 100;
      rounding = 0;
    }

    const overallProfitPercentage = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    const invoiceData = {
      invoiceNumber,
      taxType: invoiceTaxType,
      type: proforma.type || 'domestic',
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      placeOfSupply: req.body.placeOfSupply || proforma.placeOfSupply || '',
      paymentTerms: proforma.paymentTerms || '100% Advance',
      currency: finalCurrency,
      exchangeRate: exchangeRateVal,
      customer: {
        name: lead.name,
        phone: lead.phone,
        email: lead.email || '',
        address: lead.address || 'N/A',
        country: lead.country || 'India',
        gst: lead.gst || '',
        drugLicense: lead.drugLicense || '',
        state: lead.state || '',
        stateCode: lead.stateCode || ''
      },
      items: invoiceItems,
      subtotal: Math.round(subtotal * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      total: grandTotal,
      rounding,
      totalInWords: '',
      notes: proforma.notes || 'Thanks for your business.',
      terms: proforma.terms || '"NOT COVER UNDER NARCOTICS & SCOMET LIST."',
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

    const invoice = new Invoice(invoiceData);

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
      invoice.status = initPay >= invoice.total ? 'paid' : 'sent';
      if (initPay >= invoice.total) invoice.paymentDate = new Date();
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

    if (totalLeadIncentive === 0) totalLeadIncentive = totalIncentive;
    if (totalLeadProfit === 0) totalLeadProfit = totalProfit;
    if (totalLeadValue === 0) totalLeadValue = totalValue;

    lead.totalIncentive = totalLeadIncentive;
    lead.totalProfit = totalLeadProfit;
    lead.totalValue = totalLeadValue;
    lead.incentive = totalLeadIncentive;
    lead.profit = totalLeadProfit;
    lead.value = totalLeadValue;

    lead.status = 'converted';
    lead.conversionDate = new Date();
    lead.markModified('proformas');
    lead.markModified('proforma');
    await lead.save();

    if (lead.assignedTo && totalIncentive > 0) {
      try {
        const salesman = await User.findById(lead.assignedTo._id || lead.assignedTo);
        if (salesman) {
          salesman.totalIncentiveEarned = (salesman.totalIncentiveEarned || 0) + totalIncentive;
          salesman.totalSalesValue = (salesman.totalSalesValue || 0) + totalValue;
          salesman.totalConversions = (salesman.totalConversions || 0) + 1;
          salesman.totalProfitGenerated = (salesman.totalProfitGenerated || 0) + totalProfit;
          await salesman.save();
        }
      } catch (salesErr) {
        console.error('Error updating salesman incentive:', salesErr);
      }
    }

    res.status(201).json({
      success: true,
      data: { invoice, lead, incentive: totalIncentive },
      message: `✅ Invoice ${invoiceNumber} created successfully! Incentive: ₹${totalIncentive.toFixed(2)}`
    });
  } catch (error) {
    console.error('Convert proforma error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// DELETE PROFORMA
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

    if (lead.proformas && lead.proformas.length > 0) {
      lead.proformas = lead.proformas.filter(p => p.number !== proformaNumber);
    }

    if (lead.proforma && lead.proforma.number === proformaNumber) {
      lead.proforma = lead.proformas && lead.proformas.length > 0
        ? lead.proformas[lead.proformas.length - 1]
        : null;
    }

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
// CREATE PROFORMA REVISION
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
      freightTaxRate = 0,
      freightQty = 1,
      insurance = 0,
      insuranceTaxRate = 0,
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
    const isInternational = (type || current.type) === 'international';

    for (const item of newItems) {
      const quantity = parseInt(item.quantity) || 1;
      const rate = parseFloat(item.rate) || 0;
      const taxRate = item.taxRate !== undefined && item.taxRate !== null && item.taxRate !== ''
        ? parseFloat(item.taxRate) : (isInternational ? 0 : 5);
      const total = quantity * rate;
      subtotal += total;

      const validProdId = (item.productId && isValidObjectId(item.productId)) ? item.productId : null;

      let costPrice = item.costPrice || 0;
      if (validProdId && (!costPrice || costPrice === 0)) {
        try {
          const product = await Product.findById(validProdId);
          if (product) {
            if (item.batch && item.batch !== 'NEW_BATCH') {
              const matchedBatch = (product.batches || []).find(b => b.batchNumber === item.batch);
              if (matchedBatch && matchedBatch.costPrice !== undefined) {
                costPrice = matchedBatch.costPrice;
              } else {
                costPrice = product.pricing?.costPrice || 0;
              }
            } else {
              costPrice = product.pricing?.costPrice || 0;
            }
          }
        } catch (e) {
          console.warn('Revision cost lookup err', e);
        }
      }

      proformaItems.push({
        productId: validProdId,
        productName: item.productName || 'Product',
        description: item.description || '',
        quantity,
        unit: item.unit || 'Bottle',
        rate,
        sellingPrice: rate,
        taxRate,
        total,
        totalValue: total,
        batch: '',
        batchIndex: -1,
        hsCode: item.hsCode || '30049011',
        mfgDate: item.mfgDate || '',
        expiryDate: item.expiryDate || '',
        countryOfOrigin: item.countryOfOrigin || 'India',
        costPrice: costPrice,
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
      ? parseFloat(freightTaxRate) : 0;
    const freightTax = Math.round((parsedFreight * parsedFreightTaxRate) / 100 * 100) / 100;

    const parsedInsurance = parseFloat(insurance) || 0;
    const parsedInsuranceTaxRate = insuranceTaxRate !== undefined && insuranceTaxRate !== null && insuranceTaxRate !== ''
      ? parseFloat(insuranceTaxRate) : 0;
    const insuranceTax = Math.round((parsedInsurance * parsedInsuranceTaxRate) / 100 * 100) / 100;

    const totalTax = itemTax + freightTax + insuranceTax;
    const rawTotal = subtotal + parsedFreight + parsedInsurance + totalTax;

    let grandTotal, rounding;
    const finalCurrency = currency || current.currency || (isInternational ? 'USD' : 'INR');

    if (finalCurrency === 'INR' || !isInternational) {
      grandTotal = Math.round(rawTotal);
      rounding = Number((grandTotal - rawTotal).toFixed(2));
    } else {
      grandTotal = Math.round(rawTotal * 100) / 100;
      rounding = 0;
    }

    const newRevision = (current.revision || 0) + 1;

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
      channel: channel || current.channel || (isInternational ? 'International' : 'Domestic'),
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
      totalInWords: totalInWords || `${finalCurrency} ${Math.round(grandTotal)} Only`,
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
// GET LEADS (WITH ROLE-BASED FILTERING)
// ============================================
exports.getLeads = async (req, res) => {
  try {
    const { page = 1, limit = 100, status, source, assignedTo, search, sortBy = '-createdAt' } = req.query;
    const query = {};

    // ✅ ROLE FILTER: Non-admin / non-manager users (e.g. telecallers) only see their own assigned/created leads
    if (req.user && !can(req.user, 'sales', 'all_records')) {
      const userId = req.user.id || req.user._id;
      query.$or = [
        { assignedTo: userId },
        { createdBy: userId }
      ];
    } else if (assignedTo) {
      query.assignedTo = assignedTo;
    }

    if (status && status !== 'all') query.status = status;
    if (source && source !== 'all') query.source = source;

    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      const searchCond = [
        { name: searchRegex },
        { phone: searchRegex },
        { companyName: searchRegex }
      ];

      if (query.$or) {
        query.$and = [
          { $or: query.$or },
          { $or: searchCond }
        ];
        delete query.$or;
      } else {
        query.$or = searchCond;
      }
    }

    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email role')
      .populate('createdBy', 'name')
      .sort(sortBy)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Lead.countDocuments(query);

    res.json({
      success: true,
      data: leads,
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

exports.getLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name');

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    res.json({ success: true, data: lead });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateLeadStatus = async (req, res) => {
  try {
    const { status, notes } = req.body;
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    lead.status = status;
    if (notes) lead.notes = notes;

    lead.statusHistory.push({
      status: status,
      date: new Date(),
      notes: notes || `Status updated to ${status}`,
      updatedBy: req.user?.id || req.user?._id || null
    });

    await lead.save();
    res.json({ success: true, data: lead });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    await lead.deleteOne();
    res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================
// GET LEAD STATS (ROLE-BASED FILTERING)
// ============================================
exports.getLeadStats = async (req, res) => {
  try {
    const matchQuery = {};
    if (req.user && !can(req.user, 'sales', 'all_records')) {
      const uId = new mongoose.Types.ObjectId(req.user.id || req.user._id);
      matchQuery.$or = [
        { assignedTo: uId },
        { createdBy: uId }
      ];
    }

    const pipeline = [];
    if (Object.keys(matchQuery).length > 0) {
      pipeline.push({ $match: matchQuery });
    }

    pipeline.push({
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
        totalIncentive: { $sum: { $ifNull: ['$totalIncentive', '$incentive'] } }
      }
    });

    const stats = await Lead.aggregate(pipeline);

    const result = stats[0] || {
      total: 0, new: 0, contacted: 0, qualified: 0, proforma_sent: 0,
      order_confirmed: 0, payment_pending: 0, converted: 0, lost: 0,
      totalValue: 0, totalIncentive: 0
    };

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
