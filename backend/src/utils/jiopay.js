import crypto from 'crypto';
import env from '../config/env.js';
import AppError from './AppError.js';

/**
 * JioPay secure hash: sort all request/response param keys alphabetically,
 * concatenate the values (no delimiters), then HMAC-SHA256 with the merchant
 * secret key, hex-encoded. Per https://docs.jiopay.in/docs/generate-hash
 */
export const generateJiopaySecureHash = (params, secretKey = env.JIOPAY_SECRET_KEY) => {
  if (!secretKey) {
    throw new AppError('JioPay is not configured properly in .env', 500);
  }

  // Confirmed against live UAT responses: JioPay omits a field from the hash
  // input entirely when its value is `false` (e.g. "oth_charge": false means
  // "no charge", not the literal string "false") — verified by reproducing a
  // real STATUS response's secureHash byte-for-byte only once excluded.
  const keys = Object.keys(params)
    .filter((key) => key !== 'secureHash' && params[key] !== undefined && params[key] !== null && params[key] !== '' && params[key] !== false)
    .sort();

  const message = keys.map((key) => String(params[key])).join('');
  return crypto.createHmac('sha256', secretKey).update(message).digest('hex');
};

/**
 * Verifies a secureHash on an inbound response/webhook payload by recomputing
 * it over every other field using the same algorithm as generateJiopaySecureHash.
 */
export const verifyJiopaySecureHash = (payload, secretKey = env.JIOPAY_SECRET_KEY) => {
  if (!payload || !payload.secureHash) {
    return false;
  }

  const { secureHash, ...rest } = payload;
  const expected = generateJiopaySecureHash(rest, secretKey);

  try {
    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(String(secureHash).toLowerCase(), 'hex');
    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
};

/**
 * JioPay expects txnDate as YYYYMMDDHHMISS in IST (Indian Standard Time).
 */
export const formatJiopayTxnDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}${parts.month}${parts.day}${hour}${parts.minute}${parts.second}`;
};
