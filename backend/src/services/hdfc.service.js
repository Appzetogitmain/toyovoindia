import env from '../config/env.js';
import logger from '../utils/logger.js';
import AppError from '../utils/AppError.js';
import { buildHdfcAuthHeader, verifyHdfcWebhookAuth } from '../utils/hdfc.js';

// Juspay/Hyperswitch order status codes (source of truth: Order Status API + webhook docs).
// https://smartgateway.hdfc.bank.in/docs/smartgateway-api-ref-basicauth/docs/apis/order-status-api
const SUCCESS_STATUSES = ['CHARGED'];
const PENDING_STATUSES = ['NEW', 'STARTED', 'PENDING_VBV', 'PENDING', 'AUTHORIZING', 'AUTHORIZED', 'CAPTURE_INITIATED'];
const CANCELLED_STATUSES = ['VOIDED', 'VOID_INITIATED', 'EXPIRED', 'CANCELLED', 'AUTO_REFUNDED'];
const FAILED_STATUSES = ['AUTHENTICATION_FAILED', 'AUTHORIZATION_FAILED', 'JUSPAY_DECLINED', 'DECLINED'];

class HdfcService {
  constructor() {
    this.apiKey = env.HDFC_API_KEY;
    this.merchantId = env.HDFC_MERCHANT_ID;
    this.resellerId = env.HDFC_RESELLER_ID;
    this.clientId = env.HDFC_PAYMENT_PAGE_CLIENT_ID;
    this.baseUrl = env.HDFC_BASE_URL;
    this.apiVersion = env.HDFC_API_VERSION;
    this.currency = env.HDFC_CURRENCY_CODE;
  }

  assertConfigured() {
    if (!this.apiKey || !this.merchantId) {
      throw new AppError('HDFC SmartGateway is not configured properly in .env', 500);
    }
  }

  buildHeaders(customerId) {
    return {
      'Content-Type': 'application/json',
      Authorization: buildHdfcAuthHeader(this.apiKey),
      'x-merchantid': this.merchantId,
      'x-customerid': String(customerId),
      'x-resellerid': this.resellerId,
      version: this.apiVersion,
    };
  }

  /**
   * Session API — creates the order at SmartGateway and returns a hosted
   * checkout payment_links.web URL to redirect the customer to.
   * https://smartgateway.hdfc.bank.in/docs/smartgateway-api-ref-basicauth/docs/apis/session
   */
  async createSession({ orderId, amount, customerId, customerEmail, customerPhone, firstName, lastName, returnUrl, description, currency }) {
    this.assertConfigured();

    const body = {
      order_id: orderId,
      amount: Number(amount).toFixed(2),
      customer_id: String(customerId),
      customer_email: customerEmail,
      customer_phone: customerPhone,
      payment_page_client_id: this.clientId,
      action: 'paymentPage',
      return_url: returnUrl,
      currency: currency || this.currency,
      ...(firstName ? { first_name: firstName } : {}),
      ...(lastName ? { last_name: lastName } : {}),
      ...(description ? { description } : {}),
    };

    let response;
    try {
      response = await fetch(`${this.baseUrl}/session`, {
        method: 'POST',
        headers: this.buildHeaders(customerId),
        body: JSON.stringify(body),
      });
    } catch (error) {
      logger.error('HDFC SmartGateway session create network error', { message: error.message });
      throw new AppError('HDFC SmartGateway is temporarily unavailable', 503);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data?.payment_links?.web) {
      logger.error('HDFC SmartGateway session create failed', { status: response.status, data });
      throw new AppError(data?.error_message || data?.message || 'Payment initiation failed at HDFC SmartGateway', 502);
    }

    return data;
  }

  /**
   * Order Status API — the sole source of truth for a transaction's outcome.
   * Both the return_url redirect and the S2S webhook are only ever treated as
   * triggers to call this; nothing from either is trusted directly.
   * https://smartgateway.hdfc.bank.in/docs/smartgateway-api-ref-basicauth/docs/apis/order-status-api
   */
  async getOrderStatus(orderId, customerId, retryCount = 0) {
    this.assertConfigured();

    let response;
    try {
      response = await fetch(`${this.baseUrl}/orders/${encodeURIComponent(orderId)}`, {
        method: 'GET',
        headers: this.buildHeaders(customerId),
      });
    } catch (error) {
      if (retryCount < 2) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
        return this.getOrderStatus(orderId, customerId, retryCount + 1);
      }
      logger.error('HDFC SmartGateway order status network error', { orderId, message: error.message });
      throw new AppError('HDFC SmartGateway is temporarily unavailable', 503);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      logger.error('HDFC SmartGateway order status failed', { orderId, status: response.status, data });
      throw new AppError(data?.error_message || data?.message || 'Failed to fetch order status from HDFC SmartGateway', 502);
    }

    return data;
  }

  // Alias kept so this service's call shape matches the other gateway services in this codebase.
  checkStatus(orderId, customerId) {
    return this.getOrderStatus(orderId, customerId);
  }

  /**
   * Normalizes a status/webhook payload's `status` field into one of:
   * success | pending | cancelled | failed.
   * An unrecognized status defaults to 'pending' rather than 'failed' —
   * safer to keep polling/retrying than to prematurely cancel a real order
   * over a status code this integration hasn't seen yet.
   */
  normalizeStatus(data) {
    const status = String(data?.status || '').toUpperCase().trim();
    if (!status) return 'pending';
    if (SUCCESS_STATUSES.includes(status)) return 'success';
    if (FAILED_STATUSES.includes(status)) return 'failed';
    if (CANCELLED_STATUSES.includes(status)) return 'cancelled';
    if (PENDING_STATUSES.includes(status)) return 'pending';
    return 'pending';
  }

  verifyWebhookAuth(authorizationHeader) {
    return verifyHdfcWebhookAuth(authorizationHeader, env.HDFC_WEBHOOK_USERNAME, env.HDFC_WEBHOOK_PASSWORD);
  }
}

export const hdfcService = new HdfcService();
