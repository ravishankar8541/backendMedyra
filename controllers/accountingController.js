
// controllers/accountingController.js
const mongoose = require('mongoose');
const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const Invoice = require('../models/Invoice');
const { ConsolidatedInvoice } = require('../models/GoodsReceipt');
const Product = require('../models/Product');

// Standard Chart of Accounts Template (Zoho Books Standard)
const DEFAULT_ACCOUNTS = [
  // Assets (1000s)
  { code: '1000', name: 'Cash in Hand', type: 'asset', subType: 'cash', isSystem: true },
  { code: '1010', name: 'Kotak Bank Main A/c (7548895846)', type: 'asset', subType: 'bank', isSystem: true },
  { code: '1020', name: 'Accounts Receivable (Debtors)', type: 'asset', subType: 'accounts_receivable', isSystem: true },
  { code: '1030', name: 'Pharma Inventory Asset', type: 'asset', subType: 'inventory', isSystem: true },
  { code: '1040', name: 'Input GST Credit (CGST)', type: 'asset', subType: 'current_asset', isSystem: true },
  { code: '1041', name: 'Input GST Credit (SGST)', type: 'asset', subType: 'current_asset', isSystem: true },
  { code: '1042', name: 'Input GST Credit (IGST)', type: 'asset', subType: 'current_asset', isSystem: true },
  { code: '1500', name: 'Warehouse & Office Equipment', type: 'asset', subType: 'fixed_asset', isSystem: false },

  // Liabilities (2000s)
  { code: '2000', name: 'Accounts Payable (Creditors / Suppliers)', type: 'liability', subType: 'accounts_payable', isSystem: true },
  { code: '2010', name: 'Output CGST Payable', type: 'liability', subType: 'tax_payable', isSystem: true },
  { code: '2011', name: 'Output SGST Payable', type: 'liability', subType: 'tax_payable', isSystem: true },
  { code: '2012', name: 'Output IGST Payable', type: 'liability', subType: 'tax_payable', isSystem: true },
  { code: '2020', name: 'Advance Received from Clients', type: 'liability', subType: 'current_liability', isSystem: true },

  // Equity (3000s)
  { code: '3000', name: "Owner's Capital / Share Capital", type: 'equity', subType: 'equity', isSystem: true },
  { code: '3010', name: 'Retained Earnings', type: 'equity', subType: 'retained_earnings', isSystem: true },

  // Revenue (4000s)
  { code: '4000', name: 'Sales Revenue - Domestic', type: 'revenue', subType: 'operating_revenue', isSystem: true },
  { code: '4010', name: 'Sales Revenue - Export', type: 'revenue', subType: 'operating_revenue', isSystem: true },
  { code: '4020', name: 'Freight & Logistics Recovery', type: 'revenue', subType: 'other_income', isSystem: false },
  { code: '4030', name: 'Insurance Recovery Income', type: 'revenue', subType: 'other_income', isSystem: false },

  // Expenses (5000s)
  { code: '5000', name: 'Cost of Goods Sold (COGS)', type: 'expense', subType: 'cost_of_goods_sold', isSystem: true },
  { code: '5010', name: 'Procurement Purchases', type: 'expense', subType: 'cost_of_goods_sold', isSystem: true },
  { code: '5020', name: 'Outward Freight & Shipping', type: 'expense', subType: 'operating_expense', isSystem: false },
  { code: '5030', name: 'Transit Insurance Expense', type: 'expense', subType: 'operating_expense', isSystem: false },
  { code: '5040', name: 'Sales Telecaller Incentive Expense', type: 'expense', subType: 'operating_expense', isSystem: false },
  { code: '5050', name: 'Warehousing & Handling Expense', type: 'expense', subType: 'operating_expense', isSystem: false },
  { code: '5060', name: 'Bank Charges & Gateway Fees', type: 'expense', subType: 'financial_expense', isSystem: false },
  { code: '5070', name: 'Office Utilities & Administration', type: 'expense', subType: 'operating_expense', isSystem: false },
  { code: '5080', name: 'Round-off Expense / (Gain)', type: 'expense', subType: 'operating_expense', isSystem: false }
];

// Helper: Safely parse Date without throwing Mongoose CastError on DD/MM/YYYY or strings
const parseSafeDate = (d) => {
  if (!d) return new Date();
  if (d instanceof Date && !isNaN(d.getTime())) return d;
  if (typeof d === 'string') {
    const trimmed = d.trim();
    const parts = trimmed.split(/[-/]/);
    if (parts.length === 3 && parts[0].length <= 2 && parts[2].length === 4) {
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[2];
      const parsed = new Date(`${year}-${month}-${day}`);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    const standardParsed = new Date(trimmed);
    if (!isNaN(standardParsed.getTime())) return standardParsed;
  }
  return new Date();
};

const getAccountMap = async () => {
  const existing = await Account.find({ isActive: true });
  const map = new Map(existing.map(a => [a.code, a]));

  for (const template of DEFAULT_ACCOUNTS) {
    if (!map.has(template.code)) {
      const created = await Account.create(template);
      map.set(template.code, created);
    }
  }
  return map;
};

const getLiveInventoryValuation = async () => {
  try {
    const products = await Product.find();
    let totalStockValue = 0;
    products.forEach((p) => {
      const isBatch = p.productType !== 'non-batch';
      if (isBatch && Array.isArray(p.batches) && p.batches.length > 0) {
        p.batches.forEach((b) => {
          const qty = Number(b.quantity) || 0;
          const cost = Number(b.costPrice ?? p.pricing?.costPrice ?? 0);
          totalStockValue += (qty * cost);
        });
      } else {
        const qty = Number(p.stock) || 0;
        const cost = Number(p.pricing?.costPrice) || 0;
        totalStockValue += (qty * cost);
      }
    });
    return Math.round(totalStockValue * 100) / 100;
  } catch (err) {
    console.error('Error computing inventory valuation:', err);
    return 0;
  }
};

// =========================================================================
// AUTOMATED JOURNAL ENTRY SYNCHRONIZER
// =========================================================================
const syncAllAutomatedJournals = async () => {
  try {
    // ⭐ CRITICAL FIX: Automatically drop the obsolete voucherNo_1 duplicate key index
    try {
      const collection = mongoose.connection.collection('journalentries');
      const existingIndexes = await collection.indexes();
      const hasBadIndex = existingIndexes.some(idx => idx.name === 'voucherNo_1');
      if (hasBadIndex) {
        await collection.dropIndex('voucherNo_1');
        console.log('✅ Successfully dropped obsolete voucherNo_1 index to fix duplicate key error.');
      }
    } catch (idxError) {
      // Ignore if index doesn't exist
    }

    const accMap = await getAccountMap();

    const getAcc = (code, fallback = '1000') => {
      return accMap.get(code) || accMap.get(fallback) || Array.from(accMap.values())[0];
    };

    const [salesInvoices, purchaseInvoices] = await Promise.all([
      Invoice.find({ status: { $ne: 'cancelled' } }).sort({ createdAt: 1 }),
      ConsolidatedInvoice.find().sort({ createdAt: 1 })
    ]);

    // -------------------------------------------------------------
    // 0. PURGE ORPHANED AUTO-JOURNALS
    // -------------------------------------------------------------
    const salesInvIds = new Set(salesInvoices.map(i => String(i._id)));
    const salesInvNums = new Set(salesInvoices.map(i => i.invoiceNumber));
    const purchaseInvIds = new Set(purchaseInvoices.map(p => String(p._id)));
    const purchaseInvNums = new Set(purchaseInvoices.map(p => p.invoiceNumber));

    const allAutoJvs = await JournalEntry.find({
      sourceModule: {
        $in: ['sales_invoice', 'purchase_invoice', 'payment_receipt', 'payment_disbursement', 'inventory_adjustment']
      }
    });

    for (const jv of allAutoJvs) {
      const srcId = String(jv.sourceId || '');
      const refNum = jv.referenceNumber || '';

      if (['sales_invoice', 'inventory_adjustment', 'payment_receipt'].includes(jv.sourceModule)) {
        if (!salesInvIds.has(srcId) && !salesInvNums.has(refNum)) {
          await JournalEntry.findByIdAndDelete(jv._id);
        }
      } else if (['purchase_invoice', 'payment_disbursement'].includes(jv.sourceModule)) {
        if (!purchaseInvIds.has(srcId) && !purchaseInvNums.has(refNum)) {
          await JournalEntry.findByIdAndDelete(jv._id);
        }
      }
    }

    // -------------------------------------------------------------
    // 1. AUTO-POST SALES INVOICES AND PAYMENTS
    // -------------------------------------------------------------
    for (const inv of salesInvoices) {
      const invId = inv._id;
      const invDate = parseSafeDate(inv.date || inv.createdAt);
      const isDomestic = inv.type === 'domestic' || !inv.type || inv.currency === 'INR';
      const invNum = inv.invoiceNumber;
      const cleanInvNum = invNum.replace(/[^a-zA-Z0-9]/g, '');
      const totalAmount = Number(inv.total) || 0;
      const subtotal = Number(inv.subtotal) || 0;
      const tax = Number(inv.tax) || 0;
      const freight = Number(inv.freight) || 0;
      const insurance = Number(inv.insurance) || 0;
      const cogs = Number(inv.totalCost) || 0;

      if (totalAmount > 0) {
        const lines = [];

        lines.push({
          account: getAcc('1020')._id,
          accountCode: '1020',
          accountName: getAcc('1020').name,
          debit: totalAmount,
          credit: 0,
          description: `Bill to ${inv.customer?.name || 'Customer'}`
        });

        const revenueAccCode = isDomestic ? '4000' : '4010';
        lines.push({
          account: getAcc(revenueAccCode)._id,
          accountCode: revenueAccCode,
          accountName: getAcc(revenueAccCode).name,
          debit: 0,
          credit: subtotal,
          description: `Sales revenue for ${invNum}`
        });

        if (tax > 0) {
          if (inv.taxType === 'cgst_sgst' && isDomestic) {
            const halfTax = Math.round((tax / 2) * 100) / 100;
            lines.push({
              account: getAcc('2010')._id,
              accountCode: '2010',
              accountName: getAcc('2010').name,
              debit: 0,
              credit: halfTax,
              description: 'Output CGST'
            });
            lines.push({
              account: getAcc('2011')._id,
              accountCode: '2011',
              accountName: getAcc('2011').name,
              debit: 0,
              credit: tax - halfTax,
              description: 'Output SGST'
            });
          } else {
            lines.push({
              account: getAcc('2012')._id,
              accountCode: '2012',
              accountName: getAcc('2012').name,
              debit: 0,
              credit: tax,
              description: 'Output IGST / Export Tax'
            });
          }
        }

        if (freight > 0) {
          lines.push({
            account: getAcc('4020')._id,
            accountCode: '4020',
            accountName: getAcc('4020').name,
            debit: 0,
            credit: freight,
            description: 'Freight collected'
          });
        }
        if (insurance > 0) {
          lines.push({
            account: getAcc('4030')._id,
            accountCode: '4030',
            accountName: getAcc('4030').name,
            debit: 0,
            credit: insurance,
            description: 'Insurance collected'
          });
        }

        const debits = lines.reduce((s, l) => s + l.debit, 0);
        const credits = lines.reduce((s, l) => s + l.credit, 0);
        const roundDiff = Number((debits - credits).toFixed(2));
        if (Math.abs(roundDiff) > 0.001) {
          if (roundDiff > 0) {
            lines.push({
              account: getAcc('5080')._id,
              accountCode: '5080',
              accountName: getAcc('5080').name,
              debit: 0,
              credit: roundDiff,
              description: 'Invoice round-off gain'
            });
          } else {
            lines.push({
              account: getAcc('5080')._id,
              accountCode: '5080',
              accountName: getAcc('5080').name,
              debit: Math.abs(roundDiff),
              credit: 0,
              description: 'Invoice round-off adjustment'
            });
          }
        }

        const totalD = lines.reduce((s, l) => s + l.debit, 0);
        const totalC = lines.reduce((s, l) => s + l.credit, 0);
        const jvKey = `JV-INV-${cleanInvNum}`;
        const jvPayload = {
          entryNumber: jvKey,
          voucherNo: jvKey, // Both fields populated
          date: invDate,
          referenceNumber: invNum,
          sourceModule: 'sales_invoice',
          sourceId: invId,
          memo: `Sales Tax Invoice: ${invNum} — ${inv.customer?.name || 'Customer'}`,
          lines,
          totalDebit: Math.round(totalD * 100) / 100,
          totalCredit: Math.round(totalC * 100) / 100,
          status: 'posted'
        };

        await JournalEntry.findOneAndUpdate(
          { sourceModule: 'sales_invoice', sourceId: invId },
          jvPayload,
          { upsert: true, new: true }
        );

        if (cogs > 0) {
          const cogsKey = `JV-COGS-${cleanInvNum}`;
          const cogsPayload = {
            entryNumber: cogsKey,
            voucherNo: cogsKey,
            date: invDate,
            referenceNumber: invNum,
            sourceModule: 'inventory_adjustment',
            sourceId: invId,
            memo: `COGS Recognition for ${invNum}`,
            lines: [
              {
                account: getAcc('5000')._id,
                accountCode: '5000',
                accountName: getAcc('5000').name,
                debit: cogs,
                credit: 0,
                description: `Cost of goods dispatched for ${invNum}`
              },
              {
                account: getAcc('1030')._id,
                accountCode: '1030',
                accountName: getAcc('1030').name,
                debit: 0,
                credit: cogs,
                description: `Inventory reduction for ${invNum}`
              }
            ],
            totalDebit: cogs,
            totalCredit: cogs,
            status: 'posted'
          };
          await JournalEntry.findOneAndUpdate(
            { sourceModule: 'inventory_adjustment', sourceId: invId },
            cogsPayload,
            { upsert: true, new: true }
          );
        }
      }

      // Customer payments
      let customerPayments = (inv.payments && inv.payments.length > 0) ? inv.payments : [];
      if (customerPayments.length === 0 && Number(inv.paidAmount) > 0) {
        customerPayments = [{
          date: inv.date || inv.createdAt,
          amount: Number(inv.paidAmount),
          method: 'bank_transfer',
          reference: inv.invoiceNumber
        }];
      }

      for (let pIdx = 0; pIdx < customerPayments.length; pIdx++) {
        const pay = customerPayments[pIdx];
        const payAmt = Number(pay.amount) || 0;
        if (payAmt <= 0) continue;

        const payKey = `JV-RCT-${cleanInvNum}-${pIdx + 1}`;
        const bankCode = (pay.method === 'cash') ? '1000' : '1010';

        const rctPayload = {
          entryNumber: payKey,
          voucherNo: payKey,
          date: parseSafeDate(pay.date || invDate),
          referenceNumber: pay.reference || invNum,
          sourceModule: 'payment_receipt',
          sourceId: invId,
          memo: `Payment Received from ${inv.customer?.name || 'Customer'} on ${invNum} (${pay.method || 'bank'})`,
          lines: [
            {
              account: getAcc(bankCode)._id,
              accountCode: bankCode,
              accountName: getAcc(bankCode).name,
              debit: payAmt,
              credit: 0,
              description: `Collection via ${pay.method || 'bank'} [Ref: ${pay.reference || 'None'}]`
            },
            {
              account: getAcc('1020')._id,
              accountCode: '1020',
              accountName: getAcc('1020').name,
              debit: 0,
              credit: payAmt,
              description: `Receivables settled on ${invNum}`
            }
          ],
          totalDebit: payAmt,
          totalCredit: payAmt,
          status: 'posted'
        };

        await JournalEntry.findOneAndUpdate(
          { entryNumber: payKey },
          rctPayload,
          { upsert: true, new: true }
        );
      }
    }

    // -------------------------------------------------------------
    // 2. PURCHASE BILL VOUCHER (JV-PI) & DISBURSEMENT (JV-DSB)
    // -------------------------------------------------------------
    for (const pi of purchaseInvoices) {
      const piId = pi._id;
      const piNum = pi.invoiceNumber;
      const cleanPiNum = piNum.replace(/[^a-zA-Z0-9]/g, '');
      const piDate = parseSafeDate(pi.invoiceDate || pi.createdAt);
      const grandTotal = Number(pi.grandTotal) || 0;
      const subtotal = Number(pi.subtotal) || 0;
      const totalTax = Number(pi.totalTax) || 0;
      const freightAmt = Number(pi.freight?.amount) || 0;
      const insuranceAmt = Number(pi.insurance?.amount) || 0;
      const inventoryChargesAmt = Number(pi.inventoryCharges?.amount) || 0;

      // 2A. Purchase Bill Entry
      if (grandTotal <= 0) {
        await JournalEntry.deleteMany({ sourceModule: 'purchase_invoice', sourceId: piId });
      }
      if (grandTotal > 0) {
        const lines = [];

        lines.push({
          account: getAcc('1030')._id,
          accountCode: '1030',
          accountName: getAcc('1030').name,
          debit: subtotal,
          credit: 0,
          description: `Stock receipt on ${piNum} from ${pi.supplierName}`
        });

        if (totalTax > 0) {
          if (pi.gstType === 'cgst_sgst') {
            const halfTax = Math.round((totalTax / 2) * 100) / 100;
            lines.push({
              account: getAcc('1040')._id,
              accountCode: '1040',
              accountName: getAcc('1040').name,
              debit: halfTax,
              credit: 0,
              description: 'Input CGST credit'
            });
            lines.push({
              account: getAcc('1041')._id,
              accountCode: '1041',
              accountName: getAcc('1041').name,
              debit: totalTax - halfTax,
              credit: 0,
              description: 'Input SGST credit'
            });
          } else {
            lines.push({
              account: getAcc('1042')._id,
              accountCode: '1042',
              accountName: getAcc('1042').name,
              debit: totalTax,
              credit: 0,
              description: 'Input IGST credit'
            });
          }
        }

        if (freightAmt > 0) {
          lines.push({
            account: getAcc('5020')._id,
            accountCode: '5020',
            accountName: getAcc('5020').name,
            debit: freightAmt,
            credit: 0,
            description: 'Inward freight expense'
          });
        }

        if (insuranceAmt > 0) {
          lines.push({
            account: getAcc('5030')._id,
            accountCode: '5030',
            accountName: getAcc('5030').name,
            debit: insuranceAmt,
            credit: 0,
            description: 'Transit insurance expense'
          });
        }

        if (inventoryChargesAmt > 0) {
          lines.push({
            account: getAcc('5050')._id,
            accountCode: '5050',
            accountName: getAcc('5050').name,
            debit: inventoryChargesAmt,
            credit: 0,
            description: 'Inward handling & inventory charges'
          });
        }

        lines.push({
          account: getAcc('2000')._id,
          accountCode: '2000',
          accountName: getAcc('2000').name,
          debit: 0,
          credit: grandTotal,
          description: `Payable to ${pi.supplierName}`
        });

        const debits = lines.reduce((s, l) => s + l.debit, 0);
        const credits = lines.reduce((s, l) => s + l.credit, 0);
        const diff = Number((debits - credits).toFixed(2));
        if (Math.abs(diff) > 0.001) {
          if (diff > 0) {
            lines.push({
              account: getAcc('5080')._id,
              accountCode: '5080',
              accountName: getAcc('5080').name,
              debit: 0,
              credit: diff,
              description: 'Purchase bill round-off gain'
            });
          } else {
            lines.push({
              account: getAcc('5080')._id,
              accountCode: '5080',
              accountName: getAcc('5080').name,
              debit: Math.abs(diff),
              credit: 0,
              description: 'Purchase bill round-off expense'
            });
          }
        }

        const totalD = lines.reduce((s, l) => s + l.debit, 0);
        const totalC = lines.reduce((s, l) => s + l.credit, 0);
        const piJvKey = `JV-PI-${cleanPiNum}`;

        const piJvPayload = {
          entryNumber: piJvKey,
          voucherNo: piJvKey,
          date: piDate,
          referenceNumber: piNum,
          sourceModule: 'purchase_invoice',
          sourceId: piId,
          memo: `Purchase Bill (PI): ${piNum} — ${pi.supplierName}`,
          lines,
          totalDebit: Math.round(totalD * 100) / 100,
          totalCredit: Math.round(totalC * 100) / 100,
          status: 'posted'
        };

        await JournalEntry.findOneAndUpdate(
          { sourceModule: 'purchase_invoice', sourceId: piId },
          piJvPayload,
          { upsert: true, new: true }
        );
      }

      // 2B. ⭐ VENDOR PAYMENTS / DISBURSEMENT ENTRY (FULLY FIXED)
      let piPayments = (pi.payments && Array.isArray(pi.payments) && pi.payments.length > 0)
        ? [...pi.payments]
        : [];

      const isMarkedPaid = String(pi.paymentStatus || '').toLowerCase() === 'paid' ||
                           String(pi.status || '').toLowerCase() === 'paid';

      const recordedPaid = Number(pi.paidAmount) || 0;
      const effectivePaidAmount = recordedPaid > 0 ? recordedPaid : (isMarkedPaid && !pi.returnCredit ? grandTotal : 0);

      // Fallback: Agar payment status 'paid' hai ya paidAmount > 0 hai aur payments array khali hai
      if (piPayments.length === 0 && effectivePaidAmount > 0) {
        piPayments = [{
          date: pi.invoiceDate || pi.createdAt,
          amount: effectivePaidAmount,
          method: 'bank',
          reference: pi.invoiceNumber
        }];
      }

      for (let pIdx = 0; pIdx < piPayments.length; pIdx++) {
        const pay = piPayments[pIdx];
        const payAmt = Number(pay.amount) || 0;
        if (payAmt <= 0) continue;

        const payKey = `JV-DSB-${cleanPiNum}-${pIdx + 1}`;
        const payMethodLower = String(pay.method || '').toLowerCase();
        const bankCode = payMethodLower === 'cash' ? '1000' : '1010';

        const dsbPayload = {
          entryNumber: payKey,
          voucherNo: payKey,
          date: parseSafeDate(pay.date || piDate),
          referenceNumber: piNum,
          sourceModule: 'payment_disbursement',
          sourceId: piId,
          memo: `Disbursement to Supplier: ${pi.supplierName} on ${piNum} (${pay.method || 'bank'})`,
          lines: [
            {
              account: getAcc('2000')._id,
              accountCode: '2000',
              accountName: getAcc('2000').name,
              debit: payAmt,
              credit: 0,
              description: `Accounts payable settlement for ${piNum}`
            },
            {
              account: getAcc(bankCode)._id,
              accountCode: bankCode,
              accountName: getAcc(bankCode).name,
              debit: 0,
              credit: payAmt,
              description: `Paid via ${pay.method || 'bank'} [Ref: ${pay.reference || piNum}]`
            }
          ],
          totalDebit: payAmt,
          totalCredit: payAmt,
          status: 'posted'
        };

        await JournalEntry.findOneAndUpdate(
          { entryNumber: payKey },
          dsbPayload,
          { upsert: true, new: true }
        );
      }
    }
  } catch (err) {
    console.error('Automated Journal Sync error:', err);
  }
};

exports.syncAllAutomatedJournals = syncAllAutomatedJournals;

exports.syncAutomatedJournals = async (req, res) => {
  try {
    await syncAllAutomatedJournals();
    res.json({ success: true, message: 'All transactions synchronized and orphaned vouchers purged successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.initChartOfAccounts = async (req, res) => {
  try {
    const accMap = await getAccountMap();
    res.json({ success: true, message: `Chart of Accounts verified (${accMap.size} accounts active).` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAccounts = async (req, res) => {
  try {
    await getAccountMap();
    const { type, search } = req.query;
    const query = { isActive: true };
    if (type && type !== 'all') query.type = type;
    if (search) {
      query.$or = [
        { code: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } }
      ];
    }

    const accounts = await Account.find(query).sort({ code: 1 });
    res.json({ success: true, data: accounts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createAccount = async (req, res) => {
  try {
    const { code, name, type, subType, currency, description } = req.body;
    const exists = await Account.findOne({ code: code.trim() });
    if (exists) {
      return res.status(400).json({ success: false, message: `Account code "${code}" already exists` });
    }

    const account = await Account.create({
      code: code.trim(),
      name: name.trim(),
      type,
      subType,
      currency: currency || 'INR',
      description,
      createdBy: req.user?._id
    });

    res.status(201).json({ success: true, data: account, message: 'Account created successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateAccount = async (req, res) => {
  try {
    const { name, subType, description, isActive } = req.body;
    const account = await Account.findByIdAndUpdate(
      req.params.id,
      { name, subType, description, isActive },
      { new: true }
    );
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    res.json({ success: true, data: account, message: 'Account updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const account = await Account.findById(id);
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

    if (account.isSystem) {
      return res.status(400).json({ success: false, message: 'System accounts cannot be deleted.' });
    }

    const hasEntries = await JournalEntry.exists({ 'lines.account': id });
    if (hasEntries) {
      return res.status(400).json({ success: false, message: 'Cannot delete account with existing transactions in ledger. You can mark it inactive instead.' });
    }

    await account.deleteOne();
    res.json({ success: true, message: 'Account deleted successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getJournalEntries = async (req, res) => {
  try {
    await syncAllAutomatedJournals();

    const { page = 1, limit = 50, search, sourceModule, startDate, endDate } = req.query;
    const query = {};

    if (sourceModule && sourceModule !== 'all') {
      query.sourceModule = sourceModule;
    }

    if (search) {
      query.$or = [
        { entryNumber: { $regex: search, $options: 'i' } },
        { voucherNo: { $regex: search, $options: 'i' } },
        { referenceNumber: { $regex: search, $options: 'i' } },
        { memo: { $regex: search, $options: 'i' } },
        { 'lines.accountName': { $regex: search, $options: 'i' } }
      ];
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = parseSafeDate(startDate);
      if (endDate) query.date.$lte = parseSafeDate(endDate);
    }

    const entries = await JournalEntry.find(query)
      .populate('lines.account', 'code name type subType')
      .populate('createdBy', 'name')
      .sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await JournalEntry.countDocuments(query);

    res.json({
      success: true,
      data: entries,
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

exports.getJournalEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await JournalEntry.findById(id).populate('lines.account', 'code name type subType');
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Journal voucher not found' });
    }
    res.json({ success: true, data: entry });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createJournalEntry = async (req, res) => {
  try {
    const { date, referenceNumber, memo, lines, currency } = req.body;

    if (!lines || lines.length < 2) {
      return res.status(400).json({ success: false, message: 'Journal entry requires at least 2 lines (debit & credit).' });
    }

    let totalDebit = 0;
    let totalCredit = 0;
    const enrichedLines = [];

    for (const line of lines) {
      const d = parseFloat(line.debit) || 0;
      const c = parseFloat(line.credit) || 0;
      totalDebit += d;
      totalCredit += c;

      const acc = await Account.findById(line.account);
      if (!acc) {
        return res.status(400).json({ success: false, message: `Invalid account ID specified in lines.` });
      }

      enrichedLines.push({
        account: acc._id,
        accountCode: acc.code,
        accountName: acc.name,
        debit: Math.round(d * 100) / 100,
        credit: Math.round(c * 100) / 100,
        description: line.description || '',
        entityType: line.entityType || 'Other',
        entityId: line.entityId || null
      });
    }

    if (Math.abs(totalDebit - totalCredit) > 0.05) {
      return res.status(400).json({
        success: false,
        message: `Debit total (${totalDebit.toFixed(2)}) must equal Credit total (${totalCredit.toFixed(2)}).`
      });
    }

    const year = new Date().getFullYear();
    const count = await JournalEntry.countDocuments({ sourceModule: 'manual' });
    const entryNumber = `JV-MAN-${year}/${String(count + 1).padStart(4, '0')}`;

    const journal = await JournalEntry.create({
      entryNumber,
      voucherNo: entryNumber,
      date: parseSafeDate(date),
      referenceNumber: referenceNumber || '',
      sourceModule: 'manual',
      memo: memo || 'Manual Journal Voucher',
      lines: enrichedLines,
      totalDebit: Math.round(totalDebit * 100) / 100,
      totalCredit: Math.round(totalCredit * 100) / 100,
      currency: currency || 'INR',
      status: 'posted',
      createdBy: req.user?._id
    });

    res.status(201).json({ success: true, data: journal, message: `Journal entry ${entryNumber} posted successfully.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateJournalEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, referenceNumber, memo, lines, currency } = req.body;

    const jv = await JournalEntry.findById(id);
    if (!jv) return res.status(404).json({ success: false, message: 'Journal voucher not found' });
    if (jv.sourceModule === 'purchase_return') return res.status(400).json({ success: false, message: 'Cancel the purchase return to reverse this journal.' });

    if (!lines || lines.length < 2) {
      return res.status(400).json({ success: false, message: 'Journal entry requires at least 2 lines (debit & credit).' });
    }

    let totalDebit = 0;
    let totalCredit = 0;
    const enrichedLines = [];

    for (const line of lines) {
      const d = parseFloat(line.debit) || 0;
      const c = parseFloat(line.credit) || 0;
      totalDebit += d;
      totalCredit += c;

      const acc = await Account.findById(line.account);
      if (!acc) {
        return res.status(400).json({ success: false, message: 'Invalid account ID in line item.' });
      }

      enrichedLines.push({
        account: acc._id,
        accountCode: acc.code,
        accountName: acc.name,
        debit: Math.round(d * 100) / 100,
        credit: Math.round(c * 100) / 100,
        description: line.description || '',
        entityType: line.entityType || 'Other',
        entityId: line.entityId || null
      });
    }

    if (Math.abs(totalDebit - totalCredit) > 0.05) {
      return res.status(400).json({
        success: false,
        message: `Debit total (${totalDebit.toFixed(2)}) must equal Credit total (${totalCredit.toFixed(2)}).`
      });
    }

    if (date) jv.date = parseSafeDate(date);
    if (referenceNumber !== undefined) jv.referenceNumber = referenceNumber;
    if (memo !== undefined) jv.memo = memo;
    if (currency) jv.currency = currency;
    jv.lines = enrichedLines;
    jv.totalDebit = Math.round(totalDebit * 100) / 100;
    jv.totalCredit = Math.round(totalCredit * 100) / 100;
    jv.voucherNo = jv.entryNumber;

    await jv.save();

    res.json({ success: true, data: jv, message: `Journal entry #${jv.entryNumber} updated successfully.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteJournalEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await JournalEntry.findById(id);
    if (existing?.sourceModule === 'purchase_return') return res.status(400).json({ success: false, message: 'Cancel the purchase return to reverse this journal.' });
    const deleted = await JournalEntry.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Journal voucher not found' });
    }
    res.json({ success: true, message: 'Journal voucher deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getGeneralLedger = async (req, res) => {
  try {
    await syncAllAutomatedJournals();

    const { accountId, startDate, endDate } = req.query;

    if (!accountId || !mongoose.Types.ObjectId.isValid(accountId)) {
      return res.status(400).json({ success: false, message: 'Valid accountId required' });
    }

    const account = await Account.findById(accountId);
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

    const dateQuery = { 'lines.account': account._id, status: 'posted' };
    if (startDate || endDate) {
      dateQuery.date = {};
      if (startDate) dateQuery.date.$gte = parseSafeDate(startDate);
      if (endDate) dateQuery.date.$lte = parseSafeDate(endDate);
    }

    const entries = await JournalEntry.find(dateQuery).sort({ date: 1, createdAt: 1 });

    let runningBalance = 0;
    const ledgerLines = [];

    entries.forEach((entry) => {
      const matching = entry.lines.filter((l) => l.account.toString() === account._id.toString());
      matching.forEach((line) => {
        if (['asset', 'expense'].includes(account.type)) {
          runningBalance += (line.debit - line.credit);
        } else {
          runningBalance += (line.credit - line.debit);
        }

        ledgerLines.push({
          voucherId: entry._id,
          date: entry.date,
          entryNumber: entry.entryNumber,
          referenceNumber: entry.referenceNumber,
          memo: entry.memo,
          sourceModule: entry.sourceModule,
          description: line.description || entry.memo,
          debit: line.debit,
          credit: line.credit,
          balance: Math.round(runningBalance * 100) / 100
        });
      });
    });

    res.json({
      success: true,
      data: {
        account,
        openingBalance: 0,
        closingBalance: Math.round(runningBalance * 100) / 100,
        transactions: ledgerLines
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getTrialBalance = async (req, res) => {
  try {
    await syncAllAutomatedJournals();

    const { asOfDate } = req.query;
    const dateLimit = asOfDate ? parseSafeDate(asOfDate) : new Date();

    const accounts = await Account.find({ isActive: true }).sort({ code: 1 });
    const trialLines = [];

    let totalDebit = 0;
    let totalCredit = 0;

    for (const acc of accounts) {
      const entries = await JournalEntry.find({
        'lines.account': acc._id,
        status: 'posted',
        date: { $lte: dateLimit }
      });

      let netDebit = 0;
      let netCredit = 0;

      entries.forEach((entry) => {
        entry.lines
          .filter((l) => l.account.toString() === acc._id.toString())
          .forEach((line) => {
            netDebit += line.debit || 0;
            netCredit += line.credit || 0;
          });
      });

      let debitBalance = 0;
      let creditBalance = 0;

      if (['asset', 'expense'].includes(acc.type)) {
        const bal = netDebit - netCredit;
        if (bal >= 0) debitBalance = bal;
        else creditBalance = Math.abs(bal);
      } else {
        const bal = netCredit - netDebit;
        if (bal >= 0) creditBalance = bal;
        else debitBalance = Math.abs(bal);
      }

      if (debitBalance > 0 || creditBalance > 0 || acc.isSystem) {
        totalDebit += debitBalance;
        totalCredit += creditBalance;

        trialLines.push({
          _id: acc._id,
          code: acc.code,
          name: acc.name,
          type: acc.type,
          subType: acc.subType,
          debit: Math.round(debitBalance * 100) / 100,
          credit: Math.round(creditBalance * 100) / 100
        });
      }
    }

    res.json({
      success: true,
      data: {
        asOfDate: dateLimit,
        lines: trialLines,
        totalDebit: Math.round(totalDebit * 100) / 100,
        totalCredit: Math.round(totalCredit * 100) / 100,
        isBalanced: Math.abs(totalDebit - totalCredit) < 0.05
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getProfitLoss = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? parseSafeDate(startDate) : new Date(new Date().getFullYear(), 0, 1);
    const end = endDate ? parseSafeDate(endDate) : new Date();

    const [invoices, purchaseInvoices, journalExpenses] = await Promise.all([
      Invoice.find({
        date: { $gte: start, $lte: end },
        status: { $ne: 'cancelled' }
      }),
      ConsolidatedInvoice.find({
        createdAt: { $gte: start, $lte: end }
      }),
      JournalEntry.find({
        date: { $gte: start, $lte: end },
        status: 'posted'
      }).populate('lines.account', 'type subType')
    ]);

    let domesticSales = 0;
    let exportSales = 0;
    let freightIncome = 0;
    let insuranceIncome = 0;
    let totalIncentives = 0;
    let directMaterialsCOGS = 0;

    invoices.forEach((inv) => {
      const sub = Number(inv.subtotal) || 0;
      const isExport = inv.type === 'international' || (inv.currency && inv.currency !== 'INR');
      if (isExport) exportSales += sub;
      else domesticSales += sub;

      freightIncome += Number(inv.freight) || 0;
      insuranceIncome += Number(inv.insurance) || 0;
      totalIncentives += Number(inv.incentive) || 0;
      directMaterialsCOGS += Number(inv.totalCost) || 0;
    });

    let procurementBills = 0;
    purchaseInvoices.forEach((pi) => {
      procurementBills += (Number(pi.subtotal) || 0) - (Number(pi.returnSubtotal) || 0);
    });

    if (directMaterialsCOGS === 0 && procurementBills > 0) {
      directMaterialsCOGS = procurementBills;
    }

    let manualOperatingExpenses = 0;
    journalExpenses.forEach((je) => {
      je.lines.forEach((l) => {
        if (l.account?.type === 'expense' && l.account?.subType !== 'cost_of_goods_sold') {
          manualOperatingExpenses += ((Number(l.debit) || 0) - (Number(l.credit) || 0));
        }
      });
    });

    const totalRevenue = domesticSales + exportSales + freightIncome + insuranceIncome;
    const grossProfit = totalRevenue - directMaterialsCOGS;
    const totalOperatingExpenses = totalIncentives + Math.max(0, manualOperatingExpenses);
    const netProfit = grossProfit - totalOperatingExpenses;

    res.json({
      success: true,
      data: {
        period: { start, end },
        revenue: {
          domesticSales: Math.round(domesticSales * 100) / 100,
          exportSales: Math.round(exportSales * 100) / 100,
          freightIncome: Math.round(freightIncome * 100) / 100,
          insuranceIncome: Math.round(insuranceIncome * 100) / 100,
          totalRevenue: Math.round(totalRevenue * 100) / 100
        },
        cogs: {
          directMaterials: Math.round(directMaterialsCOGS * 100) / 100,
          totalCOGS: Math.round(directMaterialsCOGS * 100) / 100
        },
        grossProfit: Math.round(grossProfit * 100) / 100,
        grossMargin: totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(2) : '0.00',
        expenses: {
          salesIncentives: Math.round(totalIncentives * 100) / 100,
          manualOperatingExpenses: Math.round(manualOperatingExpenses * 100) / 100,
          totalExpenses: Math.round(totalOperatingExpenses * 100) / 100
        },
        netProfit: Math.round(netProfit * 100) / 100,
        netMargin: totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(2) : '0.00'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getBalanceSheet = async (req, res) => {
  try {
    const { asOfDate } = req.query;
    const dateLimit = asOfDate ? parseSafeDate(asOfDate) : new Date();
    dateLimit.setHours(23, 59, 59, 999);

    const [invoices, purchases, liveInventoryValue, journalLines] = await Promise.all([
      Invoice.find({ date: { $lte: dateLimit }, status: { $ne: 'cancelled' } }),
      ConsolidatedInvoice.find({ createdAt: { $lte: dateLimit } }),
      getLiveInventoryValuation(),
      JournalEntry.find({ date: { $lte: dateLimit }, status: 'posted' }).populate('lines.account', 'code name type subType')
    ]);

    const accountsReceivable = invoices.reduce((sum, inv) => sum + (Number(inv.dueAmount) || 0), 0);
    const accountsPayable = purchases.reduce((sum, pi) => sum + (Number(pi.remainingAmount) || 0), 0);

    const totalCashCollected = invoices.reduce((sum, inv) => sum + (Number(inv.paidAmount) || 0), 0);
    const totalVendorPaid = purchases.reduce((sum, pi) => sum + (Number(pi.paidAmount) || 0), 0);

    let journalBankAdjustments = 0;
    let fixedAssetsValuation = 0;
    let capitalAmount = 0;

    journalLines.forEach((je) => {
      je.lines.forEach((l) => {
        if (l.account?.subType === 'bank' || l.account?.subType === 'cash') {
          journalBankAdjustments += ((Number(l.debit) || 0) - (Number(l.credit) || 0));
        }
        if (l.account?.subType === 'fixed_asset') {
          fixedAssetsValuation += ((Number(l.debit) || 0) - (Number(l.credit) || 0));
        }
        if (l.account?.subType === 'equity') {
          capitalAmount += ((Number(l.credit) || 0) - (Number(l.debit) || 0));
        }
      });
    });

    const cashAndBank = Math.max(0, (totalCashCollected - totalVendorPaid + journalBankAdjustments));
    const inventoryValuation = liveInventoryValue || 0;

    const supplierCredits = purchases.reduce((sum, pi) => sum + Number(pi.supplierCredit || 0), 0);
    const totalCurrentAssets = cashAndBank + accountsReceivable + inventoryValuation + supplierCredits;
    const totalAssets = totalCurrentAssets + Math.max(0, fixedAssetsValuation);

    const totalOutputGst = invoices.reduce((sum, inv) => sum + (Number(inv.tax) || 0), 0);
    const totalInputGst = purchases.reduce((sum, pi) => sum + (Number(pi.totalTax) || 0) - (Number(pi.returnTax) || 0), 0);
    const outputGstPayable = Math.max(0, totalOutputGst - totalInputGst);

    const totalCurrentLiabilities = accountsPayable + outputGstPayable;
    const totalLiabilities = totalCurrentLiabilities;

    const ownersEquity = Math.max(0, capitalAmount);
    const retainedEarnings = totalAssets - totalLiabilities - ownersEquity;
    const totalEquity = ownersEquity + retainedEarnings;

    res.json({
      success: true,
      data: {
        asOfDate: dateLimit,
        assets: {
          currentAssets: {
            cashAndBank: Math.round(cashAndBank * 100) / 100,
            accountsReceivable: Math.round(accountsReceivable * 100) / 100,
            inventory: Math.round(inventoryValuation * 100) / 100,
            supplierCredits: Math.round(supplierCredits * 100) / 100,
            totalCurrent: Math.round(totalCurrentAssets * 100) / 100
          },
          fixedAssets: {
            equipmentAndVehicles: Math.round(fixedAssetsValuation * 100) / 100,
            totalFixed: Math.round(fixedAssetsValuation * 100) / 100
          },
          totalAssets: Math.round(totalAssets * 100) / 100
        },
        liabilities: {
          currentLiabilities: {
            accountsPayable: Math.round(accountsPayable * 100) / 100,
            taxPayable: Math.round(outputGstPayable * 100) / 100,
            totalCurrent: Math.round(totalCurrentLiabilities * 100) / 100
          },
          totalLiabilities: Math.round(totalLiabilities * 100) / 100
        },
        equity: {
          capital: Math.round(ownersEquity * 100) / 100,
          retainedEarnings: Math.round(retainedEarnings * 100) / 100,
          totalEquity: Math.round(totalEquity * 100) / 100
        },
        isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.05
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAccountingDashboard = async (req, res) => {
  try {
    await syncAllAutomatedJournals();

    const [invoices, purchases, recentJournals, recentInvoices, liveStockValuation] = await Promise.all([
      Invoice.find({ status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }),
      ConsolidatedInvoice.find().sort({ createdAt: -1 }),
      JournalEntry.find().sort({ date: -1, createdAt: -1 }).limit(8).populate('lines.account', 'code name'),
      Invoice.find().sort({ createdAt: -1 }).limit(6),
      getLiveInventoryValuation()
    ]);

    let totalRevenue = 0;
    let totalReceivables = 0;
    let totalIncentivePaid = 0;
    let totalTaxCollected = 0;
    let totalCustomerPaid = 0;

    invoices.forEach((inv) => {
      totalRevenue += Number(inv.total) || 0;
      totalReceivables += Number(inv.dueAmount) || 0;
      totalCustomerPaid += Number(inv.paidAmount) || 0;
      totalIncentivePaid += Number(inv.incentive) || 0;
      totalTaxCollected += Number(inv.tax) || 0;
    });

    let totalPayables = 0;
    let totalProcurementSpend = 0;
    let totalVendorPaid = 0;
    let totalInputTax = 0;

    purchases.forEach((pi) => {
      totalProcurementSpend += (Number(pi.grandTotal) || 0) - (Number(pi.returnCredit) || 0);
      totalPayables += Number(pi.remainingAmount) || 0;
      totalVendorPaid += Number(pi.paidAmount) || 0;
      totalInputTax += (Number(pi.totalTax) || 0) - (Number(pi.returnTax) || 0);
    });

    const netCashFlow = totalCustomerPaid - totalVendorPaid;

    res.json({
      success: true,
      data: {
        kpi: {
          totalRevenue: Math.round(totalRevenue),
          totalReceivables: Math.round(totalReceivables),
          totalPayables: Math.round(totalPayables),
          procurementSpend: Math.round(totalProcurementSpend),
          taxCollected: Math.round(totalTaxCollected),
          taxPaidOnPurchases: Math.round(totalInputTax),
          incentivesDisbursed: Math.round(totalIncentivePaid),
          inventoryAssetValue: Math.round(liveStockValuation),
          totalCustomerPaid: Math.round(totalCustomerPaid),
          totalVendorPaid: Math.round(totalVendorPaid),
          netCashFlow: Math.round(netCashFlow)
        },
        recentInvoices,
        recentJournals,
        recentPurchases: purchases.slice(0, 6)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getTaxAndFinancialReports = async (req, res) => {
  try {
    const [invoices, purchases] = await Promise.all([
      Invoice.find({ status: { $ne: 'cancelled' } }),
      ConsolidatedInvoice.find()
    ]);

    let outputGst = 0, cgstOutput = 0, sgstOutput = 0, igstOutput = 0;
    invoices.forEach((inv) => {
      const tax = Number(inv.tax) || 0;
      outputGst += tax;
      const place = (inv.placeOfSupply || '').toLowerCase();
      if (place.includes('delhi') || place.includes('07') || inv.taxType === 'cgst_sgst') {
        cgstOutput += tax / 2;
        sgstOutput += tax / 2;
      } else {
        igstOutput += tax;
      }
    });

    let inputGst = 0;
    purchases.forEach((pi) => {
      inputGst += (Number(pi.totalTax) || 0) - (Number(pi.returnTax) || 0);
    });

    const today = new Date();
    const receivablesAging = { current: 0, overdue30: 0, overdue60: 0, critical90: 0 };

    invoices.forEach((inv) => {
      const due = Number(inv.dueAmount) || 0;
      if (due > 0) {
        const invoiceDueDate = inv.dueDate ? parseSafeDate(inv.dueDate) : parseSafeDate(inv.date);
        const diffDays = Math.floor((today - invoiceDueDate) / (1000 * 60 * 60 * 24));

        if (diffDays <= 0 || diffDays <= 30) receivablesAging.current += due;
        else if (diffDays <= 60) receivablesAging.overdue30 += due;
        else if (diffDays <= 90) receivablesAging.overdue60 += due;
        else receivablesAging.critical90 += due;
      }
    });

    const payablesAging = { current: 0, overdue30: 0, overdue60: 0, critical90: 0 };

    purchases.forEach((pi) => {
      const due = Number(pi.remainingAmount) || 0;
      if (due > 0) {
        const dueDate = pi.dueDate ? parseSafeDate(pi.dueDate) : parseSafeDate(pi.invoiceDate || pi.createdAt);
        const diffDays = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

        if (diffDays <= 0 || diffDays <= 30) payablesAging.current += due;
        else if (diffDays <= 60) payablesAging.overdue30 += due;
        else if (diffDays <= 90) payablesAging.overdue60 += due;
        else payablesAging.critical90 += due;
      }
    });

    res.json({
      success: true,
      data: {
        gstReport: {
          outputGst: Math.round(outputGst * 100) / 100,
          inputGst: Math.round(inputGst * 100) / 100,
          netGstPayable: Math.max(0, Math.round((outputGst - inputGst) * 100) / 100),
          breakdown: {
            cgst: Math.round(cgstOutput * 100) / 100,
            sgst: Math.round(sgstOutput * 100) / 100,
            igst: Math.round(igstOutput * 100) / 100
          }
        },
        receivablesAging: {
          ...receivablesAging,
          total: Math.round(receivablesAging.current + receivablesAging.overdue30 + receivablesAging.overdue60 + receivablesAging.critical90)
        },
        payablesAging: {
          ...payablesAging,
          total: Math.round(payablesAging.current + payablesAging.overdue30 + payablesAging.overdue60 + payablesAging.critical90)
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
