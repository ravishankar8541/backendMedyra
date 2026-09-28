// Verify the staged mailbox without sending email; optionally activate it.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');

async function main() {
  const root = path.resolve(__dirname, '..');
  const staged = dotenv.parse(fs.readFileSync(path.join(root, '.env.medyra-mail')));
  if (staged.EMAIL_HOST !== 'smtp.larksuite.com' || staged.EMAIL_PORT !== '465' ||
      staged.EMAIL_USER?.toLowerCase() !== 'pharmaceutical@medyra.in') {
    throw new Error('The staged settings must specify Pharmaceutical@medyra.in at smtp.larksuite.com:465.');
  }
  if (!staged.EMAIL_PASS?.trim()) {
    throw new Error('Enter the Lark dedicated mail password in .env.medyra-mail first. Active settings have not changed.');
  }
  const transport = nodemailer.createTransport({
    host: staged.EMAIL_HOST, port: 465, secure: true,
    auth: { user: staged.EMAIL_USER, pass: staged.EMAIL_PASS },
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
  try {
    await transport.verify();
  } catch (error) {
    throw new Error(`Lark login could not be verified (${error.code || 'SMTP_ERROR'}). Check the dedicated password and third-party mail access. Active settings have not changed.`);
  } finally {
    transport.close();
  }
  console.log('Medyra SMTP login verified. No email was sent. Inbox placement has not been tested.');
  if (!process.argv.includes('--activate')) {
    console.log('Run again with --activate to switch the backend sender.');
    return;
  }
  const envPath = path.join(root, '.env');
  const original = fs.readFileSync(envPath, 'utf8');
  // dotenv supports literal passwords wrapped in single, double or backtick quotes.
  function quote(value) {
    if (/[\r\n]/.test(value)) throw new Error('Multiline credentials are not supported.');
    const delimiter = ["'", '"', '`'].find(character => !value.includes(character));
    if (!delimiter) throw new Error('Unsupported password quoting; configure the backend manually.');
    return delimiter + value + delimiter;
  }
  const keys = ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASS'];
  const retained = original.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?EMAIL_(HOST|PORT|USER|PASS)\s*=/.test(line));
  const updated = retained.join('\n').trimEnd() + '\n' + keys.map(key => `${key}=${quote(staged[key])}`).join('\n') + '\n';
  // Preserve the previous configuration in a Git-ignored file before replacing it.
  const backup = path.join(root, `.env.before-medyra-${Date.now()}`);
  fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(envPath, updated);
  console.log('Backend sender switched to Pharmaceutical@medyra.in. Restart the backend to apply it.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
