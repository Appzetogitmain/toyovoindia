import env from '../config/env.js';
import logger from '../utils/logger.js';
import AppError from '../utils/AppError.js';
import {
  sanitizeAirpayParam,
  sanitizeAirpayUrl,
  generateAirpayPrivateKey,
  generateAirpayKeySha256,
  generateAirpayChecksum,
  verifyAirpayResponseHash,
} from '../utils/airpay.js';

class AirpayService {
  constructor() {
    this.merchantId = env.AIRPAY_MERCHANT_ID;
    this.clientId = env.AIRPAY_CLIENT_ID;
    this.secretKey = env.AIRPAY_SECRET_KEY;
    this.username = env.AIRPAY_USERNAME;
    this.password = env.AIRPAY_PASSWORD;
    this.apiKey = env.AIRPAY_API_KEY;
    this.baseUrl = env.AIRPAY_BASE_URL;
    this.verifyUrl = env.AIRPAY_VERIFY_URL;
    this.currencyCode = env.AIRPAY_CURRENCY_CODE;
  }

  assertConfigured() {
    if (!this.merchantId || !this.username || !this.password || !this.apiKey) {
      throw new AppError('Airpay is not fully configured in environment variables', 500);
    }
  }

  /**
   * Prepares the parameters for Airpay's hosted checkout form submission
   */
  prepareHostedCheckoutData({
    orderNumber,
    txnid,
    amount,
    customer = {},
    shippingAddress = {},
    returnUrl,
  }) {
    this.assertConfigured();

    const formattedAmount = Number(amount).toFixed(2);
    const txnDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const buyerEmail = customer.email || 'customer@toyovo.com';
    const buyerFirstName = customer.firstName || 'Customer';
    const buyerLastName = customer.lastName || '';
    const buyerAddress = shippingAddress.address || shippingAddress.street || 'India';
    const buyerCity = shippingAddress.city || 'Delhi';
    const buyerState = shippingAddress.state || 'Delhi';
    const buyerCountry = shippingAddress.country || 'India';
    const buyerPincode = shippingAddress.postalCode || '110001';
    let buyerPhone = String(customer.phone || '9999999999').replace(/\D/g, '');
    if (buyerPhone.length === 12 && buyerPhone.startsWith('91')) {
      buyerPhone = buyerPhone.slice(2);
    }

    // Per Airpay official specification:
    // alldata = email + firstName + lastName + address + city + state + country + amount + orderid
    const alldata =
      sanitizeAirpayParam(buyerEmail) +
      sanitizeAirpayParam(buyerFirstName) +
      sanitizeAirpayParam(buyerLastName) +
      sanitizeAirpayParam(buyerAddress) +
      sanitizeAirpayParam(buyerCity) +
      sanitizeAirpayParam(buyerState) +
      sanitizeAirpayParam(buyerCountry) +
      sanitizeAirpayParam(formattedAmount) +
      txnid;

    const privatekey = generateAirpayPrivateKey(this.apiKey, this.username, this.password);
    const keySha256 = generateAirpayKeySha256(this.username, this.password);
    const checksum = generateAirpayChecksum(alldata, keySha256, txnDate);

    return {
      airpayBaseUrl: this.baseUrl,
      mercid: this.merchantId,
      orderid: txnid,
      orderNumber,
      buyerEmail: sanitizeAirpayParam(buyerEmail),
      buyerFirstName: sanitizeAirpayParam(buyerFirstName),
      buyerLastName: sanitizeAirpayParam(buyerLastName),
      buyerAddress: sanitizeAirpayParam(buyerAddress),
      buyerCity: sanitizeAirpayParam(buyerCity),
      buyerState: sanitizeAirpayParam(buyerState),
      buyerCountry: sanitizeAirpayParam(buyerCountry),
      buyerPincode: sanitizeAirpayParam(buyerPincode),
      buyerPhone: sanitizeAirpayParam(buyerPhone),
      txnType: '1',
      mode: '',
      currency: this.currencyCode,
      isocurrency: 'INR',
      amount: formattedAmount,
      chmod: '', // empty string displays all payment methods (UPI, Cards, Netbanking, Wallets)
      purpose: '1',
      productDescription: 'Toyovo Order',
      txnDate,
      checksum,
      privatekey,
      return_url: sanitizeAirpayUrl(returnUrl),
      returnUrl: sanitizeAirpayUrl(returnUrl),
      returnurl: sanitizeAirpayUrl(returnUrl),
      success_url: sanitizeAirpayUrl(returnUrl),
      merchant_txnId: txnid,
      customvar: orderNumber,
    };
  }

  /**
   * Verifies response CRC32 hash from browser return or webhook
   */
  verifyResponseHash(body) {
    this.assertConfigured();
    return verifyAirpayResponseHash(body, this.merchantId, this.username);
  }

  /**
   * Server-to-server transaction status inquiry using Airpay verify.php
   */
  async checkStatus(txnid) {
    this.assertConfigured();

    const today = new Date().toISOString().slice(0, 10);
    const privatekey = generateAirpayPrivateKey(this.apiKey, this.username, this.password);
    const keySha256 = generateAirpayKeySha256(this.username, this.password);
    // Formula verified against Airpay verify.php:
    // checksum = sha256(keySha256 + '@' + mercid + orderid + today)
    const checksum = generateAirpayChecksum(`${this.merchantId}${txnid}`, keySha256, today);

    let response;
    try {
      response = await fetch(this.verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          mercid: this.merchantId,
          orderid: txnid,
          merchant_txnId: txnid,
          privatekey,
          checksum,
        }),
      });
    } catch (error) {
      logger.error('Airpay checkStatus network error', { message: error.message, txnid });
      throw new AppError('Airpay gateway is temporarily unavailable', 503);
    }

    const xmlText = await response.text().catch(() => '');

    const extractTag = (tag) => {
      const match = xmlText.match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>`, 'i')) ||
                    xmlText.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`, 'i'));
      return match ? match[1].trim() : '';
    };

    const status = extractTag('TRANSACTIONSTATUS');
    const message = extractTag('MESSAGE');
    const apTransactionId = extractTag('APTRANSACTIONID');
    const amount = extractTag('AMOUNT');
    const paymentStatus = extractTag('TRANSACTIONPAYMENTSTATUS');
    const chmod = extractTag('CHMOD');

    logger.info('Airpay verify.php status lookup result', {
      txnid,
      status,
      message,
      apTransactionId,
      amount,
    });

    return {
      status,
      message,
      apTransactionId,
      amount,
      paymentStatus,
      chmod,
      rawXml: xmlText,
    };
  }
}

export const airpayService = new AirpayService();
//...