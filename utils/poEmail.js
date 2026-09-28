const nodemailer = require('nodemailer');

let transporter;
let transportKey;

function getTransport() {
  const host = (process.env.EMAIL_HOST || 'smtp.titan.email').trim();
  const port = Number(process.env.EMAIL_PORT || 587);
  const user = (process.env.EMAIL_USER || '').trim();
  const pass = process.env.EMAIL_PASS || '';
  if (!user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) {
    const error = new Error('Server email configuration is incomplete. Check EMAIL_HOST, EMAIL_PORT, EMAIL_USER and EMAIL_PASS.');
    error.code = 'EMAIL_CONFIG';
    throw error;
  }
  const key = JSON.stringify([host, port, user, pass]);
  if (!transporter || key !== transportKey) {
    transporter?.close();
    transporter = nodemailer.createTransport({
      host, port, secure: port === 465,
      requireTLS: port !== 465,
      auth: { user, pass },
      tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      dnsTimeout: 10000,
    });
    transportKey = key;
  }
  return { transporter, user };
}

function emailError(error, documentName = 'purchase order') {
  if (error.code === 'EMAIL_CONFIG') return error.message;
  if (error.code === 'EAUTH') return 'The mail server rejected the login. Check EMAIL_USER and EMAIL_PASS on the backend.';
  if (['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'EDNS'].includes(error.code)) {
    return 'Could not complete the connection to the mail server. Check EMAIL_HOST, EMAIL_PORT and SMTP network access. Delivery is unconfirmed; check the mailbox before resending.';
  }
  if (error.code === 'EENVELOPE') return 'The mail server rejected the sender or recipient address. Check the email addresses.';
  return `The mail server could not confirm sending the ${documentName}. Check the server logs and mailbox before resending.`;
}

module.exports = { getTransport, emailError };
