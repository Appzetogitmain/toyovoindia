import crypto from 'crypto';
import env from '../config/env.js';
import AppError from './AppError.js';

/**
 * Star2Pay / DeekPay MD5 Signature calculation:
 * 1. Filter out non-null, non-empty parameters (and omit `sign`).
 * 2. Sort parameter keys in ascending ASCII alphabetical order.
 * 3. Format as `key=value&` and concatenate in sorted order.
 * 4. Append `secretKey=YOUR_SECRET_KEY` (using uppercase secretKey per official spec).
 * 5. Compute MD5 hash and return in UPPERCASE hexadecimal.
 */
export const generateDeekpaySignature = (params = {}, secretKey = env.DEEKPAY_MERCHANT_KEY) => {
  if (!secretKey) {
    throw new AppError('DeekPay is not configured properly in .env (missing DEEKPAY_MERCHANT_KEY)', 500);
  }

  const keys = Object.keys(params)
    .filter((k) => {
      if (k === 'sign') return false;
      const v = params[k];
      return v !== undefined && v !== null && v !== '';
    })
    .sort();

  let signString = '';
  for (const k of keys) {
    const val = typeof params[k] === 'object' ? JSON.stringify(params[k]) : String(params[k]);
    signString += `${k}=${val}&`;
  }

  // Java/Star2Pay convention: paramStr.append("secretKey=").append(secretKey.toUpperCase())
  signString += `secretKey=${String(secretKey).toUpperCase().trim()}`;

  return crypto
    .createHash('md5')
    .update(signString, 'utf8')
    .digest('hex')
    .toUpperCase();
};

/**
 * Verifies the incoming signature on a Star2Pay / DeekPay callback or response payload.
 */
export const verifyDeekpaySignature = (payload = {}, secretKey = env.DEEKPAY_MERCHANT_KEY) => {
  if (!payload || !payload.sign) {
    return false;
  }

  const { sign, ...rest } = payload;
  const expectedSign = generateDeekpaySignature(rest, secretKey);

  try {
    const expectedBuf = Buffer.from(expectedSign.toUpperCase(), 'utf8');
    const receivedBuf = Buffer.from(String(sign).toUpperCase().trim(), 'utf8');
    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
};

/**
 * Converts INR to integer cents (e.g., 999.00 -> 99900 cents)
 */
export const toDeekpayCents = (amount) => {
  const num = Number(amount);
  if (!Number.isFinite(num) || num < 0) {
    throw new AppError('Invalid amount provided for DeekPay order', 400);
  }
  return Math.round(num * 100);
};

/**
 * Converts integer cents back to INR (e.g., 99900 -> 999)
 */
export const fromDeekpayCents = (cents) => {
  const num = Number(cents);
  if (!Number.isFinite(num)) return 0;
  return Number((num / 100).toFixed(2));
};

/**
 * Parses and verifies whether the requester's IP matches one of the known DeekPay callback IPs.
 */
export const isDeekpayIpWhitelisted = (clientIp, allowedIps = env.DEEKPAY_CALLBACK_IPS) => {
  if (!allowedIps) return true; // if not restricted in config, allow
  const ipList = String(allowedIps)
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);

  if (ipList.length === 0) return true;

  // Clean ipv6 prefixes like '::ffff:13.127.130.180'
  const cleanIp = String(clientIp || '').replace(/^.*:/, '').trim();
  return ipList.includes(cleanIp) || ipList.includes(clientIp);
};
