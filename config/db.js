const mongoose = require("mongoose");

const dbConnection = async () => {
  try {
     // Temporary debug

    await mongoose.connect(process.env.MONGOURL);

    console.log("✅ Database Connected Successfully");
  } catch (error) {
    console.error("❌ Full MongoDB Error:");
    console.error(error); // Prints the complete error object
    process.exit(1);
  }
};

module.exports = dbConnection;