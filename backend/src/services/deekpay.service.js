import env from '../config/env.js';
import logger from '../utils/logger.js';
import AppError from '../utils/AppError.js';
import {
  generateDeekpaySignature,
  verifyDeekpaySignature,
  toDeekpayCents,
  fromDeekpayCents,
  isDeekpayIpWhitelisted,
} from '../utils/deekpay.js';

class DeekpayService {
  constructor() {
    this.merchantId = env.DEEKPAY_MERCHANT_ID || '81';
    this.merchantAccount = env.DEEKPAY_MERCHANT_ACCOUNT || 'DKKA999';
    this.secretKey = env.DEEKPAY_MERCHANT_KEY;
    this.baseUrl = env.DEEKPAY_BASE_URL || 'https://deekpayapi.star2pay.net';
    this.orderCreatePath = env.DEEKPAY_ORDER_CREATE_PATH || '/v1.0/api/order/create';
    this.orderQueryPath = env.DEEKPAY_ORDER_QUERY_PATH || '/v1.0/api/order/query';
    this.collectionProductId = env.DEEKPAY_COLLECTION_PRODUCT_ID || '3021';
    this.disbursementProductId = env.DEEKPAY_DISBURSEMENT_PRODUCT_ID || '3020';
  }

  assertConfigured() {
    if (!this.merchantId || !this.secretKey) {
      throw new AppError('DeekPay (Star2Pay) is not fully configured in environment variables', 500);
    }
  }

  buildSignature(params) {
    return generateDeekpaySignature(params, this.secretKey);
  }

  verifySignature(payload) {
    return verifyDeekpaySignature(payload, this.secretKey);
  }

  isIpAllowed(clientIp) {
    return isDeekpayIpWhitelisted(clientIp, env.DEEKPAY_CALLBACK_IPS);
  }

  /**
   * Normalizes Star2Pay collection status codes:
   * 0: In payment -> pending
   * 1: Payment successful -> success
   * 2: Payment failed -> failed
   * 3: Timed out -> pending / timeout (can still complete late)
   * 10: Created -> pending
   * 11: Creation failed -> failed
   */
  normalizeCollectionStatus(statusCode) {
    const code = Number(statusCode);
    switch (code) {
      case 1:
        return 'success';
      case 2:
      case 11:
        return 'failed';
      case 0:
      case 3:
      case 10:
      default:
        return 'pending';
    }
  }

  /**
   * Collection: Create Order (/v1.0/api/order/create)
   * Returns { payUrl, payOrderId, retCode, ... }
   */
  async createCollectionOrder({
    mchOrderNo,
    amount,
    notifyUrl,
    returnUrl,
    clientIp = '0.0.0.0',
    subject = 'Toyovo India Order',
    body = 'Toyovo India Checkout',
    param1 = '',
    param2 = '',
    validateUserName = '',
  }) {
    this.assertConfigured();

    const amountInCents = toDeekpayCents(amount);

    const payload = {
      mchId: String(this.merchantId),
      productId: String(this.collectionProductId),
      mchOrderNo: String(mchOrderNo),
      amount: amountInCents,
      clientIp: clientIp || '0.0.0.0',
      notifyUrl,
      ...(returnUrl ? { returnUrl } : {}),
      ...(subject ? { subject } : {}),
      ...(body ? { body } : {}),
      ...(param1 ? { param1 } : {}),
      ...(param2 ? { param2 } : {}),
      ...(validateUserName ? { validateUserName } : {}),
    };

    payload.sign = this.buildSignature(payload);

    const endpoint = `${this.baseUrl}${this.orderCreatePath}`;
    logger.info('DeekPay initiate order request', {
      endpoint,
      mchOrderNo,
      amountInCents,
      productId: this.collectionProductId,
    });

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      logger.error('DeekPay order create network error', { message: error.message, mchOrderNo });
      throw new AppError('DeekPay gateway is temporarily unreachable', 503);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.retCode !== 'SUCCESS') {
      logger.error('DeekPay order creation failed', {
        status: response.status,
        data,
        mchOrderNo,
      });
      throw new AppError(data.retMsg || 'DeekPay order creation failed at payment gateway', 502);
    }

    if (!data.payUrl) {
      logger.error('DeekPay response missing payUrl', { data, mchOrderNo });
      throw new AppError('DeekPay gateway did not return a valid cashier payment URL', 502);
    }

    logger.info('DeekPay order created successfully', {
      mchOrderNo,
      payOrderId: data.payOrderId,
      hasPayUrl: Boolean(data.payUrl),
    });

    return {
      retCode: data.retCode,
      retMsg: data.retMsg,
      payOrderId: data.payOrderId,
      payUrl: data.payUrl,
      payParams: data.payParams,
      raw: data,
    };
  }

  /**
   * Collection: Query Order Status (/v1.0/api/order/query)
   * Server-to-server authoritative check
   */
  async queryCollectionOrder({ mchOrderNo }) {
    this.assertConfigured();

    const payload = {
      mchId: String(this.merchantId),
      mchOrderNo: String(mchOrderNo),
    };

    payload.sign = this.buildSignature(payload);

    const endpoint = `${this.baseUrl}${this.orderQueryPath}`;
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      logger.error('DeekPay order query network error', { message: error.message, mchOrderNo });
      throw new AppError('DeekPay gateway is temporarily unreachable', 503);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.retCode !== 'SUCCESS') {
      logger.error('DeekPay order query failed', {
        status: response.status,
        data,
        mchOrderNo,
      });
      throw new AppError(data.retMsg || 'DeekPay order query failed', 502);
    }

    const normalizedStatus = this.normalizeCollectionStatus(data.status);
    const amountInRupees = data.amount ? fromDeekpayCents(data.amount) : 0;
    const paidAmountInRupees = data.paidAmount ? fromDeekpayCents(data.paidAmount) : amountInRupees;

    logger.info('DeekPay order query result', {
      mchOrderNo,
      rawStatus: data.status,
      normalizedStatus,
      payOrderId: data.payOrderId,
      utr: data.utr,
      paidAmountInRupees,
    });

    return {
      retCode: data.retCode,
      retMsg: data.retMsg,
      mchId: data.mchId,
      productId: data.productId,
      payOrderId: data.payOrderId,
      mchOrderNo: data.mchOrderNo,
      rawStatus: data.status,
      status: normalizedStatus,
      amountCents: data.amount,
      amount: amountInRupees,
      paidAmountCents: data.paidAmount,
      paidAmount: paidAmountInRupees,
      utr: data.utr || '',
      paySuccessTime: data.paySuccessTime,
      raw: data,
    };
  }

  /**
   * Payment on Behalf (Disbursement / Payout): Create Order
   * Channel: 3020
   */
  async createDisbursementOrder({
    mchOrderNo,
    amount,
    userName,
    cardNumber,
    ifscCode = '',
    bankName = '',
    accountType = 'bank',
    notifyUrl,
    clientIp = '0.0.0.0',
    param1 = '',
    param2 = '',
  }) {
    this.assertConfigured();

    const amountInCents = toDeekpayCents(amount);

    const payload = {
      mchId: String(this.merchantId),
      productId: String(this.disbursementProductId),
      mchOrderNo: String(mchOrderNo),
      amount: amountInCents,
      clientIp: clientIp || '0.0.0.0',
      notifyUrl,
      userName: String(userName),
      cardNumber: String(cardNumber),
      ifscCode: String(ifscCode || ''),
      bankName: String(bankName || ''),
      accountType: accountType || 'bank',
      ...(param1 ? { param1 } : {}),
      ...(param2 ? { param2 } : {}),
    };

    payload.sign = this.buildSignature(payload);

    const endpoint = `${this.baseUrl}${this.orderCreatePath}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.retCode !== 'SUCCESS') {
      logger.error('DeekPay disbursement creation failed', { status: response.status, data });
      throw new AppError(data.retMsg || 'DeekPay disbursement failed', 502);
    }

    return data;
  }
}

export const deekpayService = new DeekpayService();
export default deekpayService;
