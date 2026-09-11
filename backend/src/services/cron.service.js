import Order from '../models/Order.js';
import logger from '../utils/logger.js';
import { airpayService } from './airpay.service.js';
import { processSuccessfulPayment } from '../controllers/payment.controller.js';
import { revertFulfilledOrderSideEffects } from './order.service.js';

const reconcilePendingAirpayOrders = async () => {
  try {
    // Check pending Airpay orders created in the last 2 hours, that are at least 15 seconds old
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const fifteenSecondsAgo = new Date(Date.now() - 15 * 1000);

    const pendingOrders = await Order.find({
      paymentStatus: 'pending',
      paymentMethod: 'airpay',
      status: 'pending',
      createdAt: { $gte: twoHoursAgo, $lte: fifteenSecondsAgo },
    }).limit(20);

    if (pendingOrders.length === 0) return;

    for (const order of pendingOrders) {
      const airpayTxnId = order.paymentGateway?.airpayTxnId || order.orderNumber;
      if (!airpayTxnId) continue;

      try {
        const statusData = await airpayService.checkStatus(airpayTxnId);
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
              logger.info(`[AIRPAY_RECONCILER_SUCCESS] Reconciled pending order ${order.orderNumber} via Airpay verify.php`);
            }
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

const cancelAbandonedCheckouts = async () => {
  try {
    // Find orders that are older than 30 minutes
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const abandonedOrders = await Order.find({
      paymentStatus: 'pending',
      paymentMethod: { $in: ['payu', 'phonepe'] },
      status: 'pending',
      createdAt: { $lte: thirtyMinutesAgo }
    });

    if (abandonedOrders.length === 0) return;

    logger.info(`Found ${abandonedOrders.length} abandoned checkouts to cancel.`);

    for (const order of abandonedOrders) {
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
  cancelAbandonedCheckouts();

  // Run Airpay status reconciliation every 30 seconds
  setInterval(() => {
    reconcilePendingAirpayOrders();
  }, 30 * 1000);

  // Run abandoned checkouts every 15 minutes (15 * 60 * 1000)
  setInterval(() => {
    cancelAbandonedCheckouts();
  }, 15 * 60 * 1000);
};
