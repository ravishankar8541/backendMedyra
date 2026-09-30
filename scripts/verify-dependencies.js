// Fail deployment during the build if the installed MongoDB driver is incomplete.
// No database connection or application secrets are needed for this check.
const { createRequire } = require('node:module');
const mongoose = require('mongoose');
const fromMongoose = createRequire(require.resolve('mongoose'));
const { MongoClient } = fromMongoose('mongodb');

if (typeof mongoose.connect !== 'function' || typeof MongoClient !== 'function') {
  throw new Error('MongoDB dependencies failed to load. Run npm ci for a clean installation.');
}

console.log(`Dependency check passed: Mongoose ${mongoose.version} and its MongoDB driver load successfully.`);
