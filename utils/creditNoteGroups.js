// Display-only grouping. Saved return lines remain separate for stock and reversals.
function creditNoteGroups(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = JSON.stringify([String(item.product?._id || item.product || ''),
      item.productName || '', item.hsn || '', item.unit || '',
      Number(item.unitPrice || 0), Number(item.taxRate || 0), item.restock !== false]);
    if (!groups.has(key)) groups.set(key, { ...item, key, batches: [], quantity: 0, subtotal: 0, total: 0 });
    const group = groups.get(key);
    const quantity = Number(item.quantity || 0);
    const batchNumber = item.batchNumber || '-';
    const expiryDate = item.expiryDate || '';
    const mfgDate = item.mfgDate || '';
    const batch = group.batches.find(b => b.batchNumber === batchNumber && b.expiryDate === expiryDate && b.mfgDate === mfgDate);
    if (batch) batch.quantity += quantity;
    else group.batches.push({ batchNumber, expiryDate, mfgDate, quantity });
    group.quantity += quantity;
    group.subtotal += Number(item.subtotal ?? quantity * Number(item.unitPrice || 0));
    group.total += Number(item.total || 0);
  }
  return [...groups.values()];
}

module.exports = creditNoteGroups;
