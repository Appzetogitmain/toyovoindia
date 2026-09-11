import Order from '../models/Order.js';
import User from '../models/User.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import { successResponse } from '../utils/apiResponse.js';
import { buildOrderDraftFromCheckout, applyFulfilledOrderSideEffects } from '../services/order.service.js';
import { sendOrderConfirmationEmail } from '../services/email.service.js';
import { generateTxnId, generatePayuHash, verifyPayuHash } from '../utils/payu.js';
import { notifyPaymentSuccess, notifyPaymentFailed, notifyRefundProcessed } from '../services/notification.service.js';
import { phonepeService } from '../services/phonepe.service.js';
import { jiopayService } from '../services/jiopay.service.js';
import { airpayService } from '../services/airpay.service.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';

export const createPayuOrder = asyncHandler(async (req, res) => {
  const draft = await buildOrderDraftFromCheckout(req.body);
  const txnid = generateTxnId();

  // PayU requires productinfo, firstname, email, phone
  const productinfo = 'Toyovo_Order';
  const firstname = req.body.customer.firstName || 'Customer';
  const phone = req.body.customer.phone || '9999999999';
  const email = req.body.customer.email || 'dummy@toyovo.com';

  const { hash, formattedAmount, safeEmail } = generatePayuHash({
    txnid,
    amount: draft.totalAmount,
    productinfo,
    firstname,
    email,
    phone
  });

  // Pre-create pending order in MongoDB
  const order = await Order.create({
    user: req.user?._id || null,
    customer: {
      ...req.body.customer,
      email: email.toLowerCase(),
    },
    shippingAddress: req.body.shippingAddress,
    items: draft.items,
    status: 'pending',
    paymentStatus: 'pending',
    paymentMethod: 'payu',
    shippingMethod: req.body.shippingMethod,
    subtotal: draft.subtotal,
    shippingAmount: draft.shippingAmount,
    discountAmount: draft.discountAmount,
    totalAmount: draft.totalAmount,
    coupon: draft.couponData,
    notes: req.body.notes || undefined,
    paymentGateway: {
      provider: 'payu',
      payuTxnId: txnid,
      payuHash: hash,
    },
  });

  logger.info('Pending PayU order pre-created in MongoDB', {
    orderNumber: order.orderNumber,
    payuTxnId: txnid,
  });

  // Return data needed for the frontend to construct the PayU form
  return successResponse(res, 201, 'PayU order initiated successfully', {
    key: env.PAYU_KEY,
    txnid,
    amount: formattedAmount,
    productinfo,
    firstname,
    email: safeEmail,
    phone,
    surl: `${env.SERVER_URL}/api/payments/payu/success`,
    furl: `${env.SERVER_URL}/api/payments/payu/failure`,
    hash,
    payuBaseUrl: env.PAYU_BASE_URL,
    orderNumber: order.orderNumber,
  });
});

export const createPhonepeOrder = asyncHandler(async (req, res, next) => {
  const draft = await buildOrderDraftFromCheckout(req.body);
  const txnid = generateTxnId(); // We can reuse the same unique generator

  // Pre-create pending order in MongoDB
  const order = await Order.create({
    user: req.user?._id || null,
    customer: {
      ...req.body.customer,
      email: (req.body.customer.email || 'dummy@toyovo.com').toLowerCase(),
    },
    shippingAddress: req.body.shippingAddress,
    items: draft.items,
    status: 'pending',
    paymentStatus: 'pending',
    paymentMethod: 'phonepe', // the frontend choice
    shippingMethod: req.body.shippingMethod,
    subtotal: draft.subtotal,
    shippingAmount: draft.shippingAmount,
    discountAmount: draft.discountAmount,
    totalAmount: draft.totalAmount,
    coupon: draft.couponData,
    notes: req.body.notes || undefined,
    paymentGateway: {
      provider: 'phonepe',
      phonepeTxnId: txnid,
    },
  });

  logger.info('Pending PhonePe order pre-created in MongoDB', {
    orderNumber: order.orderNumber,
    phonepeTxnId: txnid,
  });

  // V2 Payload
  const payload = {
    merchantOrderId: txnid,
    amount: Math.round(draft.totalAmount * 100),
    paymentFlow: {
      type: "PG_CHECKOUT",
      merchantUrls: {
        redirectUrl: `${env.CLIENT_URL}/payment/phonepe/callback?txnid=${txnid}`,
        callbackUrl: `${env.SERVER_URL}/api/payments/phonepe/webhook`
      }
    }
  };

  try {
    const token = await phonepeService.getAccessToken();
    const endpoint = '/checkout/v2/pay';

    const response = await fetch(`${phonepeService.pgBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `O-Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.error('PhonePe V2 PG API Error', { status: response.status, data: errorData });
      return next(new AppError('Payment initiation failed at gateway', 502));
    }

    const data = await response.json();
    
    if (data.redirectUrl) {
      // V2 responds directly with a redirectUrl at the root level, or inside data.redirectUrl
      return successResponse(res, 201, 'PhonePe order initiated successfully', {
        redirectUrl: data.redirectUrl || (data.data && data.data.redirectUrl),
        orderNumber: order.orderNumber,
        txnid
      });
    } else {
      logger.error('Unexpected PhonePe V2 PG Response format', data);
      return next(new AppError('Invalid response from payment gateway', 502));
    }
  } catch (error) {
    logger.error('Error reaching PhonePe V2 API:', error);
    return next(new AppError('Payment gateway is temporarily unavailable', 503));
  }
});

export const createJiopayOrder = asyncHandler(async (req, res, next) => {
  const draft = await buildOrderDraftFromCheckout(req.body);
  const txnid = generateTxnId();

  // Pre-create pending order in MongoDB
  const order = await Order.create({
    user: req.user?._id || null,
    customer: {
      ...req.body.customer,
      email: (req.body.customer.email || 'guest@jiopay.com').toLowerCase(),
    },
    shippingAddress: req.body.shippingAddress,
    items: draft.items,
    status: 'pending',
    paymentStatus: 'pending',
    paymentMethod: 'jiopay',
    shippingMethod: req.body.shippingMethod,
    subtotal: draft.subtotal,
    shippingAmount: draft.shippingAmount,
    discountAmount: draft.discountAmount,
    totalAmount: draft.totalAmount,
    coupon: draft.couponData,
    notes: req.body.notes || undefined,
    paymentGateway: {
      provider: 'jiopay',
      jiopayTxnId: txnid,
    },
  });

  logger.info('Pending JioPay order pre-created in MongoDB', {
    orderNumber: order.orderNumber,
    jiopayTxnId: txnid,
  });

  try {
    const data = await jiopayService.initiateSale({
      merchantTxnNo: txnid,
      amount: draft.totalAmount,
      returnURL: `${env.SERVER_URL}/api/payments/jiopay/return`,
      customerEmailID: order.customer.email,
      customerName: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
      customerMobileNo: order.customer.phone,
      invoiceNo: order.orderNumber,
      addlParam1: order._id.toString(),
    });

    logger.info('JioPay initiateSale succeeded', { orderNumber: order.orderNumber, jiopayTxnId: txnid });

    return successResponse(res, 201, 'JioPay order initiated successfully', {
      redirectURI: data.redirectURI,
      tranCtx: data.tranCtx,
      merchantId: jiopayService.merchantId,
      orderNumber: order.orderNumber,
      txnid,
    });
  } catch (error) {
    logger.error('JioPay initiateSale error', { orderNumber: order.orderNumber, message: error.message });

    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    order.statusHistory.push({
      status: 'cancelled',
      note: `JioPay initiation failed: ${error.message}`,
      actorRole: 'system',
      createdAt: new Date(),
    });
    await order.save();

    return next(error instanceof AppError ? error : new AppError('Payment gateway is temporarily unavailable', 503));
  }
});

export const handlePayuSuccess = asyncHandler(async (req, res, next) => {
  logger.info('PayU success callback received', req.body);
  
  const isValid = verifyPayuHash(req.body);
  
  if (!isValid) {
    logger.error('PayU hash verification failed in success callback', { txnid: req.body.txnid });
    return res.redirect(`${env.CLIENT_URL}/checkout?error=HashMismatch`);
  }

  if (req.body.status !== 'success') {
    logger.error('PayU status is not success in success callback', { status: req.body.status });
    return res.redirect(`${env.CLIENT_URL}/checkout?error=PaymentFailed`);
  }

  const order = await Order.findOne({ 'paymentGateway.payuTxnId': req.body.txnid });
  
  if (!order) {
    logger.error('Associated pending order not found for PayU success verification', { txnid: req.body.txnid });
    return res.redirect(`${env.CLIENT_URL}/checkout?error=OrderNotFound`);
  }

  if (order.paymentStatus === 'paid') {
    // Already processed (could happen with webhook duplicate)
    return res.redirect(`${env.CLIENT_URL}/order-success?orderNumber=${order.orderNumber}`);
  }

  // Build draft to get resolved items for side effects
  const checkoutData = {
    customer: order.customer,
    shippingAddress: order.shippingAddress,
    items: order.items.map(item => ({ productId: item.product, quantity: item.quantity })),
    shippingMethod: order.shippingMethod,
    couponCode: order.coupon?.code || ''
  };
  const draft = await buildOrderDraftFromCheckout(checkoutData);

  // Update order
  order.status = 'processing';
  order.paymentStatus = 'paid';
  order.paymentGateway.payuMihpayid = req.body.mihpayid;
  order.paymentGateway.rawResponse = req.body;
  order.paymentGateway.verifiedAt = new Date();

  order.statusHistory.push({
    status: 'processing',
    note: 'Payment verified via PayU callback.',
    actorRole: 'system',
    createdAt: new Date(),
  });

  await applyFulfilledOrderSideEffects({
    resolvedItems: draft.resolvedItems,
    couponData: draft.couponData,
  });

  await order.save();

  Promise.resolve(notifyPaymentSuccess(order)).catch(() => {});

  logger.info('PayU payment success verification completed', { orderNumber: order.orderNumber, txnid: req.body.txnid });

  return res.redirect(`${env.CLIENT_URL}/order-success?orderNumber=${order.orderNumber}`);
});

export const handlePayuFailure = asyncHandler(async (req, res, next) => {
  logger.info('PayU failure callback received', req.body);
  
  // Even in failure, we can optionally verify the hash to ensure it's from PayU
  const isValid = verifyPayuHash(req.body);
  if (!isValid) {
    logger.warn('Invalid hash on PayU failure callback', { txnid: req.body.txnid });
  }

  const order = await Order.findOne({ 'paymentGateway.payuTxnId': req.body.txnid });
  
  if (order && order.paymentStatus !== 'paid') {
    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    order.paymentGateway.payuMihpayid = req.body.mihpayid;
    order.paymentGateway.rawResponse = req.body;

    order.statusHistory.push({
      status: 'cancelled',
      note: 'Payment failed or cancelled on PayU gateway.',
      actorRole: 'system',
      createdAt: new Date(),
    });

    await order.save();
    Promise.resolve(notifyPaymentFailed(order)).catch(() => {});
  }

  return res.redirect(`${env.CLIENT_URL}/checkout?error=${req.body.error_Message || 'PaymentCancelled'}`);
});

// Helper function to process a successful payment cleanly for any gateway
const processSuccessfulPayment = async (order, gatewayResponse) => {
  order.status = 'processing';
  order.paymentStatus = 'paid';
  order.paymentGateway.verifiedAt = new Date();
  order.paymentGateway.rawResponse = gatewayResponse;

  order.statusHistory.push({
    status: 'processing',
    note: `Payment verified successfully via ${order.paymentMethod.toUpperCase()}.`,
    actorRole: 'system',
    createdAt: new Date(),
  });

  const checkoutData = {
    customer: order.customer,
    shippingAddress: order.shippingAddress,
    items: order.items.map(item => ({ productId: item.product, quantity: item.quantity })),
    shippingMethod: order.shippingMethod,
    couponCode: order.coupon?.code || ''
  };
  const draft = await buildOrderDraftFromCheckout(checkoutData);

  await applyFulfilledOrderSideEffects({
    resolvedItems: draft.resolvedItems,
    couponData: draft.couponData,
  });

  await order.save();

  // Atomically clear the cart for logged-in users after verified purchase
  if (order.user) {
    await User.updateOne(
      { _id: order.user },
      { $set: { 'preferences.cart': [] } }
    );
  }

  Promise.resolve(notifyPaymentSuccess(order)).catch(() => {});
  Promise.resolve(sendOrderConfirmationEmail(order)).catch(() => {});
};

export const handlePhonepeWebhook = asyncHandler(async (req, res) => {
  // Webhook is just an EVENT TRIGGER in V2. We do NOT trust the payload.
  // We use the merchantOrderId from the webhook to query the V2 Status API securely.
  
  // V2 webhooks usually send data directly in body or decoded JSON, not base64.
  // We will extract merchantOrderId either from base64 (if hybrid) or direct JSON.
  let txnid;
  try {
    if (req.body.response) {
      const decoded = JSON.parse(Buffer.from(req.body.response, 'base64').toString('utf-8'));
      txnid = decoded.data?.merchantTransactionId || decoded.merchantOrderId;
    } else {
      txnid = req.body.merchantOrderId || req.body.transactionId;
    }
  } catch (e) {
    logger.error('Failed to parse PhonePe webhook payload');
    return res.status(400).send('Bad Request');
  }

  if (!txnid) {
    logger.error('No transaction ID found in webhook payload');
    return res.status(400).send('Bad Request');
  }

  // 1. Initial Idempotency Check
  const order = await Order.findOne({ 'paymentGateway.phonepeTxnId': txnid });
  if (!order) {
    logger.error(`Webhook Order Not Found for TxnId: ${txnid}`);
    return res.status(404).send('Order Not Found');
  }

  if (order.paymentStatus === 'paid' || order.paymentStatus === 'failed') {
    logger.info(`Idempotent return: Webhook already processed for TxnId: ${txnid}. Status: ${order.paymentStatus}`);
    return res.status(200).send('Already Processed');
  }

  // 2. Server-to-Server Verification (Single Source of Truth)
  try {
    const statusData = await phonepeService.checkPaymentStatus(txnid);

    // Update Raw Response for Logging
    order.paymentGateway.rawResponse = statusData;

    // 3. Status handling based on V2 API response (state usually SUCCESS or FAILED)
    if (statusData.state === 'COMPLETED' || statusData.state === 'SUCCESS') {
      const webhookAmountInRupees = statusData.amount / 100;
      
      // Amount Validation (Hack Prevention)
      if (Math.abs(webhookAmountInRupees - order.totalAmount) > 0.01) {
        logger.error(`Amount mismatch in Webhook Status Check! DB: ${order.totalAmount}, Webhook: ${webhookAmountInRupees}`);
        order.paymentStatus = 'failed';
        order.status = 'cancelled';
        order.notes = (order.notes ? order.notes + '\n' : '') + `SECURITY ALERT: Amount mismatch. PhonePe charged ₹${webhookAmountInRupees}`;
        await order.save();
        return res.status(200).send('Amount Mismatch Handled');
      }

      await processSuccessfulPayment(order, statusData);
      logger.info(`PhonePe Webhook Success Processed securely via Status API for Order: ${order.orderNumber}`);
      
    } else if (statusData.state === 'FAILED') {
      order.paymentStatus = 'failed';
      order.status = 'cancelled';
      order.statusHistory.push({
        status: 'cancelled',
        note: `PhonePe Payment Failed: ${statusData.responseCode || 'UNKNOWN_ERROR'}`,
        actorRole: 'system',
        createdAt: new Date(),
      });
      await order.save();
      Promise.resolve(notifyPaymentFailed(order)).catch(() => {});
      logger.info(`PhonePe Webhook Failure Processed for Order: ${order.orderNumber}`);
    } else {
      logger.info(`Webhook event ignored: Payment state is ${statusData.state}`);
    }

    return res.status(200).send('OK');
  } catch (error) {
    logger.error('Failed to verify status from PhonePe during webhook handling', error);
    // Return 500 so PhonePe retries the webhook later
    return res.status(500).send('Status Verification Failed');
  }
});

export const checkPhonepeStatus = asyncHandler(async (req, res, next) => {
  const { txnid } = req.params;
  
  const order = await Order.findOne({ 'paymentGateway.phonepeTxnId': txnid });
  if (!order) return next(new AppError('Order not found', 404));

  if (order.paymentStatus === 'paid') {
    return successResponse(res, 200, 'Payment already marked as successful', { status: 'success', orderNumber: order.orderNumber });
  }

  try {
    const statusData = await phonepeService.checkPaymentStatus(txnid);

    if (statusData.state === 'COMPLETED' || statusData.state === 'SUCCESS') {
      const webhookAmountInRupees = statusData.amount / 100;
      if (Math.abs(webhookAmountInRupees - order.totalAmount) <= 0.01) {
        await processSuccessfulPayment(order, statusData);
      }
      return successResponse(res, 200, 'Payment synced successfully', { status: 'success', orderNumber: order.orderNumber });
    }

    if (statusData.state === 'PENDING') {
      return successResponse(res, 200, 'Payment is still pending at gateway', { status: 'pending', orderNumber: order.orderNumber });
    }

    // Otherwise it failed
    if (order.paymentStatus !== 'failed') {
      order.paymentStatus = 'failed';
      order.status = 'cancelled';
      await order.save();
      Promise.resolve(notifyPaymentFailed(order)).catch(() => {});
    }
    return successResponse(res, 200, 'Payment failed', { status: 'failed', orderNumber: order.orderNumber });

  } catch (error) {
    return next(new AppError('Failed to check status with PhonePe V2', 500));
  }
});

// B2B Return URL: the customer's browser lands here after the JioPay hosted checkout.
// This is UX-only — we never trust it for state changes, we just forward the browser
// to a client page that asks OUR status endpoint (backed by the Command/STATUS API)
// for the authoritative result.
export const handleJiopayReturn = asyncHandler(async (req, res) => {
  // JioPay's own sample shows the fields nested under a "responseParams" wrapper;
  // stay tolerant of both that shape and a flat body/query.
  const body = req.body || {};
  const source = { ...(req.query || {}), ...body, ...(body.responseParams || {}) };
  const txnid = source.merchantTxnNo;

  logger.info('JioPay B2B return received', { txnid, method: req.method });

  if (!txnid) {
    return res.redirect(`${env.CLIENT_URL}/checkout?error=MissingTransactionId`);
  }

  return res.redirect(`${env.CLIENT_URL}/payment/jiopay/callback?txnid=${encodeURIComponent(txnid)}`);
});

// S2S Webhook: an event trigger only. We verify the secureHash for authenticity,
// then re-verify the real outcome via the Command STATUS API (source of truth) —
// exactly like the PhonePe webhook above — before ever mutating the order.
export const handleJiopayWebhook = asyncHandler(async (req, res) => {
  const payload = req.body || {};
  const txnid = payload.merchantTxnNo;

  if (!txnid) {
    logger.error('JioPay webhook missing merchantTxnNo');
    return res.status(400).send('Bad Request');
  }

  if (!jiopayService.verifyResponseHash(payload)) {
    logger.error('JioPay webhook secureHash verification failed', { txnid });
    return res.status(400).send('Invalid Hash');
  }

  const order = await Order.findOne({ 'paymentGateway.jiopayTxnId': txnid });
  if (!order) {
    logger.error(`JioPay webhook: order not found for txnid ${txnid}`);
    return res.status(404).send('Order Not Found');
  }

  if (order.paymentStatus === 'paid' || order.paymentStatus === 'failed') {
    logger.info(`Idempotent return: JioPay webhook already processed for TxnId: ${txnid}. Status: ${order.paymentStatus}`);
    return res.status(200).send('Already Processed');
  }

  try {
    const statusData = await jiopayService.checkStatus(txnid);
    const normalized = jiopayService.normalizeCommandStatus(statusData);
    logger.info('JioPay webhook status verification result', { txnid, normalized, statusData });

    if (normalized === 'success') {
      const webhookAmount = Number(payload.amount);

      if (Number.isFinite(webhookAmount) && Math.abs(webhookAmount - order.totalAmount) > 0.01) {
        logger.error(`Amount mismatch in JioPay Webhook! DB: ${order.totalAmount}, Webhook: ${webhookAmount}`);
        await Order.findOneAndUpdate(
          { _id: order._id, paymentStatus: 'pending' },
          {
            $set: {
              paymentStatus: 'failed',
              status: 'cancelled',
              notes: `${order.notes ? order.notes + '\n' : ''}SECURITY ALERT: Amount mismatch. JioPay reported ₹${webhookAmount}`,
            },
          }
        );
        return res.status(200).send('Amount Mismatch Handled');
      }

      // Atomically claim the transition so a concurrent status-check/webhook retry can't double-process.
      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, paymentStatus: 'pending' },
        { $set: { paymentStatus: 'paid' } }
      );
      if (!claimed) {
        logger.info(`Idempotent: JioPay order already claimed for TxnId: ${txnid}`);
        return res.status(200).send('Already Processed');
      }

      order.paymentGateway.jiopayPaymentId = statusData.txnId || payload.txnID || payload.paymentID || order.paymentGateway.jiopayPaymentId;
      await processSuccessfulPayment(order, { webhook: payload, status: statusData });
      logger.info(`JioPay Webhook Success Processed securely via Command STATUS API for Order: ${order.orderNumber}`);
    } else if (normalized === 'cancelled' || normalized === 'failed') {
      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, paymentStatus: 'pending' },
        { $set: { paymentStatus: 'failed', status: 'cancelled' } }
      );
      if (claimed) {
        order.paymentStatus = 'failed';
        order.status = 'cancelled';
        order.paymentGateway.rawResponse = { webhook: payload, status: statusData };
        order.statusHistory.push({
          status: 'cancelled',
          note: `JioPay Payment ${normalized === 'cancelled' ? 'Cancelled' : 'Rejected'}: ${statusData.txnResponseCode || payload.responseCode || 'UNKNOWN_ERROR'}`,
          actorRole: 'system',
          createdAt: new Date(),
        });
        await order.save();
        Promise.resolve(notifyPaymentFailed(order)).catch(() => {});
        logger.info(`JioPay Webhook ${normalized} Processed for Order: ${order.orderNumber}`);
      }
    } else {
      logger.info(`JioPay webhook event ignored: payment state is still ${normalized} for ${txnid}`);
    }

    return res.status(200).send('OK');
  } catch (error) {
    logger.error('Failed to verify status from JioPay during webhook handling', { txnid, message: error.message });
    // Return 500 so JioPay retries the webhook later
    return res.status(500).send('Status Verification Failed');
  }
});

export const checkJiopayStatus = asyncHandler(async (req, res, next) => {
  const { txnid } = req.params;

  const order = await Order.findOne({ 'paymentGateway.jiopayTxnId': txnid });
  if (!order) return next(new AppError('Order not found', 404));

  if (order.paymentStatus === 'paid') {
    return successResponse(res, 200, 'Payment already marked as successful', { status: 'success', orderNumber: order.orderNumber });
  }
  if (order.paymentStatus === 'failed') {
    return successResponse(res, 200, 'Payment already marked as failed', { status: 'failed', orderNumber: order.orderNumber });
  }

  try {
    const statusData = await jiopayService.checkStatus(txnid);
    const normalized = jiopayService.normalizeCommandStatus(statusData);
    logger.info('JioPay manual status check', { txnid, normalized, statusData });

    if (normalized === 'success') {
      const statusAmount = Number(statusData.amount);

      if (Number.isFinite(statusAmount) && Math.abs(statusAmount - order.totalAmount) > 0.01) {
        logger.error(`Amount mismatch in JioPay Status Check! DB: ${order.totalAmount}, JioPay: ${statusAmount}`);
        await Order.findOneAndUpdate(
          { _id: order._id, paymentStatus: 'pending' },
          {
            $set: {
              paymentStatus: 'failed',
              status: 'cancelled',
              notes: `${order.notes ? order.notes + '\n' : ''}SECURITY ALERT: Amount mismatch. JioPay reported ₹${statusAmount}`,
            },
          }
        );
        return successResponse(res, 200, 'Payment failed', { status: 'failed', orderNumber: order.orderNumber });
      }

      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, paymentStatus: 'pending' },
        { $set: { paymentStatus: 'paid' } }
      );
      if (claimed) {
        order.paymentGateway.jiopayPaymentId = statusData.txnId || order.paymentGateway.jiopayPaymentId;
        await processSuccessfulPayment(order, { status: statusData });
      }
      return successResponse(res, 200, 'Payment synced successfully', { status: 'success', orderNumber: order.orderNumber });
    }

    if (normalized === 'pending') {
      return successResponse(res, 200, 'Payment is still pending at gateway', { status: 'pending', orderNumber: order.orderNumber });
    }

    // cancelled or failed
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, paymentStatus: 'pending' },
      { $set: { paymentStatus: 'failed', status: 'cancelled' } }
    );
    if (claimed) {
      Promise.resolve(notifyPaymentFailed(order)).catch(() => {});
    }
    return successResponse(res, 200, 'Payment failed', { status: 'failed', orderNumber: order.orderNumber });

  } catch (error) {
    return next(new AppError('Failed to check status with JioPay', 500));
  }
});

// --- AIRPAY INTEGRATION ---

export const createAirpayOrder = asyncHandler(async (req, res, next) => {
  const draft = await buildOrderDraftFromCheckout(req.body);
  const txnid = generateTxnId();

  const customerEmail = (req.body.customer.email || 'customer@toyovo.com').toLowerCase();

  // Pre-create pending order in MongoDB
  const order = await Order.create({
    user: req.user?._id || null,
    customer: {
      ...req.body.customer,
      email: customerEmail,
    },
    shippingAddress: req.body.shippingAddress,
    items: draft.items,
    status: 'pending',
    paymentStatus: 'pending',
    paymentMethod: 'airpay',
    shippingMethod: req.body.shippingMethod,
    subtotal: draft.subtotal,
    shippingAmount: draft.shippingAmount,
    discountAmount: draft.discountAmount,
    totalAmount: draft.totalAmount,
    coupon: draft.couponData,
    notes: req.body.notes || undefined,
    paymentGateway: {
      provider: 'airpay',
      airpayTxnId: txnid,
    },
  });

  logger.info('Pending Airpay order pre-created in MongoDB', {
    orderNumber: order.orderNumber,
    airpayTxnId: txnid,
  });

  try {
    const returnUrl = `${env.CLIENT_URL}/api/payments/airpay/response`;
    const formData = airpayService.prepareHostedCheckoutData({
      orderNumber: order.orderNumber,
      txnid,
      amount: draft.totalAmount,
      customer: order.customer,
      shippingAddress: order.shippingAddress,
      returnUrl,
    });

    return successResponse(res, 201, 'Airpay order initiated successfully', formData);
  } catch (error) {
    logger.error('Airpay initiate error', { orderNumber: order.orderNumber, message: error.message });

    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    order.statusHistory.push({
      status: 'cancelled',
      note: `Airpay initiation failed: ${error.message}`,
      actorRole: 'system',
      createdAt: new Date(),
    });
    await order.save();

    return next(error instanceof AppError ? error : new AppError('Payment gateway is temporarily unavailable', 503));
  }
});

export const handleAirpayResponse = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const query = req.query || {};
  const source = { ...query, ...body };

  const txnid = source.TRANSACTIONID || source.transactionId || source.orderid || source.ORDERID || source.merchant_txnId || source.orderNumber;
  const apTransactionId = source.APTRANSACTIONID || source.apTransactionId || source.aptxnid;
  const status = source.TRANSACTIONSTATUS || source.transactionStatus || source.status;
  const message = source.MESSAGE || source.message;
  const rawAmount = source.AMOUNT || source.amount;

  logger.info('Airpay return callback received', { txnid, apTransactionId, status, message, rawAmount, method: req.method });

  const renderAirpayResponse = (targetUrl, isSuccess = true, orderNumber = '') => {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(200).json({
        success: isSuccess,
        redirectUrl: targetUrl,
        orderNumber,
        status: isSuccess ? 'success' : 'failed',
      });
    }

    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="refresh" content="0;url=${targetUrl}">
        <title>Payment Status - Toyovo India</title>
        <script type="text/javascript">
          window.location.replace("${targetUrl}");
        </script>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #FAFAFA; color: #333; }
          .card { text-align: center; padding: 2.5rem; background: white; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); max-width: 420px; width: 90%; }
          .spinner { width: 44px; height: 44px; border: 4px solid #E5E7EB; border-top-color: #005BD1; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 1.5rem; }
          @keyframes spin { to { transform: rotate(360deg); } }
          h2 { margin: 0 0 0.5rem; font-size: 1.25rem; font-weight: 700; color: #111827; }
          p { margin: 0 0 1.25rem; font-size: 0.95rem; color: #6B7280; }
          a { color: #005BD1; text-decoration: none; font-weight: 600; font-size: 0.9rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="spinner"></div>
          <h2>${isSuccess ? 'Payment Confirmed' : 'Payment Status'}</h2>
          <p>${isSuccess ? 'Redirecting you to your order confirmation...' : 'Processing your payment status...'}</p>
          <a href="${targetUrl}">Click here if you are not redirected automatically</a>
        </div>
      </body>
      </html>
    `);
  };

  if (!txnid) {
    return renderAirpayResponse(`${env.CLIENT_URL}/checkout?error=MissingTransactionId`, false);
  }

  const order = await Order.findOne({
    $or: [
      { 'paymentGateway.airpayTxnId': txnid },
      { orderNumber: txnid }
    ]
  });
  if (!order) {
    logger.error(`Airpay return: Order not found for txnid ${txnid}`);
    return renderAirpayResponse(`${env.CLIENT_URL}/checkout?error=OrderNotFound`, false);
  }

  if (order.paymentStatus === 'paid') {
    return renderAirpayResponse(`${env.CLIENT_URL}/order-success?orderNumber=${order.orderNumber}`, true, order.orderNumber);
  }

  // Authoritatively verify with Airpay verify.php API
  const airpayTxnId = order.paymentGateway?.airpayTxnId || txnid;
  let statusData = null;
  try {
    statusData = await airpayService.checkStatus(airpayTxnId);
    logger.info('Airpay return callback checkStatus result', { airpayTxnId, statusData });
  } catch (err) {
    logger.warn('Airpay verify.php call failed in return handler, falling back to body params', { error: err.message });
  }

  const isSuccess = (statusData && String(statusData.status) === '200') || String(status) === '200';
  const effectiveAmount = statusData?.amount ? Number(statusData.amount) : Number(rawAmount);

  if (isSuccess) {
    if (Number.isFinite(effectiveAmount) && Math.abs(effectiveAmount - order.totalAmount) > 0.05) {
      logger.error('Amount mismatch in Airpay Response!', { expected: order.totalAmount, received: effectiveAmount });
      order.paymentStatus = 'failed';
      order.status = 'cancelled';
      order.notes = `${order.notes ? order.notes + '\n' : ''}SECURITY ALERT: Amount mismatch. Airpay charged ₹${effectiveAmount}`;
      await order.save();
      return renderAirpayResponse(`${env.CLIENT_URL}/checkout?error=AmountMismatch`, false, order.orderNumber);
    }

    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, paymentStatus: 'pending' },
      { $set: { paymentStatus: 'paid' } }
    );
    if (claimed || order.paymentStatus === 'paid') {
      order.paymentGateway.airpayPaymentId = statusData?.apTransactionId || apTransactionId || order.paymentGateway.airpayPaymentId;
      await processSuccessfulPayment(order, statusData?.rawXml ? statusData : source);
      logger.info('Airpay payment verified successfully for order', { orderNumber: order.orderNumber, txnid });
    }

    return renderAirpayResponse(`${env.CLIENT_URL}/order-success?orderNumber=${order.orderNumber}`, true, order.orderNumber);
  }

  // If not confirmed yet, forward user to frontend callback page so it can poll and recover cleanly
  return renderAirpayResponse(`${env.CLIENT_URL}/payment/airpay/callback?txnid=${encodeURIComponent(airpayTxnId)}`, false, order.orderNumber);
});

export const handleAirpayWebhook = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const query = req.query || {};
  const source = { ...query, ...body };

  const txnid = source.TRANSACTIONID || source.transactionId || source.orderid || source.ORDERID || source.merchant_txnId || source.orderNumber;
  const apTransactionId = source.APTRANSACTIONID || source.apTransactionId || source.aptxnid;
  const status = source.TRANSACTIONSTATUS || source.transactionStatus || source.status;
  const message = source.MESSAGE || source.message;
  const rawAmount = source.AMOUNT || source.amount;

  logger.info('Airpay S2S webhook received', { txnid, apTransactionId, status, rawAmount });

  if (!txnid) {
    return res.status(400).send('Missing TRANSACTIONID');
  }

  const order = await Order.findOne({
    $or: [
      { 'paymentGateway.airpayTxnId': txnid },
      { orderNumber: txnid }
    ]
  });
  if (!order) {
    return res.status(404).send('Order Not Found');
  }

  if (order.paymentStatus === 'paid') {
    return res.status(200).send('Already Processed');
  }

  const airpayTxnId = order.paymentGateway?.airpayTxnId || txnid;
  let statusData = null;
  try {
    statusData = await airpayService.checkStatus(airpayTxnId);
  } catch (err) {
    logger.warn('Airpay verify.php call failed in webhook', { error: err.message });
  }

  const isSuccess = (statusData && String(statusData.status) === '200') || String(status) === '200';
  const effectiveAmount = statusData?.amount ? Number(statusData.amount) : Number(rawAmount);

  if (isSuccess) {
    if (Number.isFinite(effectiveAmount) && Math.abs(effectiveAmount - order.totalAmount) > 0.05) {
      logger.error('Amount mismatch in Airpay Webhook!', { expected: order.totalAmount, received: effectiveAmount });
      order.paymentStatus = 'failed';
      order.status = 'cancelled';
      await order.save();
      return res.status(200).send('Amount Mismatch Handled');
    }

    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, paymentStatus: 'pending' },
      { $set: { paymentStatus: 'paid' } }
    );
    if (claimed) {
      order.paymentGateway.airpayPaymentId = statusData?.apTransactionId || apTransactionId || order.paymentGateway.airpayPaymentId;
      await processSuccessfulPayment(order, statusData?.rawXml ? statusData : source);
    }
    return res.status(200).send('OK');
  }

  return res.status(200).send('OK');
});

export const checkAirpayStatus = asyncHandler(async (req, res, next) => {
  const { txnid } = req.params;

  const order = await Order.findOne({
    $or: [
      { 'paymentGateway.airpayTxnId': txnid },
      { orderNumber: txnid },
      { 'paymentGateway.airpayPaymentId': txnid },
    ]
  });
  if (!order) return next(new AppError('Order not found', 404));

  if (order.paymentStatus === 'paid') {
    return successResponse(res, 200, 'Payment already marked as successful', {
      status: 'success',
      orderNumber: order.orderNumber,
      paymentStatus: 'paid'
    });
  }

  const airpayTxnId = order.paymentGateway?.airpayTxnId || txnid;

  try {
    const statusData = await airpayService.checkStatus(airpayTxnId);
    logger.info('Airpay checkStatus response', { txnid, airpayTxnId, statusData });

    // Status 200 means success at Airpay verify.php
    if (String(statusData.status) === '200') {
      const paidAmount = Number(statusData.amount);
      if (Number.isFinite(paidAmount) && Math.abs(paidAmount - order.totalAmount) <= 0.05) {
        const claimed = await Order.findOneAndUpdate(
          { _id: order._id, paymentStatus: 'pending' },
          { $set: { paymentStatus: 'paid' } }
        );
        if (claimed) {
          order.paymentGateway.airpayPaymentId = statusData.apTransactionId || order.paymentGateway.airpayPaymentId;
          await processSuccessfulPayment(order, statusData);
        }
        return successResponse(res, 200, 'Payment synced successfully', {
          status: 'success',
          orderNumber: order.orderNumber,
          paymentStatus: 'paid'
        });
      }
    }

    if (String(statusData.status) === '211' || !statusData.status) {
      return successResponse(res, 200, 'Payment is still pending at gateway', {
        status: 'pending',
        orderNumber: order.orderNumber,
        paymentStatus: 'pending'
      });
    }

    // Return current state without forcibly marking as cancelled
    return successResponse(res, 200, 'Payment status from gateway', {
      status: order.paymentStatus === 'paid' ? 'success' : 'pending',
      orderNumber: order.orderNumber,
      paymentStatus: order.paymentStatus
    });
  } catch (error) {
    logger.error('Failed to check status with Airpay', { error: error.message, txnid });
    return next(new AppError('Failed to check status with Airpay', 500));
  }
});

