import env from '../config/env.js';
import logger from '../utils/logger.js';
import AppError from '../utils/AppError.js';
import { generateJiopaySecureHash, verifyJiopaySecureHash, formatJiopayTxnDate } from '../utils/jiopay.js';

// Exact codes confirmed against real JioPay UAT responses (Command/STATUS API):
//
// responseCode is the STATUS-lookup-level result. When JioPay has a definitive
// transaction record it reports responseCode "000"/"0000" ("Request processed
// successfully") and the REAL outcome lives in txnStatus/txnResponseCode. When
// there is nothing definitive yet, responseCode itself carries the state:
//   P0039 = "Transaction Not available in system"  (not reached JioPay yet)
//   P0030 = "Awaiting user action"                 (on payment page / OTP page,
//                                                    also what a closed browser
//                                                    or back-button tap reports)
//   P0020 = "cancelled by user"                     (clicked "back to cart")
//
// txnStatus / txnResponseCode (the definitive outcome once available):
//   SUC / 0000  = success
//   REJ / 039   = rejected
//   REQ / R1000 = requested but not completed (e.g. OTP page, not yet submitted)
const STATUS_LOOKUP_CODE_MAP = {
  P0039: 'pending',
  P0030: 'pending',
  P0020: 'cancelled',
};
const TXN_STATUS_MAP = {
  SUC: 'success',
  REJ: 'failed',
  REQ: 'pending',
};
// Fallback keyword matching for anything not covered by the exact codes above —
// keeps unrecognized values from silently defaulting away from 'pending'.
const SUCCESS_TOKENS = ['0000', 'SUC', 'SUCCESS', 'SUCCESSFUL'];
const PENDING_TOKENS = ['PEN', 'PENDING', 'INI', 'INITIATED', 'AWAIT', 'AUTHENTICATING', 'PROGRESS', 'REQ', 'R1000'];
const CANCELLED_TOKENS = ['CAN', 'CANCEL', 'ABORT', 'EXPIRED', 'TIMEOUT', 'TIMEDOUT', 'VOID'];
const REJECTED_TOKENS = ['REJ', 'REJECTED', 'DECLINE', 'FAIL', '039'];

class JiopayService {
  constructor() {
    this.merchantId = env.JIOPAY_MERCHANT_ID;
    this.secretKey = env.JIOPAY_SECRET_KEY;
    this.baseUrl = env.JIOPAY_BASE_URL;
    this.initiateSalePath = env.JIOPAY_INITIATE_SALE_PATH;
    this.commandPath = env.JIOPAY_COMMAND_PATH;
    this.currencyCode = env.JIOPAY_CURRENCY_CODE;
  }

  assertConfigured() {
    if (!this.merchantId || !this.secretKey) {
      throw new AppError('JioPay is not configured properly in .env', 500);
    }
  }

  buildHash(params) {
    return generateJiopaySecureHash(params, this.secretKey);
  }

  verifyResponseHash(payload) {
    return verifyJiopaySecureHash(payload, this.secretKey);
  }

  /**
   * Initiate Sale — creates the transaction at JioPay and returns the hosted
   * checkout redirect details. https://docs.jiopay.in/reference/initiatesale
   */
  async initiateSale({ merchantTxnNo, amount, returnURL, customerEmailID, customerName, customerMobileNo, invoiceNo, addlParam1 }) {
    this.assertConfigured();

    const params = {
      merchantId: this.merchantId,
      merchantTxnNo,
      amount: Number(amount).toFixed(2),
      currencyCode: this.currencyCode,
      payType: '0', // 0 = Standard / Hosted Checkout
      customerEmailID: customerEmailID || 'guest@jiopay.com',
      transactionType: 'SALE',
      returnURL,
      txnDate: formatJiopayTxnDate(),
      ...(customerName ? { customerName } : {}),
      ...(customerMobileNo ? { customerMobileNo } : {}),
      ...(invoiceNo ? { invoiceNo } : {}),
      ...(addlParam1 ? { addlParam1 } : {}),
    };

    const secureHash = this.buildHash(params);
    const body = { ...params, secureHash };

    let response;
    try {
      response = await fetch(`${this.baseUrl}${this.initiateSalePath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      logger.error('JioPay initiateSale network error', { message: error.message });
      throw new AppError('JioPay gateway is temporarily unavailable', 503);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.responseCode !== 'R1000') {
      logger.error('JioPay initiateSale failed', { status: response.status, data });
      throw new AppError(data.responseDescription || 'Payment initiation failed at JioPay', 502);
    }

    return data;
  }

  /**
   * STATUS / REFUND / AUTH / VOID — shared Command API.
   * https://docs.jiopay.in/reference/command
   *
   * Note: real UAT traffic shows `amount` is only sent for REFUND (and
   * presumably AUTH/VOID) — a STATUS call omits it entirely. Sending an
   * unexpected extra field would also throw off the secureHash, since the
   * hash covers every field actually present in the request.
   */
  async runCommand({ merchantTxnNo, originalTxnNo, amount, transactionType, aggregatorID }) {
    this.assertConfigured();

    const params = {
      merchantId: this.merchantId,
      merchantTxnNo,
      originalTxnNo,
      transactionType,
      ...(amount !== undefined ? { amount: Number(amount).toFixed(2) } : {}),
      ...(aggregatorID ? { aggregatorID } : {}),
    };
    const secureHash = this.buildHash(params);
    const body = new URLSearchParams({ ...params, secureHash });

    let response;
    try {
      response = await fetch(`${this.baseUrl}${this.commandPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (error) {
      logger.error(`JioPay command(${transactionType}) network error`, { message: error.message });
      throw new AppError('JioPay gateway is temporarily unavailable', 503);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      logger.error(`JioPay command(${transactionType}) failed`, { status: response.status, data });
      throw new AppError(data.respDescription || data.responseDescription || `JioPay ${transactionType} request failed`, 502);
    }

    return data;
  }

  async checkStatus(originalTxnNo, retryCount = 0) {
    try {
      // merchantTxnNo == originalTxnNo for a STATUS command; no `amount` field.
      return await this.runCommand({
        merchantTxnNo: originalTxnNo,
        originalTxnNo,
        transactionType: 'STATUS',
      });
    } catch (error) {
      if (retryCount < 2) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
        return this.checkStatus(originalTxnNo, retryCount + 1);
      }
      logger.error(`JioPay Status Check failed for ${originalTxnNo}: ${error.message}`);
      throw error;
    }
  }

  async refund({ originalTxnNo, amount }) {
    const merchantTxnNo = `RF${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 20);
    return this.runCommand({
      merchantTxnNo,
      originalTxnNo,
      amount,
      transactionType: 'REFUND',
    });
  }

  /**
   * Normalizes an S2S webhook payload's responseCode (the actual payment
   * outcome code, e.g. "0000") into one of: success | pending | cancelled | failed.
   */
  normalizeWebhookStatus(payload) {
    const code = String(payload?.responseCode ?? '').toUpperCase().trim();
    if (!code) return 'pending';
    if (STATUS_LOOKUP_CODE_MAP[code]) return STATUS_LOOKUP_CODE_MAP[code];
    if (code === '0000') return 'success';
    if (REJECTED_TOKENS.some((token) => code.includes(token))) return 'failed';
    if (CANCELLED_TOKENS.some((token) => code.includes(token))) return 'cancelled';
    if (PENDING_TOKENS.some((token) => code.includes(token))) return 'pending';
    return 'failed';
  }

  /**
   * Normalizes a Command/STATUS response into success | pending | cancelled | failed.
   *
   * `responseCode` is checked first: when JioPay has no definitive transaction
   * record yet, the real state (not-found / awaiting user / user-cancelled)
   * is reported there directly (P0039 / P0030 / P0020). Only once a definitive
   * outcome exists does responseCode become the generic "000"/"0000" wrapper,
   * at which point the real answer is txnStatus/txnResponseCode (SUC/0000,
   * REJ/039, REQ/R1000).
   */
  normalizeCommandStatus(data) {
    const responseCode = String(data?.responseCode ?? '').toUpperCase().trim();
    if (STATUS_LOOKUP_CODE_MAP[responseCode]) {
      return STATUS_LOOKUP_CODE_MAP[responseCode];
    }

    const txnStatus = String(data?.txnStatus ?? '').toUpperCase().trim();
    const txnResponseCode = String(data?.txnResponseCode ?? '').toUpperCase().trim();

    if (TXN_STATUS_MAP[txnStatus]) {
      return TXN_STATUS_MAP[txnStatus];
    }

    if (!txnStatus && !txnResponseCode) return 'pending';

    const combined = `${txnStatus} ${txnResponseCode}`;
    if (txnResponseCode === '0000' || SUCCESS_TOKENS.some((token) => combined.includes(token))) return 'success';
    if (REJECTED_TOKENS.some((token) => combined.includes(token))) return 'failed';
    if (CANCELLED_TOKENS.some((token) => combined.includes(token))) return 'cancelled';
    if (PENDING_TOKENS.some((token) => combined.includes(token))) return 'pending';
    return 'failed';
  }
}

export const jiopayService = new JiopayService();
