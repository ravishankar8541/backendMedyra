const { readFileSync } = require('node:fs');
const path = require('node:path');

// Keep shared documents independent of the frontend's deployment URL.
module.exports = 'data:image/png;base64,' + readFileSync(
  path.join(__dirname, '../assets/purchaseInvoiceLogo.png')
).toString('base64');
