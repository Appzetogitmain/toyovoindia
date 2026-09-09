// One-off UAT sign-off test for JioPay initiateSale + Command(STATUS) APIs.
// Run from repo root: node backend/scratch/jiopay-uat-test.js
import crypto from 'crypto';

const BASE_URL = 'https://uat.jiopay.co.in';
const INITIATE_PATH = '/tsp/pg/api/v2/initiateSale';
const COMMAND_PATH = '/tsp/pg/api/command';
const MERCHANT_ID = 'JP2001100068230';
const CURRENCY_CODE = '356';
const RETURN_URL = 'https://api.toyovoindia.com/api/payments/jiopay/return';

// Two secret keys found in the repo's two .env files — testing both to see which is live.
const CANDIDATE_SECRETS = {
  'backend/.env': '10b23b09e7504acf93c41aff5876acb7',
  'backend/backend/.env': 'f94ee01e18d549c69cda99a042e5d92b',
};

const generateHash = (params, secretKey) => {
  const keys = Object.keys(params)
    .filter((k) => k !== 'secureHash' && params[k] !== undefined && params[k] !== null && params[k] !== '' && params[k] !== false)
    .sort();
  const message = keys.map((k) => String(params[k])).join('');
  return crypto.createHmac('sha256', secretKey).update(message).digest('hex');
};

const formatTxnDate = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}${parts.month}${parts.day}${hour}${parts.minute}${parts.second}`;
};

const log = (...args) => console.log(...args);

const testInitiateSale = async (label, secretKey) => {
  const txnid = `UATTEST${Date.now()}${Math.floor(Math.random() * 100)}`;
  const params = {
    merchantId: MERCHANT_ID,
    merchantTxnNo: txnid,
    amount: (1.0).toFixed(2),
    currencyCode: CURRENCY_CODE,
    payType: '0',
    customerEmailID: 'uat-test@toyovoindia.com',
    transactionType: 'SALE',
    returnURL: RETURN_URL,
    txnDate: formatTxnDate(),
    customerName: 'UAT Test User',
    customerMobileNo: '9999999999',
    invoiceNo: `INV-UAT-${Date.now()}`,
  };
  const secureHash = generateHash(params, secretKey);
  const body = { ...params, secureHash };
  const url = `${BASE_URL}${INITIATE_PATH}`;

  log(`\n\n========== initiateSale using secret from ${label} ==========`);
  log('--- REQUEST ---');
  log('POST', url);
  log(JSON.stringify(body, null, 2));

  let res, text;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    text = await res.text();
  } catch (err) {
    log('--- NETWORK ERROR ---', err.message);
    return null;
  }

  log('\n--- RESPONSE ---');
  log('HTTP', res.status, res.statusText);
  log(text);

  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { txnid, data };
};

const testStatusCommand = async (label, secretKey, txnid) => {
  const params = {
    merchantId: MERCHANT_ID,
    merchantTxnNo: txnid,
    originalTxnNo: txnid,
    transactionType: 'STATUS',
  };
  const secureHash = generateHash(params, secretKey);
  const body = new URLSearchParams({ ...params, secureHash });
  const url = `${BASE_URL}${COMMAND_PATH}`;

  log(`\n\n========== Command(STATUS) using secret from ${label} ==========`);
  log('--- REQUEST ---');
  log('POST', url);
  log(body.toString());

  let res, text;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    text = await res.text();
  } catch (err) {
    log('--- NETWORK ERROR ---', err.message);
    return;
  }

  log('\n--- RESPONSE ---');
  log('HTTP', res.status, res.statusText);
  log(text);
};

const main = async () => {
  const results = {};
  for (const [label, secret] of Object.entries(CANDIDATE_SECRETS)) {
    results[label] = await testInitiateSale(label, secret);
  }

  log('\n\n========================================');
  log('SUMMARY');
  log('========================================');
  for (const [label, secret] of Object.entries(CANDIDATE_SECRETS)) {
    const r = results[label];
    const code = r?.data?.responseCode;
    const desc = r?.data?.responseDescription;
    log(`${label} (secret ...${secret.slice(-6)}): responseCode=${code} desc="${desc}"`);
  }

  // Run a STATUS command against whichever secret succeeded (or the first one if both/neither did)
  const workingEntry = Object.entries(results).find(([, r]) => r?.data?.responseCode === 'R1000');
  if (workingEntry) {
    const [label, r] = workingEntry;
    await testStatusCommand(label, CANDIDATE_SECRETS[label], r.txnid);
  } else {
    log('\nNeither secret produced responseCode R1000 — skipping STATUS command test.');
  }
};

main();
