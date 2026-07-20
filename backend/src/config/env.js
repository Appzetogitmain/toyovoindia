import dotenv from 'dotenv';
dotenv.config();
const defaultDevOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:3000',
];

const isProduction = (process.env.NODE_ENV || 'development') === 'production';

// Helper to remove trailing slashes which often cause CORS failures
const normalize = (url) => url?.trim().replace(/\/+$/, '');

const parseOrigins = (value) => (value || '')
  .split(',')
  .map(normalize)
  .filter(Boolean);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const devOrigins = parseOrigins(process.env.CLIENT_URL);
const prodOrigins = parseOrigins(process.env.CLIENT_URL_PROD);
const additionalOrigins = [
  'https://toyovoindia.vercel.app',
  'https://secure.payu.in',
  'https://test.payu.in',
  'https://api.phonepe.com',
  'https://api-preprod.phonepe.com'
];

// Automatically pick the primary URL based on environment
const primaryClientUrl = isProduction 
  ? (normalize(prodOrigins[0]) || 'https://toyovoindia.vercel.app')
  : (process.env.CLIENT_URL || 'http://localhost:5173');

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 5000,
  MONGO_URI: process.env.MONGO_URI,
  CLIENT_URL: normalize(primaryClientUrl),
  SERVER_URL: process.env.SERVER_URL ? normalize(process.env.SERVER_URL) : (isProduction ? normalize(primaryClientUrl) : `http://localhost:${process.env.PORT || 5000}`),
  ALLOWED_ORIGINS: [
    ...new Set([
      normalize(primaryClientUrl),
      ...devOrigins,
      ...prodOrigins,
      ...additionalOrigins,
      ...(!isProduction ? defaultDevOrigins : []),
    ]),
  ],
  VERCEL_PROJECT_SLUG: process.env.VERCEL_PROJECT_SLUG || 'toyove-india-jhkr',
  ALLOWED_ORIGIN_PATTERNS: [
    // Matches toyove-india-jhkr.vercel.app, toyove-india-jhkr-git-main.vercel.app, etc.
    new RegExp(`^https://${escapeRegex(process.env.VERCEL_PROJECT_SLUG || 'toyove-india-jhkr')}.*\\.vercel\\.app$`, 'i'),
    // Matches localhost with any port (for development)
    /^http:\/\/localhost:\d+$/,
  ],
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  COOKIE_SECURE: process.env.COOKIE_SECURE === 'true',
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
  PAYU_KEY: process.env.PAYU_KEY,
  PAYU_SALT: process.env.PAYU_SALT,
  PAYU_MID: process.env.PAYU_MID,
  PAYU_BASE_URL: process.env.PAYU_BASE_URL || 'https://secure.payu.in',
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
  SMTP_USER: process.env.SMTP_USER || process.env.EMAIL_USER,
  SMTP_PASS: process.env.SMTP_PASS || process.env.EMAIL_PASS,
  SMTP_FROM: process.env.SMTP_FROM || process.env.SMTP_USER || process.env.EMAIL_USER,
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  FIREBASE_CONFIG: process.env.FIREBASE_CONFIG,
  PHONEPE_MERCHANT_ID: process.env.PHONEPE_MERCHANT_ID,
  PHONEPE_SALT_KEY: process.env.PHONEPE_SALT_KEY,
  PHONEPE_SALT_INDEX: process.env.PHONEPE_SALT_INDEX,
  PHONEPE_CLIENT_ID: process.env.PHONEPE_CLIENT_ID,
  PHONEPE_CLIENT_SECRET: process.env.PHONEPE_CLIENT_SECRET,
  PHONEPE_ENV: process.env.PHONEPE_ENV,
  PHONEPE_AUTH_URL: process.env.PHONEPE_AUTH_URL,
  PHONEPE_PG_URL: process.env.PHONEPE_PG_URL,
};

const validateEnv = () => {
  if (env.NODE_ENV !== 'test') {
    if (!env.MONGO_URI) {
      throw new Error('MONGO_URI is required in non-test environment');
    }
    if (!env.JWT_ACCESS_SECRET || !env.JWT_REFRESH_SECRET) {
      throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are required in non-test environment');
    }
  }
};

// Validate variables and throw if missing required ones
validateEnv();

export default env;
