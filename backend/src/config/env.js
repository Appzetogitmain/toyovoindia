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
  'https://toyove-india-jhkr.vercel.app',
  'https://toyovoindia.com',
  'https://www.toyovoindia.com',
  'https://secure.payu.in',
  'https://test.payu.in',
  'https://api.phonepe.com',
  'https://api-preprod.phonepe.com',
  'https://uat.jiopay.co.in',
  'https://payments.airpay.co.in',
  'https://smartgateway.hdfcuat.bank.in',
  'https://smartgateway.hdfc.bank.in',
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
    // Matches any toyovo or toyove vercel deployment (production, preview, git branch)
    /^https:\/\/(toyovo|toyove)[a-z0-9-]*\.vercel\.app$/i,
    // Matches any *.toyovoindia.com domain
    /^https:\/\/(?:[a-zA-Z0-9-]+\.)*toyovoindia\.com$/i,
    // Matches dynamic VERCEL_PROJECT_SLUG if specified
    new RegExp(`^https://${escapeRegex(process.env.VERCEL_PROJECT_SLUG || 'toyove-india-jhkr')}.*\\.vercel\\.app$`, 'i'),
    // Matches localhost and 127.0.0.1 with any port (for development)
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
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
  JIOPAY_MERCHANT_ID: process.env.JIOPAY_MERCHANT_ID,
  JIOPAY_SECRET_KEY: process.env.JIOPAY_SECRET_KEY,
  JIOPAY_ENV: process.env.JIOPAY_ENV || 'uat',
  JIOPAY_BASE_URL: process.env.JIOPAY_BASE_URL || 'https://uat.jiopay.co.in',
  JIOPAY_INITIATE_SALE_PATH: process.env.JIOPAY_INITIATE_SALE_PATH || '/tsp/pg/api/v2/initiateSale',
  JIOPAY_COMMAND_PATH: process.env.JIOPAY_COMMAND_PATH || '/tsp/pg/api/command',
  JIOPAY_CURRENCY_CODE: process.env.JIOPAY_CURRENCY_CODE || '356',
  AIRPAY_MERCHANT_ID: process.env.AIRPAY_MERCHANT_ID,
  AIRPAY_CLIENT_ID: process.env.AIRPAY_CLIENT_ID,
  AIRPAY_SECRET_KEY: process.env.AIRPAY_SECRET_KEY,
  AIRPAY_USERNAME: process.env.AIRPAY_USERNAME,
  AIRPAY_PASSWORD: process.env.AIRPAY_PASSWORD,
  AIRPAY_API_KEY: process.env.AIRPAY_API_KEY,
  AIRPAY_BASE_URL: process.env.AIRPAY_BASE_URL || 'https://payments.airpay.co.in/pay/index.php',
  AIRPAY_VERIFY_URL: process.env.AIRPAY_VERIFY_URL || 'https://payments.airpay.co.in/order/verify.php',
  AIRPAY_CURRENCY_CODE: process.env.AIRPAY_CURRENCY_CODE || '356',
  DEEKPAY_MERCHANT_ID: process.env.DEEKPAY_MERCHANT_ID || '81',
  DEEKPAY_MERCHANT_ACCOUNT: process.env.DEEKPAY_MERCHANT_ACCOUNT || 'DKKA999',
  DEEKPAY_MERCHANT_KEY: process.env.DEEKPAY_MERCHANT_KEY,
  DEEKPAY_BASE_URL: process.env.DEEKPAY_BASE_URL || 'https://deekpayapi.star2pay.net',
  DEEKPAY_ORDER_CREATE_PATH: process.env.DEEKPAY_ORDER_CREATE_PATH || '/v1.0/api/order/create',
  DEEKPAY_ORDER_QUERY_PATH: process.env.DEEKPAY_ORDER_QUERY_PATH || '/v1.0/api/order/query',
  DEEKPAY_COLLECTION_PRODUCT_ID: process.env.DEEKPAY_COLLECTION_PRODUCT_ID || '3021',
  DEEKPAY_DISBURSEMENT_PRODUCT_ID: process.env.DEEKPAY_DISBURSEMENT_PRODUCT_ID || '3020',
  DEEKPAY_CALLBACK_IPS: process.env.DEEKPAY_CALLBACK_IPS || '13.127.130.180,3.108.117.248,3.108.167.137,3.6.5.154,13.127.187.82,13.232.167.96,43.213.141.71,43.213.57.217',
  // --- HDFC SmartGateway (Juspay-powered) ---
  // API key comes from the SmartGateway dashboard (Settings > API Keys), NOT the dashboard login password.
  HDFC_API_KEY: process.env.HDFC_API_KEY,
  HDFC_MERCHANT_ID: process.env.HDFC_MERCHANT_ID,
  HDFC_PAYMENT_PAGE_CLIENT_ID: process.env.HDFC_PAYMENT_PAGE_CLIENT_ID || 'hdfcmaster',
  HDFC_RESELLER_ID: process.env.HDFC_RESELLER_ID || 'hdfc_reseller',
  HDFC_ENV: process.env.HDFC_ENV || 'sandbox',
  HDFC_BASE_URL: process.env.HDFC_BASE_URL || 'https://smartgateway.hdfcuat.bank.in',
  HDFC_API_VERSION: process.env.HDFC_API_VERSION || '2023-06-30',
  HDFC_CURRENCY_CODE: process.env.HDFC_CURRENCY_CODE || 'INR',
  // Basic-auth pair configured in SmartGateway Dashboard > Webhook Settings; used to authenticate inbound S2S webhooks.
  HDFC_WEBHOOK_USERNAME: process.env.HDFC_WEBHOOK_USERNAME,
  HDFC_WEBHOOK_PASSWORD: process.env.HDFC_WEBHOOK_PASSWORD,
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
