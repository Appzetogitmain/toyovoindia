import Order from '../models/Order.js';
import logger from '../utils/logger.js';
import { airpayService } from './airpay.service.js';
import { deekpayService } from './deekpay.service.js';
import { processSuccessfulPayment } from '../controllers/payment.controller.js';
import { revertFulfilledOrderSideEffects } from './order.service.js';

const reconcilePendingAirpayOrders = async () => {
  try {
    // Check pending Airpay orders created in the last 24 hours, that are at least 15 seconds old
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const fifteenSecondsAgo = new Date(Date.now() - 15 * 1000);

    const pendingOrders = await Order.find({
      paymentStatus: 'pending',
      paymentMethod: 'airpay',
      createdAt: { $gte: twentyFourHoursAgo, $lte: fifteenSecondsAgo },
    }).limit(20);

    if (pendingOrders.length === 0) return;

    for (const order of pendingOrders) {
      const airpayTxnId = order.paymentGateway?.airpayTxnId || order.orderNumber;
      if (!airpayTxnId) continue;

      try {
        const statusData = await airpayService.checkStatus(airpayTxnId);
        const isSuccess = String(statusData?.status) === '200' || String(statusData?.paymentStatus).toLowerCase() === 'success';

        if (isSuccess) {
          const paidAmount = Number(statusData.amount);
          if (Number.isFinite(paidAmount) && Math.abs(paidAmount - order.totalAmount) <= 0.05) {
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
                    note: `Payment verified via Airpay background reconciler. Gateway Txn ID: ${finalApPaymentId || 'N/A'}`,
                    actorRole: 'system',
                    createdAt: new Date(),
                  }
                }
              },
              { new: true }
            );

            if (updatedOrder) {
              await processSuccessfulPayment(updatedOrder, statusData);
              logger.info(`[AIRPAY_RECONCILER_SUCCESS] Reconciled pending order ${order.orderNumber} via Airpay verify.php`);
            }
          }
        } else if (String(statusData?.status) === '402' || String(statusData?.paymentStatus).toLowerCase() === 'cancelled') {
          // If Airpay explicitly returned Cancelled (402) AND order is older than 30 minutes, mark failed/cancelled safely
          const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
          if (new Date(order.createdAt) <= thirtyMinutesAgo) {
            await Order.findOneAndUpdate(
              { _id: order._id, paymentStatus: 'pending' },
              {
                $set: {
                  paymentStatus: 'failed',
                  status: 'cancelled',
                  cancelledAt: new Date(),
                  notes: (order.notes ? order.notes + '\n' : '') + `Airpay Status: ${statusData.message || 'Cancelled by customer'}`,
                },
                $push: {
                  statusHistory: {
                    status: 'cancelled',
                    actorRole: 'system',
                    note: `Airpay payment was cancelled (${statusData.message || 'Cancelled'}).`,
                    createdAt: new Date(),
                  }
                }
              }
            );
            logger.info(`[AIRPAY_RECONCILER_CANCELLED] Marked cancelled order ${order.orderNumber} via Airpay status check.`);
          }
        }
      } catch (err) {
        logger.debug(`Airpay reconciler checkStatus failed for ${order.orderNumber}: ${err.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error running Airpay reconciliation cron: ${error.message}`);
  }
};

const reconcilePendingDeekpayOrders = async () => {
  try {
    // Check pending DeekPay orders created in the last 24 hours, that are at least 15 seconds old
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const fifteenSecondsAgo = new Date(Date.now() - 15 * 1000);

    const pendingOrders = await Order.find({
      paymentStatus: 'pending',
      paymentMethod: 'deekpay',
      createdAt: { $gte: twentyFourHoursAgo, $lte: fifteenSecondsAgo },
    }).limit(20);

    if (pendingOrders.length === 0) return;

    for (const order of pendingOrders) {
      const deekpayTxnId = order.paymentGateway?.deekpayTxnId || order.orderNumber;
      if (!deekpayTxnId) continue;

      try {
        const queryResult = await deekpayService.queryCollectionOrder({ mchOrderNo: deekpayTxnId });

        if (queryResult.status === 'success') {
          const paidAmount = Number(queryResult.paidAmount || queryResult.amount);
          if (Number.isFinite(paidAmount) && Math.abs(paidAmount - order.totalAmount) <= 0.05) {
            const finalPayOrderId = queryResult.payOrderId || order.paymentGateway?.deekpayOrderId || '';
            const finalUtr = queryResult.utr || order.paymentGateway?.deekpayUtr || '';

            const updatedOrder = await Order.findOneAndUpdate(
              { _id: order._id, paymentStatus: { $ne: 'paid' } },
              {
                $set: {
                  paymentStatus: 'paid',
                  status: 'processing',
                  'paymentGateway.deekpayOrderId': finalPayOrderId,
                  'paymentGateway.deekpayUtr': finalUtr,
                  'paymentGateway.verifiedAt': new Date(),
                  'paymentGateway.rawResponse': queryResult,
                },
                $push: {
                  statusHistory: {
                    status: 'processing',
                    note: `Payment verified via DeekPay background reconciler. UTR: ${finalUtr || 'N/A'}`,
                    actorRole: 'system',
                    createdAt: new Date(),
                  },
                },
              },
              { new: true }
            );

            if (updatedOrder) {
              await processSuccessfulPayment(updatedOrder, queryResult);
              logger.info(`[DEEKPAY_RECONCILER_SUCCESS] Reconciled pending order ${order.orderNumber} via DeekPay query API`);
            }
          }
        } else if (queryResult.status === 'failed') {
          const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
          if (new Date(order.createdAt) <= thirtyMinutesAgo) {
            await Order.findOneAndUpdate(
              { _id: order._id, paymentStatus: 'pending' },
              {
                $set: {
                  paymentStatus: 'failed',
                  status: 'cancelled',
                  cancelledAt: new Date(),
                  notes: (order.notes ? order.notes + '\n' : '') + `DeekPay Status: Payment failed (code ${queryResult.rawStatus})`,
                },
                $push: {
                  statusHistory: {
                    status: 'cancelled',
                    actorRole: 'system',
                    note: `DeekPay payment reported as failed (code ${queryResult.rawStatus}).`,
                    createdAt: new Date(),
                  },
                },
              }
            );
            logger.info(`[DEEKPAY_RECONCILER_CANCELLED] Marked cancelled order ${order.orderNumber} via DeekPay status.`);
          }
        }
      } catch (err) {
        logger.debug(`DeekPay reconciler query failed for ${order.orderNumber}: ${err.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error running DeekPay reconciliation cron: ${error.message}`);
  }
};

const cancelAbandonedCheckouts = async () => {
  try {
    // Find orders that are older than 30 minutes
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const abandonedOrders = await Order.find({
      paymentStatus: 'pending',
      paymentMethod: { $in: ['payu', 'phonepe', 'airpay', 'deekpay'] },
      status: 'pending',
      createdAt: { $lte: thirtyMinutesAgo }
    });

    if (abandonedOrders.length === 0) return;

    logger.info(`Found ${abandonedOrders.length} abandoned checkouts to cancel.`);

    for (const order of abandonedOrders) {
      // Safety checks: NEVER cancel if paid, verified, or in a confirmed processing/completed state
      if (
        order.paymentStatus === 'paid' ||
        ['processing', 'shipped', 'delivered', 'completed'].includes(order.status) ||
        Boolean(order.paymentGateway?.verifiedAt) ||
        Boolean(order.paymentGateway?.airpayPaymentId) ||
        Boolean(order.paymentGateway?.deekpayOrderId) ||
        Boolean(order.paymentGateway?.deekpayUtr)
      ) {
        continue;
      }

      order.status = 'cancelled';
      order.paymentStatus = 'failed';
      order.cancelledAt = new Date();
      order.notes = (order.notes ? order.notes + '\n' : '') + 'System Auto-Cancel: Payment abandoned by user.';

      order.statusHistory.push({
        status: 'cancelled',
        actorRole: 'system',
        note: 'Payment abandoned by customer (No webhook received within 30 minutes).',
        createdAt: new Date(),
      });

      await order.save();
      logger.info(`Cancelled abandoned order: ${order.orderNumber}`);
    }
  } catch (error) {
    logger.error(`Error running abandoned checkouts cron: ${error.message}`);
  }
};

// Start the cron service
export const startCronJobs = () => {
  logger.info('Starting background cron jobs...');
  
  // Run immediately on startup
  reconcilePendingAirpayOrders();
  reconcilePendingDeekpayOrders();
  cancelAbandonedCheckouts();

  // Run Airpay and Deekpay status reconciliation every 30 seconds
  setInterval(() => {
    reconcilePendingAirpayOrders();
    reconcilePendingDeekpayOrders();
  }, 30 * 1000);

  // Run abandoned checkouts every 15 minutes (15 * 60 * 1000)
  setInterval(() => {
    cancelAbandonedCheckouts();
  }, 15 * 60 * 1000);
};
