function deliveryProof(file) {
  if (!file) return undefined;
  const data = file.buffer;
  const types = [
    ['application/pdf', data.subarray(0, 5).toString() === '%PDF-'],
    ['image/png', data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))],
    ['image/jpeg', data[0] === 255 && data[1] === 216 && data[2] === 255],
    ['image/webp', data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP'],
  ];
  const mimeType = types.find(([, matches]) => matches)?.[0];
  if (!mimeType || data.length > 5 * 1024 * 1024) throw new Error('Attach a JPG, PNG, WebP or PDF proof up to 5 MB.');
  return { name: String(file.originalname || 'handover-proof').replace(/[\r\n]/g, '').slice(0, 160), mimeType, size: data.length, uploadedAt: new Date(), data };
}
module.exports = deliveryProof;
