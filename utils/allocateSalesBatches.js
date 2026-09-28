// Called inside the invoice transaction; validate all lines before saving stock.
module.exports = async function allocateSalesBatches(items, originals, Product) {
  const products = new Map();
  const ordered = new Map();
  const requested = new Map();
  const allocatedItems = [];
  const batchName = value => String(value || '').trim().replace(/^RESTOCK-/i, '');
  for (const item of originals) {
    const id = String(item.productId?._id || item.productId || '');
    ordered.set(id, (ordered.get(id) || 0) + Number(item.quantity || 0));
  }
  for (const item of items) {
    if (item.freight) { allocatedItems.push(item); continue; }
    const id = String(item.productId?._id || item.productId || '');
    const qty = Number(item.quantity);
    if (!ordered.has(id) || !id) throw new Error('Select a product from this proforma.');
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('Quantity must be a positive whole number.');
    requested.set(id, (requested.get(id) || 0) + qty);
    if (requested.get(id) > ordered.get(id)) throw new Error('Quantity exceeds the proforma quantity.');
    if (!products.has(id)) products.set(id, await Product.findById(id));
    const product = products.get(id);
    if (!product) throw new Error('Product no longer exists in inventory.');
    if (product.productType !== 'non-batch') {
      const lot = (product.batches || []).find(b => String(b._id) === String(item.stockBatchId || ''));
      if (!lot) throw new Error(`Select an inventory batch for ${product.name}.`);
      if (item.batchGroup === true) {
        const matching = product.batches.filter(b => batchName(b.batchNumber) === batchName(lot.batchNumber));
        const available = matching.reduce((sum, b) => sum + Math.max(0, Number(b.quantity) - Number(b.reservedQuantity || 0)), 0);
        if (qty > available) throw new Error(`${product.name}, batch ${batchName(lot.batchNumber)}: only ${available} available.`);
        let remaining = qty;
        for (const entry of matching) {
          const taken = Math.min(remaining, Math.max(0, Number(entry.quantity) - Number(entry.reservedQuantity || 0)));
          if (!taken) continue;
          entry.quantity -= taken;
          allocatedItems.push({ ...item, batchGroup: undefined, quantity: taken,
            stockBatchId: entry._id, batch: entry.batchNumber,
            mfgDate: entry.mfgDate || '', expiryDate: entry.expDate || '',
            costPrice: entry.costPrice ?? product.pricing?.costPrice ?? 0 });
          remaining -= taken;
          if (!remaining) break;
        }
        product.stock = product.batches.reduce((sum, b) => sum + Number(b.quantity || 0), 0);
        continue;
      }
      const available = Math.max(0, Number(lot.quantity) - Number(lot.reservedQuantity || 0));
      if (qty > available) throw new Error(`${product.name}, batch ${lot.batchNumber}: only ${available} available.`);
      lot.quantity -= qty;
      item.batch = lot.batchNumber;
      item.mfgDate = lot.mfgDate || '';
      item.expiryDate = lot.expDate || '';
      item.costPrice = lot.costPrice ?? product.pricing?.costPrice ?? 0;
      product.stock = product.batches.reduce((sum, b) => sum + Number(b.quantity || 0), 0);
    } else {
      const available = Math.max(0, Number(product.stock) - Number(product.reservedStock || 0));
      if (qty > available) throw new Error(`${product.name}: only ${available} available.`);
      product.stock -= qty;
      item.batch = '';
      delete item.stockBatchId;
    }
    allocatedItems.push(item);
  }
  for (const product of products.values()) await product.save();
  items.splice(0, items.length, ...allocatedItems);
};
