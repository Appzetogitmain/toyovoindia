import crypto from 'crypto';

/**
 * Airpay parameter sanitizer:
 * Strips special characters per official Airpay specification:
 * , # ( ) { } < > ` ! $ % ^ = + | \ : ' " ; ~ [ ] * &
 */
export const sanitizeAirpayParam = (param) => {
  if (param === null || param === undefined) return '';
  return String(param).replace(/[,#\(\)\{\}<>`!\$%\^=\+\|\\:;~\[\]\*\&'"]/g, '').trim();
};

export const sanitizeAirpayUrl = (url) => {
  if (!url) return '';
  return String(url).replace(/[,#\(\)\{\}<>`!\$%\^=\+\|\\;~\[\]\*'"]/g, '').trim();
};

/**
 * Generates the Airpay private key hash (SHA-256 of apiKey@username:|:password)
 */
export const generateAirpayPrivateKey = (apiKey, username, password) => {
  return crypto
    .createHash('sha256')
    .update(`${apiKey}@${username}:|:${password}`)
    .digest('hex');
};

/**
 * Generates key_sha_256 (SHA-256 of username~:~password)
 */
export const generateAirpayKeySha256 = (username, password) => {
  return crypto
    .createHash('sha256')
    .update(`${username}~:~${password}`)
    .digest('hex');
};

/**
 * Generates the SHA-256 checksum for the Airpay hosted payment request:
 * SHA-256 of (keySha256 + '@' + alldata + txnDate)
 */
export const generateAirpayChecksum = (alldata, keySha256, txnDate) => {
  return crypto
    .createHash('sha256')
    .update(`${keySha256}@${alldata}${txnDate}`)
    .digest('hex');
};

// Standard IEEE 802.3 CRC32 lookup table
const makeCrcTable = () => {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
};

const crcTable = makeCrcTable();

/**
 * Computes standard 32-bit CRC matching PHP's sprintf('%u', crc32($str))
 */
export const crc32 = (str) => {
  let crc = 0 ^ (-1);
  const buf = Buffer.from(String(str), 'utf8');
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return ((crc ^ (-1)) >>> 0).toString();
};

/**
 * Verifies Airpay's ap_SecureHash returned in POST response or webhook
 */
export const verifyAirpayResponseHash = (body, merchantId, username) => {
  const transactionId = body.TRANSACTIONID || body.transactionId || '';
  const apTransactionId = body.APTRANSACTIONID || body.apTransactionId || '';
  const amount = body.AMOUNT || body.amount || '';
  const transactionStatus = body.TRANSACTIONSTATUS || body.transactionStatus || '';
  const message = body.MESSAGE || body.message || '';
  const apSecureHash = body.ap_SecureHash || body.AP_SECUREHASH || '';
  const chmod = String(body.CHMOD || body.chmod || '').toLowerCase().trim();
  const customerVpa = body.CUSTOMERVPA || body.customerVpa || '';

  if (!apSecureHash) {
    return false;
  }

  // UPI with customer VPA
  if (chmod === 'upi' && customerVpa) {
    const checkStringWithVpa = `${transactionId}:${apTransactionId}:${amount}:${transactionStatus}:${message}:${merchantId}:${username}:${customerVpa}`;
    if (crc32(checkStringWithVpa) === String(apSecureHash)) {
      return true;
    }
  }

  // Standard calculation
  const checkString = `${transactionId}:${apTransactionId}:${amount}:${transactionStatus}:${message}:${merchantId}:${username}`;
  return crc32(checkString) === String(apSecureHash);
};
