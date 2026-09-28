const Product = require('../models/Product');
const PurchaseOrder = require('../models/PurchaseOrder');
const PurchaseReturn = require('../models/PurchaseReturn');
const JournalEntry = require('../models/JournalEntry');
const { GoodsReceipt, ConsolidatedInvoice } = require('../models/GoodsReceipt');
const { idOf, fail, plain, applyReceiptStock } = require('./grnStock');

// Called only within receiptTransaction: a failure rolls back every stock/document write.
module.exports = async function deletePurchaseInvoice(invoice, actor) {
  const receipts = await GoodsReceipt.find({ $or: [
    { _id: { $in: [...(invoice.grnIds || []), ...(invoice.grnId ? [invoice.grnId] : [])] } },
    { consolidatedInvoiceId: invoice._id }, { invoiceId: invoice._id }
  ] });
  const receiptIds = receipts.map(row => row._id);
  if (!receipts.length && invoice.items?.length) fail('Linked receipt is missing. Reconcile stock before deleting this invoice.');
  const owned = new Set(receiptIds.map(idOf));
  if ([...(invoice.grnIds || []), ...(invoice.grnId ? [invoice.grnId] : [])].some(id => !owned.has(idOf(id))))
    fail('A linked receipt is missing. Reconcile stock before deleting this invoice.');
  const orders = [invoice.purchaseOrder, ...receipts.map(row => row.purchaseOrder)].filter(Boolean);
  const order = await PurchaseOrder.findOne({ _id: { $in: orders } });
  if (order) fail(`Delete linked Purchase Order ${order.poNumber} from Purchase Orders first, then delete this invoice.`);
  if (await ConsolidatedInvoice.exists({ _id: { $ne: invoice._id }, $or: [
    { grnIds: { $in: receiptIds } }, { grnId: { $in: receiptIds } }
  ] })) fail('A receipt is shared with another invoice. Reconcile its links before deletion.');
  const returns = await PurchaseReturn.find({ $or: [{ invoice: invoice._id }, { 'items.grnId': { $in: receiptIds } }] });
  const products = new Map();
  async function productFor(id) {
    const key = idOf(id);
    if (!products.has(key)) products.set(key, await Product.findById(id));
    const product = products.get(key);
    if (!product) fail('A linked product is missing. Reconcile stock before deleting this invoice.');
    return product;
  }
  function adjust(product, row, delta) {
    if (!delta) return;
    if (product.productType === 'non-batch') {
      const next = Number(product.stock || 0) + delta;
      if (next < Number(product.reservedStock || 0)) fail(`Cannot delete: ${product.name} stock has been sold or reserved.`);
      product.stock = next;
    } else {
      const matches = product.batches.filter(lot => row.stockBatchId
        ? idOf(lot._id) === idOf(row.stockBatchId)
        : lot.batchNumber === row.batchNumber && (row.mrp == null || Number(lot.mrp) === Number(row.mrp)));
      if (matches.length !== 1) fail(`Cannot safely identify batch ${row.batchNumber} for ${product.name}. Reconcile stock before deletion.`);
      const lot = matches[0];
      const next = Number(lot.quantity) + delta;
      if (next < Number(lot.reservedQuantity || 0)) fail(`Cannot delete: ${product.name} batch ${row.batchNumber} has been sold or reserved.`);
      lot.quantity = next;
    }
  }
  for (const doc of returns) {
    if (doc.invoice && idOf(doc.invoice) !== idOf(invoice._id)) fail('A linked return belongs to another invoice. Reconcile its links first.');
    if (doc.items.some(row => row.grnId && !owned.has(idOf(row.grnId)))) fail('A return includes another receipt. Reconcile its links first.');
    const replacements = (doc.replacementHistory || []).flatMap(history => history.items || []);
    const replaced = doc.items.reduce((sum, item) => sum + Number(item.replacedQty || 0), 0);
    if (Math.abs(replacements.reduce((sum, item) => sum + Number(item.quantity || 0), 0) - replaced) > 0.000001)
      fail(`Replacement history for ${doc.returnNumber} is incomplete. Reconcile it before deletion.`);
    // Remove replacement stock before restoring returned units, so sold replacements cannot be masked.
    for (const row of replacements) adjust(await productFor(row.productId), row, -Number(row.quantity));
    for (const row of doc.items) {
      const restore = doc.status === 'completed' ? Number(row.quantity) : doc.status === 'cancelled' ? Number(row.replacedQty || 0) : 0;
      adjust(await productFor(row.product), row, restore);
    }
  }
  for (const grn of receipts) {
    if ([grn.invoiceId, grn.consolidatedInvoiceId].some(id => id && idOf(id) !== idOf(invoice._id)))
      fail('A receipt points to another invoice. Reconcile its links before deletion.');
    if (grn.status !== 'completed') continue;
    for (const row of grn.items) applyReceiptStock(await productFor(row.productId), plain(row), null, grn, actor);
  }
  const replacementReasons = new Set(returns.flatMap(doc => (doc.replacementHistory || []).length ? [doc.returnNumber] : []));
  for (const product of products.values()) {
    product.stockMovements = product.stockMovements.filter(row => !owned.has(idOf(row.sourceGRN)));
    product.batches = product.batches.filter(lot => !((owned.has(idOf(lot.sourceGRN)) ||
      (!lot.sourceGRN && [...replacementReasons].some(number => lot.reason?.endsWith(` for ${number}`)))) &&
      Number(lot.quantity) === 0 && !Number(lot.reservedQuantity)));
    if (product.productType !== 'non-batch') product.stock = product.batches.reduce((sum, lot) => sum + Number(lot.quantity || 0), 0);
    await product.save();
  }
  await JournalEntry.deleteMany({ $or: [
    { sourceModule: { $in: ['purchase_invoice', 'payment_disbursement'] }, sourceId: { $in: [invoice._id, ...receiptIds] } },
    { sourceModule: 'purchase_return', sourceId: { $in: returns.map(row => row._id) } }
  ] });
  await PurchaseReturn.deleteMany({ _id: { $in: returns.map(row => row._id) } });
  await GoodsReceipt.deleteMany({ _id: { $in: receiptIds } });
  await invoice.deleteOne();
};
