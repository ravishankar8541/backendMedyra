const nodemailer = require('nodemailer');
const { generateCreditNotePdfBuffer } = require('./creditNotePdf.service');
const CreditNote = require('../models/CreditNote.model'); // Adjust path to your model

// Configure Nodemailer transporter (matching your Tax Invoice mailer)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// 1. Send Credit Note Email with custom edited Subject & Message
exports.sendCreditNoteEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { email, subject, message } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Recipient email is required' });
    }

    const creditNote = await CreditNote.findById(id).populate('customer');
    if (!creditNote) {
      return res.status(404).json({ success: false, message: 'Credit Note not found' });
    }

    // Generate PDF Buffer
    const pdfBuffer = await generateCreditNotePdfBuffer(creditNote, process.env.SIGNATURE_URL || '');

    // Send Mail with attachment
    await transporter.sendMail({
      from: `"Medyra Pharmaceutical" <${process.env.SMTP_USER || 'Pharmaceutical@medyra.in'}>`,
      to: email,
      subject: subject || `Credit Note: ${creditNote.creditNoteNumber}`,
      text: message,
      attachments: [
        {
          filename: `${creditNote.creditNoteNumber}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    return res.status(200).json({
      success: true,
      message: `Credit note sent successfully to ${email}`,
    });
  } catch (error) {
    console.error('Error sending credit note email:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to send email' });
  }
};



// 2. Download / View PDF Route
exports.downloadCreditNotePdf = async (req, res) => {
  try {
    const { id } = req.params;
    const creditNote = await CreditNote.findById(id).populate('customer');
    if (!creditNote) {
      return res.status(404).json({ success: false, message: 'Credit Note not found' });
    }

    const pdfBuffer = await generateCreditNotePdfBuffer(creditNote, process.env.SIGNATURE_URL || '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${creditNote.creditNoteNumber}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error generating PDF' });
  }
};


