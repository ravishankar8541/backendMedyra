const mongoose = require('mongoose');

// Mongoose propagates the session to all model reads/writes inside transaction().
// This requires MongoDB replica-set/sharded transactions (including Atlas).
mongoose.set('transactionAsyncLocalStorage', true);

module.exports = function receiptTransaction(handler, syncJournals) {
  return async (req, res) => {
    try {
      const result = await mongoose.connection.transaction(async () => {
        let status = 200;
        let body;
        const response = {
          status(code) { status = code; return this; },
          json(value) {
            if (status >= 400) {
              const error = new Error(value.message || 'Receipt operation failed');
              error.status = status;
              throw error;
            }
            body = value;
            return this;
          },
        };
        await handler(req, response);
        return { status, body };
      });
      // Accounting reads committed invoices and preserves its existing upsert keys.
      if (syncJournals) await syncJournals();
      return res.status(result.status).json(result.body);
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, message: error.message });
    }
  };
};
