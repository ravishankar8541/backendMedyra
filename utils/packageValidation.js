const statuses = ['pending', 'in_progress', 'completed'];
function normalizePackage(data) {
  const result = { ...data };
  for (const key of ['orderId', 'customerName', 'customerAddress']) {
    if (key in result && (typeof result[key] !== 'string' || !result[key].trim())) throw new Error(`${key} is required.`);
  }
  if (result.status !== undefined && !statuses.includes(result.status)) throw new Error('Invalid package status.');
  if (result.boxes !== undefined) {
    if (!Array.isArray(result.boxes) || !result.boxes.length) throw new Error('Add at least one carton.');
    result.boxes = result.boxes.map((box, index, boxes) => {
      if (!Array.isArray(box.items) || !box.items.length) throw new Error(`Carton ${index + 1} needs at least one product.`);
      for (const item of box.items) {
        if (!item || typeof item.name !== 'string' || !item.name.trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) {
          throw new Error(`Carton ${index + 1}: products require a name and positive quantity.`);
        }
      }
      return { ...box, boxIndex: index + 1, boxNumber: String(box.boxNumber || index + 1), totalBoxes: boxes.length };
    });
    result.totalBoxesCount = result.boxes.length;
    result.boxNo = `1/${result.boxes.length}`;
    result.products = result.boxes.flatMap(box => box.items);
  }
  return result;
}
module.exports = { normalizePackage, statuses };
