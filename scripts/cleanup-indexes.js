// scripts/cleanup-indexes.js
const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGOURL || 'mongodb://localhost:27017/medyra';

async function cleanupIndexes() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    console.log("Database url set Successfully");

    const db = mongoose.connection.db;
    const collection = db.collection('purchaseorders');

    // Get all indexes
    const indexes = await collection.indexes();
    console.log('\n📋 Current indexes:');
    indexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    // Find and remove duplicate poNumber index
    const duplicateIndex = indexes.find(idx => idx.name === 'poNumber_1');
    if (duplicateIndex) {
      await collection.dropIndex('poNumber_1');
      console.log('\n✅ Dropped duplicate index: poNumber_1');
    } else {
      console.log('\n✅ No duplicate index found');
    }

    // Show remaining indexes
    const remaining = await collection.indexes();
    console.log('\n📋 Remaining indexes:');
    remaining.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    await mongoose.disconnect();
    console.log('\n✅ Cleanup complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

cleanupIndexes();