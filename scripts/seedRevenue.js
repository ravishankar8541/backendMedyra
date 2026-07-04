// server/scripts/seedRevenue.js
const mongoose = require('mongoose');
require('dotenv').config();

const Revenue = require('../models/Revenue');
const User = require('../models/User');

const seedRevenue = async () => {
  try {
    const mongoURI = process.env.MONGOURL || process.env.MONGODB_URI || 'mongodb://localhost:27017/medyra';
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB');

    // Clear existing revenue data
    await Revenue.deleteMany({});
    console.log('🗑️ Cleared existing revenue data');

    // Get telecaller user
    let telecaller = await User.findOne({ role: 'telecaller' });
    
    if (!telecaller) {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash('tele123', salt);
      
      telecaller = await User.create({
        name: 'Neha Gupta',
        email: 'neha@medyra.com',
        password: hashedPassword,
        phone: '+91 98765 43210',
        role: 'telecaller',
        status: 'active',
        permissions: ['telecaller', 'lead_management']
      });
      console.log('✅ Telecaller created');
    }

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const revenueData = [];

    // Seed monthly data for telecaller
    months.forEach((month, i) => {
      revenueData.push({
        period: 'monthly',
        periodKey: month,
        year: 2026,
        revenue: 40000 + (i * 5000),
        target: 50000,
        leads: 10 + i,
        converted: 5 + i,
        profit: 10 + (i * 2),
        incentive: 200 + (i * 20),
        assignedTo: telecaller._id
      });
    });

    // Seed quarterly data
    const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
    const quarterMonths = [
      ['Jan', 'Feb', 'Mar'],
      ['Apr', 'May', 'Jun'],
      ['Jul', 'Aug', 'Sep'],
      ['Oct', 'Nov', 'Dec']
    ];

    quarters.forEach((quarter, idx) => {
      const qMonths = quarterMonths[idx];
      let totalRevenue = 0, totalTarget = 0, totalLeads = 0, totalConverted = 0;
      
      qMonths.forEach(month => {
        const data = revenueData.find(r => r.periodKey === month && r.year === 2026);
        if (data) {
          totalRevenue += data.revenue;
          totalTarget += data.target;
          totalLeads += data.leads;
          totalConverted += data.converted;
        }
      });

      revenueData.push({
        period: 'quarterly',
        periodKey: quarter,
        year: 2026,
        revenue: totalRevenue,
        target: totalTarget,
        leads: totalLeads,
        converted: totalConverted,
        profit: 20 + (idx * 5),
        incentive: totalRevenue * 0.015,
        assignedTo: telecaller._id
      });
    });

    // Seed yearly data
    revenueData.push({
      period: 'yearly',
      periodKey: '2026',
      year: 2026,
      revenue: revenueData.filter(r => r.period === 'monthly').reduce((sum, r) => sum + r.revenue, 0),
      target: 600000,
      leads: revenueData.filter(r => r.period === 'monthly').reduce((sum, r) => sum + r.leads, 0),
      converted: revenueData.filter(r => r.period === 'monthly').reduce((sum, r) => sum + r.converted, 0),
      profit: 25,
      incentive: revenueData.filter(r => r.period === 'monthly').reduce((sum, r) => sum + r.incentive, 0),
      assignedTo: telecaller._id
    });

    await Revenue.insertMany(revenueData);
    console.log(`✅ ${revenueData.length} revenue records inserted`);
    console.log('🎉 Done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

seedRevenue();