import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import env from '../config/env.js';

const getSecret = (type) => {
  let secret = type === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  if (!secret && env.NODE_ENV === 'test') {
    secret = 'test_secret_key_safe_for_testing';
  }
  return secret;
};

export const generateTokens = (userId) => {
  const accessSecret = getSecret('access');
  const accessToken = jwt.sign(
    { userId },
    accessSecret,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN || '15m' }
  );

  const refreshTokenPlain = crypto.randomBytes(40).toString('hex');
  const refreshTokenHash = crypto.createHash('sha256').update(refreshTokenPlain).digest('hex');

  return {
    accessToken,
    refreshTokenPlain,
    refreshTokenHash,
  };
};

export const verifyAccessToken = (token) => {
  return jwt.verify(token, getSecret('access'));
};

export const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

export const generateOrderAccessToken = (orderNumber, email = '') => {
  const accessSecret = getSecret('access');
  return jwt.sign(
    {
      orderNumber,
      email: (email || '').toLowerCase().trim(),
      purpose: 'order_summary',
    },
    accessSecret,
    { expiresIn: '24h' }
  );
};

export const verifyOrderAccessToken = (token, orderNumber) => {
  if (!token || !orderNumber) return false;
  try {
    const decoded = jwt.verify(token, getSecret('access'));
    return Boolean(
      decoded &&
      decoded.purpose === 'order_summary' &&
      decoded.orderNumber === orderNumber
    );
  } catch {
    return false;
  }
};

