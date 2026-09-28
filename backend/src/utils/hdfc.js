import crypto from 'crypto';

/**
 * HDFC SmartGateway (Juspay-powered) auth helpers.
 * https://smartgateway.hdfc.bank.in/docs/smartgateway-api-ref-basicauth/docs/apis/session
 */

/**
 * Generates the order_id sent to HDFC SmartGateway as `order_id`.
 * HDFC requires this value to be: under 21 characters, alphanumeric only
 * (no underscore/hyphen/other special characters), and non-sequential.
 *
 * Deliberately NOT timestamp-based (unlike the shared PayU `generateTxnId`)
 * so consecutive order IDs are not predictable/orderable. Built from
 * `crypto.randomUUID()` (CSPRNG-backed) truncated to 15 hex chars — ~60 bits
 * of entropy, which is collision-safe at any realistic order volume.
 */
export const generateHdfcOrderId = () => {
  const random = crypto.randomUUID().replace(/-/g, '').toUpperCase();
  return `TYV${random.slice(0, 15)}`;
};

/**
 * SmartGateway's "Basic Auth" scheme is standard HTTP Basic auth using the
 * dashboard API key as the username and an empty password:
 * Authorization: Basic base64(`${apiKey}:`)
 */
export const buildHdfcAuthHeader = (apiKey) => `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;

/**
 * Verifies the Basic-auth pair SmartGateway sends back on every S2S webhook
 * call against the username/password configured in the SmartGateway
 * Dashboard > Webhook Settings. Reject the webhook if they don't match.
 */
export const verifyHdfcWebhookAuth = (authorizationHeader, expectedUsername, expectedPassword) => {
  if (!expectedUsername) return false;
  if (!authorizationHeader || !authorizationHeader.startsWith('Basic ')) return false;

  try {
    const decoded = Buffer.from(authorizationHeader.slice(6), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) return false;

    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);
    return username === expectedUsername && password === (expectedPassword || '');
  } catch {
    return false;
  }
};
