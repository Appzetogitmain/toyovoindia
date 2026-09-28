import Order from '../models/Order.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
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
import { deekpayService } from '../services/deekpay.service.js';
import { hdfcService } from '../services/hdfc.service.js';
import { generateHdfcOrderId } from '../utils/hdfc.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { generateOrderAccessToken } from '../utils/jwt.js';

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
  Promise.resolve(sendOrderConfirmationEmail(order)).catch(() => {});

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
export const processSuccessfulPayment = async (order, gatewayResponse) => {
  order.status = 'processing';
  order.paymentStatus = 'paid';
  if (!order.paymentGateway) {
    order.paymentGateway = {};
  }
  order.paymentGateway.verifiedAt = new Date();
  order.paymentGateway.rawResponse = gatewayResponse;

  const paymentMethodLabel = (order.paymentMethod || 'payment').toUpperCase();
  order.statusHistory.push({
    status: 'processing',
    note: `Payment verified successfully via ${paymentMethodLabel}.`,
    actorRole: 'system',
    createdAt: new Date(),
  });

  // Safely decrement stock directly for each item on the verified order
  try {
    if (Array.isArray(order.items) && order.items.length > 0) {
      await Promise.all(
        order.items.map(async (item) => {
          if (item.product) {
            await Product.updateOne(
              { _id: item.product },
              { $inc: { stock: -item.quantity, soldCount: item.quantity } }
            );
          }
        })
      );
    }
  } catch (err) {
    logger.error('Failed to decrement product stock after payment verification', {
      orderNumber: order.orderNumber,
      error: err.message,
    });
  }

  // Safely increment coupon usage count
  try {
    if (order.coupon?.couponId) {
      await Coupon.updateOne({ _id: order.coupon.couponId }, { $inc: { usedCount: 1 } });
    }
  } catch (err) {
    logger.error('Failed to increment coupon usage count after payment verification', {
      orderNumber: order.orderNumber,
      couponId: order.coupon?.couponId,
      error: err.message,
    });
  }

  try {
    await order.save({ validateModifiedOnly: true });
  } catch (err) {
    logger.warn('Non-fatal warning on order.save in processSuccessfulPayment', {
      orderNumber: order.orderNumber,
      error: err.message,
    });
  }

  // Atomically clear the cart for logged-in users after verified purchase
  if (order.user) {
    try {
      await User.updateOne(
        { _id: order.user },
        { $set: { 'preferences.cart': [] } }
      );
    } catch (err) {
      logger.error('Failed to clear user cart after payment verification', {
        userId: order.user,
        error: err.message,
      });
    }
  }

  await Promise.resolve(notifyPaymentSuccess(order)).catch(() => {});
  await Promise.resolve(sendOrderConfirmationEmail(order)).catch(() => {});
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

    const orderToken = generateOrderAccessToken(order.orderNumber, order.customer?.email);
    return successResponse(res, 201, 'Airpay order initiated successfully', {
      ...formData,
      orderToken,
    });
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

export const extractAirpayPayload = (source = {}) => {
  const merchantTxnId = source.TRANSACTIONID || source.transactionid || source.transactionId || source.orderid || source.ORDERID || source.merchant_txnId || source.txnid || '';
  const apTransactionId = source.APTRANSACTIONID || source.aptransactionid || source.apTransactionId || source.aptxnid || '';
  const orderNumber = source.CUSTOMVAR || source.customvar || source.orderNumber || source.order_number || '';
  const rawAmount = source.AMOUNT || source.amount || '';
  const status = source.TRANSACTIONSTATUS || source.transactionstatus || source.transactionStatus || source.status || '';
  const paymentStatus = source.TRANSACTIONPAYMENTSTATUS || source.transactionpaymentstatus || source.transactionPaymentStatus || source.paymentStatus || '';
  const message = source.MESSAGE || source.message || '';
  const chmod = source.CHMOD || source.chmod || '';

  return {
    merchantTxnId,
    apTransactionId,
    orderNumber,
    rawAmount,
    status,
    paymentStatus,
    message,
    chmod,
  };
};

export const findAirpayOrder = async ({ merchantTxnId, orderNumber, apTransactionId }) => {
  const queryConditions = [];
  if (merchantTxnId) {
    queryConditions.push({ 'paymentGateway.airpayTxnId': String(merchantTxnId) });
    queryConditions.push({ orderNumber: String(merchantTxnId) });
  }
  if (orderNumber) {
    queryConditions.push({ orderNumber: String(orderNumber) });
    queryConditions.push({ 'paymentGateway.airpayTxnId': String(orderNumber) });
  }
  if (apTransactionId) {
    queryConditions.push({ 'paymentGateway.airpayPaymentId': String(apTransactionId) });
  }

  if (queryConditions.length === 0) return null;
  return Order.findOne({ $or: queryConditions });
};

export const handleAirpayResponse = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const query = req.query || {};
  const source = { ...query, ...body };

  const {
    merchantTxnId,
    apTransactionId,
    orderNumber: customVarOrderNumber,
    rawAmount,
    status,
    paymentStatus,
    message,
    chmod,
  } = extractAirpayPayload(source);

  logger.info('[AIRPAY_CALLBACK_RECEIVED]', {
    transactionId: merchantTxnId,
    apTransactionId,
    customVar: customVarOrderNumber,
    amount: rawAmount,
    transactionStatus: status,
    transactionPaymentStatus: paymentStatus,
    message,
    chmod,
    method: req.method,
  });

  const renderAirpayResponse = (targetUrl, isSuccess = true, orderNum = '') => {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(200).json({
        success: isSuccess,
        redirectUrl: targetUrl,
        orderNumber: orderNum,
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

  if (!merchantTxnId && !customVarOrderNumber && !apTransactionId) {
    logger.warn('[AIRPAY_CALLBACK_ERROR] Missing transaction identifier in callback');
    return renderAirpayResponse(`${env.CLIENT_URL}/checkout?error=MissingTransactionId`, false);
  }

  const order = await findAirpayOrder({
    merchantTxnId,
    orderNumber: customVarOrderNumber,
    apTransactionId,
  });

  if (!order) {
    logger.error('[AIRPAY_CALLBACK_ERROR] Order not found for Airpay identifiers', {
      transactionId: merchantTxnId,
      customVar: customVarOrderNumber,
      apTransactionId,
    });
    return renderAirpayResponse(`${env.CLIENT_URL}/checkout?error=OrderNotFound`, false);
  }

  logger.info('[AIRPAY_ORDER_MATCHED]', {
    localOrderId: order._id.toString(),
    orderNumber: order.orderNumber,
    paymentStatusBefore: order.paymentStatus,
    orderStatusBefore: order.status,
  });

  const effectiveAirpayTxnId = order.paymentGateway?.airpayTxnId || merchantTxnId || order.orderNumber;

  // Authoritatively verify with Airpay verify.php API
  let statusData = null;
  try {
    logger.info('[AIRPAY_VERIFY_REQUEST]', { AIRPAY_TRANSACTION_ID: effectiveAirpayTxnId, orderNumber: order.orderNumber });
    statusData = await airpayService.checkStatus(effectiveAirpayTxnId);
    logger.info('[AIRPAY_VERIFY_RESULT]', { AIRPAY_TRANSACTION_ID: effectiveAirpayTxnId, statusData });
  } catch (err) {
    logger.warn('[AIRPAY_CALLBACK_ERROR] Airpay verify.php call failed in return handler, falling back to body params', { error: err.message });
  }

  const isSuccess =
    (statusData && (String(statusData.status) === '200' || String(statusData.paymentStatus).toLowerCase() === 'success')) ||
    String(status) === '200' ||
    String(paymentStatus).toLowerCase() === 'success';

  logger.info('[AIRPAY_PAYMENT_VERIFIED]', {
    isSuccess,
    verifyStatus: statusData?.status,
    verifyPaymentStatus: statusData?.paymentStatus,
    callbackStatus: status,
    callbackPaymentStatus: paymentStatus,
  });

  const effectiveAmount = statusData?.amount ? Number(statusData.amount) : Number(rawAmount);

  if (isSuccess) {
    if (Number.isFinite(effectiveAmount) && Math.abs(effectiveAmount - order.totalAmount) > 0.05) {
      logger.error('[AIRPAY_CALLBACK_ERROR] Amount mismatch in Airpay Response!', { expected: order.totalAmount, received: effectiveAmount });
      order.paymentStatus = 'failed';
      order.status = 'cancelled';
      order.notes = `${order.notes ? order.notes + '\n' : ''}SECURITY ALERT: Amount mismatch. Airpay charged ₹${effectiveAmount}`;
      await order.save();
      return renderAirpayResponse(`${env.CLIENT_URL}/checkout?error=AmountMismatch`, false, order.orderNumber);
    }

    const paymentStatusBefore = order.paymentStatus;
    const orderStatusBefore = order.status;
    const finalApPaymentId = statusData?.apTransactionId || apTransactionId || order.paymentGateway?.airpayPaymentId || '';

    // Atomic update: only update if not already marked as paid
    const updatedOrder = await Order.findOneAndUpdate(
      { _id: order._id, paymentStatus: { $ne: 'paid' } },
      {
        $set: {
          paymentStatus: 'paid',
          status: 'processing',
          'paymentGateway.airpayPaymentId': finalApPaymentId,
          'paymentGateway.verifiedAt': new Date(),
          'paymentGateway.rawResponse': statusData?.rawXml ? statusData : source,
        },
        $push: {
          statusHistory: {
            status: 'processing',
            note: `Payment verified successfully via Airpay. Gateway Txn ID: ${finalApPaymentId || 'N/A'}`,
            actorRole: 'system',
            createdAt: new Date(),
          }
        }
      },
      { new: true }
    );

    if (updatedOrder) {
      logger.info('[AIRPAY_ORDER_UPDATED]', {
        paymentStatusBefore,
        paymentStatusAfter: updatedOrder.paymentStatus,
        orderStatusBefore,
        orderStatusAfter: updatedOrder.status,
      });

      await processSuccessfulPayment(updatedOrder, statusData?.rawXml ? statusData : source);
    } else {
      logger.info('[AIRPAY_ORDER_ALREADY_PAID]', {
        orderNumber: order.orderNumber,
        paymentStatus: order.paymentStatus,
        status: order.status,
      });
      if (order.status === 'pending') {
        await Order.updateOne({ _id: order._id, status: 'pending' }, { $set: { status: 'processing' } });
      }
    }

    logger.info('[AIRPAY_CALLBACK_SUCCESS]', {
      orderNumber: order.orderNumber,
      airpayTxnId: effectiveAirpayTxnId,
      airpayPaymentId: finalApPaymentId,
    });

    const orderToken = generateOrderAccessToken(order.orderNumber, order.customer?.email);
    const emailParam = order.customer?.email ? `&email=${encodeURIComponent(order.customer.email)}` : '';
    const tokenParam = orderToken ? `&token=${encodeURIComponent(orderToken)}` : '';
    return renderAirpayResponse(`${env.CLIENT_URL}/order-success?orderNumber=${order.orderNumber}${emailParam}${tokenParam}`, true, order.orderNumber);
  }

  // If not confirmed yet, forward user to frontend callback page so it can poll and recover cleanly
  return renderAirpayResponse(`${env.CLIENT_URL}/payment/airpay/callback?txnid=${encodeURIComponent(effectiveAirpayTxnId)}&orderNumber=${encodeURIComponent(order.orderNumber)}`, false, order.orderNumber);
});

export const handleAirpayWebhook = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const query = req.query || {};
  const source = { ...query, ...body };

  const {
    merchantTxnId,
    apTransactionId,
    orderNumber: customVarOrderNumber,
    rawAmount,
    status,
    paymentStatus,
  } = extractAirpayPayload(source);

  logger.info('Airpay S2S webhook received', { merchantTxnId, apTransactionId, customVarOrderNumber, status, paymentStatus, rawAmount });

  if (!merchantTxnId && !customVarOrderNumber && !apTransactionId) {
    return res.status(400).send('Missing transaction identifier');
  }

  const order = await findAirpayOrder({
    merchantTxnId,
    orderNumber: customVarOrderNumber,
    apTransactionId,
  });

  if (!order) {
    return res.status(404).send('Order Not Found');
  }

  if (order.paymentStatus === 'paid') {
    if (order.status === 'pending') {
      order.status = 'processing';
      await order.save();
    }
    return res.status(200).send('Already Processed');
  }

  const airpayTxnId = order.paymentGateway?.airpayTxnId || merchantTxnId || order.orderNumber;
  let statusData = null;
  try {
    statusData = await airpayService.checkStatus(airpayTxnId);
  } catch (err) {
    logger.warn('Airpay verify.php call failed in webhook', { error: err.message });
  }

  const isSuccess =
    (statusData && (String(statusData.status) === '200' || String(statusData.paymentStatus).toLowerCase() === 'success')) ||
    String(status) === '200' ||
    String(paymentStatus).toLowerCase() === 'success';
  const effectiveAmount = statusData?.amount ? Number(statusData.amount) : Number(rawAmount);

  if (isSuccess) {
    if (Number.isFinite(effectiveAmount) && Math.abs(effectiveAmount - order.totalAmount) > 0.05) {
      logger.error('Amount mismatch in Airpay Webhook!', { expected: order.totalAmount, received: effectiveAmount });
      order.paymentStatus = 'failed';
      order.status = 'cancelled';
      await order.save();
      return res.status(200).send('Amount Mismatch Handled');
    }

    const finalApPaymentId = statusData?.apTransactionId || apTransactionId || order.paymentGateway?.airpayPaymentId || '';

    const updatedOrder = await Order.findOneAndUpdate(
      { _id: order._id, paymentStatus: { $ne: 'paid' } },
      {
        $set: {
          paymentStatus: 'paid',
          status: 'processing',
          'paymentGateway.airpayPaymentId': finalApPaymentId,
          'paymentGateway.verifiedAt': new Date(),
          'paymentGateway.rawResponse': statusData?.rawXml ? statusData : source,
        },
        $push: {
          statusHistory: {
            status: 'processing',
            note: `Payment verified via Airpay webhook. ApTxnId: ${finalApPaymentId || 'N/A'}`,
            actorRole: 'system',
            createdAt: new Date(),
          }
        }
      },
      { new: true }
    );

    if (updatedOrder) {
      await processSuccessfulPayment(updatedOrder, statusData?.rawXml ? statusData : source);
    }
    return res.status(200).send('OK');
  }

  return res.status(200).send('OK');
});

export const checkAirpayStatus = asyncHandler(async (req, res, next) => {
  const { txnid } = req.params;

  const order = await findAirpayOrder({
    merchantTxnId: txnid,
    orderNumber: txnid,
    apTransactionId: txnid,
  });

  if (!order) return next(new AppError('Order not found', 404));

  if (order.paymentStatus === 'paid') {
    if (order.status === 'pending') {
      order.status = 'processing';
      await order.save();
    }
    const token = generateOrderAccessToken(order.orderNumber, order.customer?.email);
    return successResponse(res, 200, 'Payment already marked as successful', {
      status: 'success',
      orderNumber: order.orderNumber,
      paymentStatus: 'paid',
      email: order.customer?.email,
      token,
    });
  }

  const airpayTxnId = order.paymentGateway?.airpayTxnId || txnid;

  try {
    logger.info('[AIRPAY_VERIFY_REQUEST]', { AIRPAY_TRANSACTION_ID: airpayTxnId, orderNumber: order.orderNumber });
    const statusData = await airpayService.checkStatus(airpayTxnId);
    logger.info('[AIRPAY_VERIFY_RESULT]', { txnid, airpayTxnId, statusData });

    // Status 200 means success at Airpay verify.php
    const isSuccess = String(statusData?.status) === '200' || String(statusData?.paymentStatus).toLowerCase() === 'success';

    if (isSuccess) {
      const paidAmount = Number(statusData.amount);
      if (Number.isFinite(paidAmount) && Math.abs(paidAmount - order.totalAmount) <= 0.05) {
        const paymentStatusBefore = order.paymentStatus;
        const orderStatusBefore = order.status;
        const finalApPaymentId = statusData.apTransactionId || order.paymentGateway?.airpayPaymentId || '';

        const updatedOrder = await Order.findOneAndUpdate(
          { _id: order._id, paymentStatus: { $ne: 'paid' } },
          {
            $set: {
              paymentStatus: 'paid',
              status: 'processing',
              'paymentGateway.airpayPaymentId': finalApPaymentId,
              'paymentGateway.verifiedAt': new Date(),
              'paymentGateway.rawResponse': statusData,
            },
            $push: {
              statusHistory: {
                status: 'processing',
                note: `Payment verified successfully via Airpay verify.php. Gateway Txn ID: ${finalApPaymentId || 'N/A'}`,
                actorRole: 'system',
                createdAt: new Date(),
              }
            }
          },
          { new: true }
        );

        if (updatedOrder) {
          logger.info('[AIRPAY_ORDER_UPDATED]', {
            paymentStatusBefore,
            paymentStatusAfter: updatedOrder.paymentStatus,
            orderStatusBefore,
            orderStatusAfter: updatedOrder.status,
          });

          await processSuccessfulPayment(updatedOrder, statusData);

          logger.info('[ORDER_CONFIRMATION_SUCCESS]', {
            AIRPAY_ORDER_ID: order.orderNumber,
            AIRPAY_TRANSACTION_ID: airpayTxnId,
            PAYMENT_STATUS_AFTER: 'paid',
            ORDER_STATUS_AFTER: 'processing',
          });
        }

        const token = generateOrderAccessToken(order.orderNumber, order.customer?.email);
        return successResponse(res, 200, 'Payment synced successfully', {
          status: 'success',
          orderNumber: order.orderNumber,
          paymentStatus: 'paid',
          email: order.customer?.email,
          token,
        });
      }
    }

    if (String(statusData?.status) === '211' || !statusData?.status) {
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

// ==========================================
// --- DEEKPAY (STAR2PAY) INTEGRATION ---
// ==========================================

export const createDeekpayOrder = asyncHandler(async (req, res, next) => {
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
    paymentMethod: 'deekpay',
    shippingMethod: req.body.shippingMethod,
    subtotal: draft.subtotal,
    shippingAmount: draft.shippingAmount,
    discountAmount: draft.discountAmount,
    totalAmount: draft.totalAmount,
    coupon: draft.couponData,
    notes: req.body.notes || undefined,
    paymentGateway: {
      provider: 'deekpay',
      deekpayTxnId: txnid,
    },
  });

  logger.info('Pending DeekPay order pre-created in MongoDB', {
    orderNumber: order.orderNumber,
    deekpayTxnId: txnid,
  });

  try {
    const notifyUrl = `${env.SERVER_URL}/api/payments/deekpay/webhook`;
    const returnUrl = `${env.CLIENT_URL}/payment/deekpay/callback?txnid=${encodeURIComponent(txnid)}`;
    const rawIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '0.0.0.0';
    const clientIp = (rawIp.includes(':') || rawIp === '127.0.0.1') ? '0.0.0.0' : rawIp;

    const result = await deekpayService.createCollectionOrder({
      mchOrderNo: txnid,
      amount: draft.totalAmount,
      notifyUrl,
      returnUrl,
      clientIp,
      subject: `Toyovo Order ${order.orderNumber}`,
      body: `Toyovo India Order ${order.orderNumber}`,
      param1: order.orderNumber,
      validateUserName: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
    });

    if (result.payOrderId) {
      order.paymentGateway.deekpayOrderId = result.payOrderId;
      await order.save();
    }

    const orderToken = generateOrderAccessToken(order.orderNumber, order.customer?.email);
    return successResponse(res, 201, 'DeekPay order initiated successfully', {
      payUrl: result.payUrl,
      payOrderId: result.payOrderId,
      orderNumber: order.orderNumber,
      txnid,
      orderToken,
    });
  } catch (error) {
    logger.error('DeekPay initiate error', { orderNumber: order.orderNumber, message: error.message });

    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    order.statusHistory.push({
      status: 'cancelled',
      note: `DeekPay initiation failed: ${error.message}`,
      actorRole: 'system',
      createdAt: new Date(),
    });
    await order.save();

    return next(error instanceof AppError ? error : new AppError('DeekPay gateway is temporarily unavailable', 503));
  }
});

/**
 * Result Notification (Webhook / Callback):
 * DeekPay sends payment results to this endpoint.
 * We verify signature, perform server-to-server query verification, and respond with "SUCCESS".
 */
export const handleDeekpayCallback = asyncHandler(async (req, res) => {
  const source = { ...(req.query || {}), ...(req.body || {}) };
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

  logger.info('[DEEKPAY_CALLBACK_RECEIVED]', {
    method: req.method,
    clientIp,
    source,
  });

  if (!deekpayService.isIpAllowed(clientIp)) {
    logger.warn('[DEEKPAY_CALLBACK_UNRECOGNIZED_IP]', { clientIp });
  }

  const {
    payOrderId,
    mchOrderNo,
    status: rawStatus,
    utr,
    sign,
    param1,
  } = source;

  if (!mchOrderNo) {
    logger.error('DeekPay callback missing mchOrderNo');
    return res.status(400).send('FAIL');
  }

  // Verify signature
  const isSignatureValid = deekpayService.verifySignature(source);
  if (!isSignatureValid) {
    logger.error('[DEEKPAY_CALLBACK_INVALID_SIGNATURE]', { source });
    return res.status(400).send('FAIL');
  }

  // Find order by transaction ID or order number
  const order = await Order.findOne({
    $or: [
      { 'paymentGateway.deekpayTxnId': String(mchOrderNo) },
      { orderNumber: String(mchOrderNo) },
      ...(param1 ? [{ orderNumber: String(param1) }] : []),
    ],
  });

  if (!order) {
    logger.error('[DEEKPAY_CALLBACK_ORDER_NOT_FOUND]', { mchOrderNo, param1 });
    return res.status(200).send('SUCCESS');
  }

  if (order.paymentStatus === 'paid') {
    logger.info('[DEEKPAY_CALLBACK_ALREADY_PAID]', { orderNumber: order.orderNumber, mchOrderNo });
    return res.status(200).send('SUCCESS');
  }

  // Server-to-server authoritative status inquiry
  try {
    const queryResult = await deekpayService.queryCollectionOrder({ mchOrderNo });
    logger.info('[DEEKPAY_CALLBACK_S2S_VERIFIED]', {
      mchOrderNo,
      queryStatus: queryResult.status,
      paidAmount: queryResult.paidAmount,
    });

    if (queryResult.status === 'success') {
      const expectedAmount = order.totalAmount;
      const reportedAmount = queryResult.paidAmount || queryResult.amount;

      // Amount verification to prevent tampering
      if (Math.abs(reportedAmount - expectedAmount) > 0.05) {
        logger.error('[DEEKPAY_CALLBACK_AMOUNT_MISMATCH]', {
          orderNumber: order.orderNumber,
          expectedAmount,
          reportedAmount,
        });

        order.notes = (order.notes ? order.notes + '\n' : '') +
          `SECURITY ALERT: DeekPay amount mismatch. Paid ₹${reportedAmount} vs Expected ₹${expectedAmount}`;
        await order.save();
        return res.status(200).send('SUCCESS');
      }

      // Atomic transition from pending to paid
      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, paymentStatus: { $ne: 'paid' } },
        {
          $set: {
            paymentStatus: 'paid',
            status: 'processing',
            'paymentGateway.deekpayOrderId': queryResult.payOrderId || payOrderId,
            'paymentGateway.deekpayUtr': queryResult.utr || utr || '',
            'paymentGateway.verifiedAt': new Date(),
            'paymentGateway.rawResponse': { callback: source, query: queryResult },
          },
          $push: {
            statusHistory: {
              status: 'processing',
              note: `Payment verified via DeekPay callback. UTR: ${queryResult.utr || utr || 'N/A'}`,
              actorRole: 'system',
              createdAt: new Date(),
            },
          },
        },
        { new: true }
      );

      if (claimed) {
        await processSuccessfulPayment(claimed, { callback: source, query: queryResult });
        logger.info('[DEEKPAY_CALLBACK_SUCCESS_PROCESSED]', {
          orderNumber: order.orderNumber,
          mchOrderNo,
          utr: queryResult.utr || utr,
        });
      }
    } else if (queryResult.status === 'failed') {
      await Order.findOneAndUpdate(
        { _id: order._id, paymentStatus: 'pending' },
        {
          $set: {
            paymentStatus: 'failed',
            status: 'cancelled',
            cancelledAt: new Date(),
          },
          $push: {
            statusHistory: {
              status: 'cancelled',
              note: `DeekPay payment reported as failed (status code: ${queryResult.rawStatus}).`,
              actorRole: 'system',
              createdAt: new Date(),
            },
          },
        }
      );
      Promise.resolve(notifyPaymentFailed(order)).catch(() => {});
    }

    return res.status(200).send('SUCCESS');
  } catch (err) {
    logger.error('[DEEKPAY_CALLBACK_QUERY_ERROR]', { message: err.message, mchOrderNo });
    // Still return 200 SUCCESS if callback was validly signed so Star2Pay stops retry bombardment,
    // reconciler cron will auto-retry verification.
    return res.status(200).send('SUCCESS');
  }
});

/**
 * Return URL: Customer browser is redirected here after completing hosted payment.
 * UX-only: redirects front-end to callback page which verifies authoritative status.
 */
export const handleDeekpayReturn = asyncHandler(async (req, res) => {
  const source = { ...(req.query || {}), ...(req.body || {}) };
  const txnid = source.mchOrderNo || source.txnid || source.orderNumber;

  logger.info('[DEEKPAY_BROWSER_RETURN]', { txnid, method: req.method });

  if (!txnid) {
    return res.redirect(`${env.CLIENT_URL}/checkout?error=MissingTransactionId`);
  }

  return res.redirect(`${env.CLIENT_URL}/payment/deekpay/callback?txnid=${encodeURIComponent(txnid)}`);
});

/**
 * Status Check Endpoint: /api/payments/deekpay/status/:txnid
 * Polled by frontend callback page or triggered manually by admin.
 */
export const checkDeekpayStatus = asyncHandler(async (req, res, next) => {
  const { txnid } = req.params;

  if (!txnid) {
    return next(new AppError('Transaction ID is required', 400));
  }

  const order = await Order.findOne({
    $or: [
      { 'paymentGateway.deekpayTxnId': String(txnid) },
      { orderNumber: String(txnid) },
    ],
  });

  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  const orderToken = generateOrderAccessToken(order.orderNumber, order.customer?.email);

  if (order.paymentStatus === 'paid') {
    return successResponse(res, 200, 'Payment already verified successfully', {
      status: 'success',
      orderNumber: order.orderNumber,
      paymentStatus: 'paid',
      email: order.customer?.email,
      token: orderToken,
    });
  }

  try {
    const lookupId = order.paymentGateway?.deekpayTxnId || order.orderNumber;
    const queryResult = await deekpayService.queryCollectionOrder({ mchOrderNo: lookupId });

    if (queryResult.status === 'success') {
      const expectedAmount = order.totalAmount;
      const reportedAmount = queryResult.paidAmount || queryResult.amount;

      if (Math.abs(reportedAmount - expectedAmount) <= 0.05) {
        const claimed = await Order.findOneAndUpdate(
          { _id: order._id, paymentStatus: { $ne: 'paid' } },
          {
            $set: {
              paymentStatus: 'paid',
              status: 'processing',
              'paymentGateway.deekpayOrderId': queryResult.payOrderId || order.paymentGateway?.deekpayOrderId,
              'paymentGateway.deekpayUtr': queryResult.utr || order.paymentGateway?.deekpayUtr || '',
              'paymentGateway.verifiedAt': new Date(),
              'paymentGateway.rawResponse': queryResult,
            },
            $push: {
              statusHistory: {
                status: 'processing',
                note: `Payment verified via DeekPay status inquiry. UTR: ${queryResult.utr || 'N/A'}`,
                actorRole: 'system',
                createdAt: new Date(),
              },
            },
          },
          { new: true }
        );

        if (claimed) {
          await processSuccessfulPayment(claimed, queryResult);
        }

        return successResponse(res, 200, 'Payment synced successfully', {
          status: 'success',
          orderNumber: order.orderNumber,
          paymentStatus: 'paid',
          email: order.customer?.email,
          token: orderToken,
        });
      }
    }

    if (queryResult.status === 'pending') {
      return successResponse(res, 200, 'Payment is still pending at gateway', {
        status: 'pending',
        orderNumber: order.orderNumber,
        paymentStatus: 'pending',
        email: order.customer?.email,
        token: orderToken,
      });
    }

    return successResponse(res, 200, 'Payment status from gateway', {
      status: order.paymentStatus === 'paid' ? 'success' : 'pending',
      orderNumber: order.orderNumber,
      paymentStatus: order.paymentStatus,
      email: order.customer?.email,
      token: orderToken,
    });
  } catch (error) {
    logger.error('Failed to check status with DeekPay', { error: error.message, txnid });
    return next(new AppError('Failed to check status with DeekPay', 500));
  }
});

// ==========================================
// --- HDFC SMARTGATEWAY (JUSPAY) INTEGRATION ---
// ==========================================

export const createHdfcOrder = asyncHandler(async (req, res, next) => {
  const draft = await buildOrderDraftFromCheckout(req.body);
  // HDFC requires order_id to be <21 chars, alphanumeric only, non-sequential —
  // generateTxnId() (timestamp-based, used by PayU) does not satisfy that.
  const txnid = generateHdfcOrderId();

  const customerEmail = (req.body.customer.email || 'guest@toyovoindia.com').toLowerCase();

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
    paymentMethod: 'hdfc',
    shippingMethod: req.body.shippingMethod,
    subtotal: draft.subtotal,
    shippingAmount: draft.shippingAmount,
    discountAmount: draft.discountAmount,
    totalAmount: draft.totalAmount,
    coupon: draft.couponData,
    notes: req.body.notes || undefined,
    paymentGateway: {
      provider: 'hdfc',
      hdfcTxnId: txnid,
    },
  });

  logger.info('Pending HDFC SmartGateway order pre-created in MongoDB', {
    orderNumber: order.orderNumber,
    hdfcTxnId: txnid,
  });

  // x-customerid is required on every SmartGateway API call for this order, so
  // pin it once at creation time and persist it for the return/webhook/status lookups.
  const customerId = String(order.user || order.customer.email || txnid);

  try {
    const data = await hdfcService.createSession({
      orderId: txnid,
      amount: draft.totalAmount,
      customerId,
      customerEmail: order.customer.email,
      customerPhone: order.customer.phone,
      firstName: order.customer.firstName,
      lastName: order.customer.lastName,
      returnUrl: `${env.SERVER_URL}/api/payments/hdfc/return`,
      description: `Payment for order ${order.orderNumber}`,
    });

    order.paymentGateway.hdfcCustomerId = customerId;
    await order.save();

    logger.info('HDFC SmartGateway session created', {
      orderNumber: order.orderNumber,
      hdfcTxnId: txnid,
      hdfcOrderId: data.id,
    });

    return successResponse(res, 201, 'HDFC SmartGateway order initiated successfully', {
      paymentUrl: data.payment_links?.web,
      orderNumber: order.orderNumber,
      txnid,
    });
  } catch (error) {
    logger.error('HDFC SmartGateway session create error', { orderNumber: order.orderNumber, message: error.message });

    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    order.statusHistory.push({
      status: 'cancelled',
      note: `HDFC SmartGateway initiation failed: ${error.message}`,
      actorRole: 'system',
      createdAt: new Date(),
    });
    await order.save();

    return next(error instanceof AppError ? error : new AppError('Payment gateway is temporarily unavailable', 503));
  }
});

// Browser return_url redirect only — UX routing, never trusted. Whatever HDFC
// puts on this query string is ignored beyond locating the order; the actual
// outcome is always re-verified server-side via the Order Status API, exactly
// like the JioPay return handler above.
export const handleHdfcReturn = asyncHandler(async (req, res) => {
  const source = { ...(req.query || {}), ...(req.body || {}) };
  const txnid = source.order_id || source.orderId || source.order_Id || source.merchantOrderId;

  logger.info('HDFC SmartGateway return received', { txnid, method: req.method });

  if (!txnid) {
    return res.redirect(`${env.CLIENT_URL}/checkout?error=MissingTransactionId`);
  }

  return res.redirect(`${env.CLIENT_URL}/payment/hdfc/callback?txnid=${encodeURIComponent(txnid)}`);
});

// S2S Webhook: an event trigger only. We verify the configured Basic-auth
// pair for authenticity, then re-verify the real outcome via the Order Status
// API (source of truth) before ever mutating the order.
export const handleHdfcWebhook = asyncHandler(async (req, res) => {
  if (!hdfcService.verifyWebhookAuth(req.headers['authorization'])) {
    logger.error('HDFC SmartGateway webhook auth verification failed');
    return res.status(401).send('Unauthorized');
  }

  const payload = req.body || {};
  const eventName = payload.event_name;
  const orderPayload = payload.content?.order || {};
  const txnid = orderPayload.order_id;

  logger.info('HDFC SmartGateway webhook received', { eventName, txnid, status: orderPayload.status });

  if (!txnid) {
    logger.error('HDFC SmartGateway webhook missing order_id');
    return res.status(400).send('Bad Request');
  }

  const order = await Order.findOne({ 'paymentGateway.hdfcTxnId': txnid });
  if (!order) {
    logger.error(`HDFC SmartGateway webhook: order not found for txnid ${txnid}`);
    return res.status(404).send('Order Not Found');
  }

  if (order.paymentStatus === 'paid' || order.paymentStatus === 'failed') {
    logger.info(`Idempotent: HDFC SmartGateway webhook already processed for TxnId: ${txnid}. Status: ${order.paymentStatus}`);
    return res.status(200).send('Already Processed');
  }

  try {
    const customerId = order.paymentGateway?.hdfcCustomerId || String(order.user || order.customer.email || txnid);
    const statusData = await hdfcService.getOrderStatus(txnid, customerId);
    const normalized = hdfcService.normalizeStatus(statusData);
    logger.info('HDFC SmartGateway webhook status verification result', { txnid, normalized, status: statusData.status });

    if (normalized === 'success') {
      const webhookAmount = Number(statusData.amount);

      if (Number.isFinite(webhookAmount) && Math.abs(webhookAmount - order.totalAmount) > 0.01) {
        logger.error(`Amount mismatch in HDFC SmartGateway Webhook! DB: ${order.totalAmount}, Gateway: ${webhookAmount}`);
        await Order.findOneAndUpdate(
          { _id: order._id, paymentStatus: 'pending' },
          {
            $set: {
              paymentStatus: 'failed',
              status: 'cancelled',
              notes: `${order.notes ? order.notes + '\n' : ''}SECURITY ALERT: Amount mismatch. HDFC SmartGateway reported ₹${webhookAmount}`,
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
        logger.info(`Idempotent: HDFC SmartGateway order already claimed for TxnId: ${txnid}`);
        return res.status(200).send('Already Processed');
      }

      order.paymentGateway.hdfcPaymentId = statusData.txn_id || order.paymentGateway.hdfcPaymentId;
      await processSuccessfulPayment(order, { webhook: payload, status: statusData });
      logger.info(`HDFC SmartGateway Webhook Success Processed securely via Order Status API for Order: ${order.orderNumber}`);
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
          note: `HDFC SmartGateway Payment ${normalized === 'cancelled' ? 'Cancelled' : 'Rejected'}: ${statusData.status || 'UNKNOWN_ERROR'}`,
          actorRole: 'system',
          createdAt: new Date(),
        });
        await order.save();
        Promise.resolve(notifyPaymentFailed(order)).catch(() => {});
        logger.info(`HDFC SmartGateway Webhook ${normalized} Processed for Order: ${order.orderNumber}`);
      }
    } else {
      logger.info(`HDFC SmartGateway webhook event ignored: payment state is still ${normalized} for ${txnid}`);
    }

    return res.status(200).send('OK');
  } catch (error) {
    logger.error('Failed to verify status from HDFC SmartGateway during webhook handling', { txnid, message: error.message });
    // Return 500 so SmartGateway retries the webhook later
    return res.status(500).send('Status Verification Failed');
  }
});

export const checkHdfcStatus = asyncHandler(async (req, res, next) => {
  const { txnid } = req.params;

  const order = await Order.findOne({ 'paymentGateway.hdfcTxnId': txnid });
  if (!order) return next(new AppError('Order not found', 404));

  if (order.paymentStatus === 'paid') {
    return successResponse(res, 200, 'Payment already marked as successful', { status: 'success', orderNumber: order.orderNumber });
  }
  if (order.paymentStatus === 'failed') {
    return successResponse(res, 200, 'Payment already marked as failed', { status: 'failed', orderNumber: order.orderNumber });
  }

  try {
    const customerId = order.paymentGateway?.hdfcCustomerId || String(order.user || order.customer.email || txnid);
    const statusData = await hdfcService.getOrderStatus(txnid, customerId);
    const normalized = hdfcService.normalizeStatus(statusData);
    logger.info('HDFC SmartGateway manual status check', { txnid, normalized, status: statusData.status });

    if (normalized === 'success') {
      const statusAmount = Number(statusData.amount);

      if (Number.isFinite(statusAmount) && Math.abs(statusAmount - order.totalAmount) > 0.01) {
        logger.error(`Amount mismatch in HDFC SmartGateway Status Check! DB: ${order.totalAmount}, Gateway: ${statusAmount}`);
        await Order.findOneAndUpdate(
          { _id: order._id, paymentStatus: 'pending' },
          {
            $set: {
              paymentStatus: 'failed',
              status: 'cancelled',
              notes: `${order.notes ? order.notes + '\n' : ''}SECURITY ALERT: Amount mismatch. HDFC SmartGateway reported ₹${statusAmount}`,
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
        order.paymentGateway.hdfcPaymentId = statusData.txn_id || order.paymentGateway.hdfcPaymentId;
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
      { $set: { paymentStatus: 'failed', status: 'cancelled', 'paymentGateway.rawResponse': { status: statusData } } }
    );
    if (claimed) {
      Promise.resolve(notifyPaymentFailed(order)).catch(() => {});
    }
    return successResponse(res, 200, 'Payment failed', { status: 'failed', orderNumber: order.orderNumber });

  } catch (error) {
    logger.error('Failed to check status with HDFC SmartGateway', { error: error.message, txnid });
    return next(new AppError('Failed to check status with HDFC SmartGateway', 500));
  }
});

