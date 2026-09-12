import Order from '../models/Order.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import { successResponse } from '../utils/apiResponse.js';
import { applyFulfilledOrderSideEffects, buildOrderDraftFromCheckout, revertFulfilledOrderSideEffects, processGatewayRefund } from '../services/order.service.js';
import { sendOrderConfirmationEmail, sendOrderStatusUpdateEmail } from '../services/email.service.js';
import { notifyOrderPlaced, notifyOrderStatusChanged, notifyDeliveryRescheduled, notifyOrderCancelled, notifyReturnRequested, notifyReturnStatusChanged } from '../services/notification.service.js';
import logger from '../utils/logger.js';

const STATUS_LABELS = {
  pending: 'Pending',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const PAYMENT_STATUS_LABELS = {
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
};

const PAYMENT_METHOD_LABELS = {
  card: 'Card',
  upi: 'UPI',
  netbanking: 'Net Banking',
  cod: 'Cash on Delivery',
  razorpay: 'Razorpay',
  payu: 'PayU',
  phonepe: 'PhonePe',
  jiopay: 'JioPay',
  airpay: 'Airpay',
};

const RETURN_STATUS_LABELS = {
  none: 'No Request',
  requested: 'Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  refunded: 'Refunded',
};

const formatOrderDate = (value) => new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
}).format(new Date(value));

const getDeliveryDate = (createdAt, shippingMethod, estimatedDeliveryDate) => {
  if (estimatedDeliveryDate) {
    return formatOrderDate(estimatedDeliveryDate);
  }
  const days = shippingMethod === 'express' ? 2 : 5;
  const date = new Date(createdAt);
  date.setDate(date.getDate() + days);
  return formatOrderDate(date);
};

const mapOrderItem = (item) => ({
  id: item.product?._id?.toString() || item.product?.toString(),
  title: item.productName,
  slug: item.productSlug || '',
  sku: item.sku || '',
  img: item.image || '',
  qty: item.quantity,
  price: item.unitPrice,
  total: item.totalPrice,
});

const mapOrder = (order) => ({
  ...order.toObject(),
  id: order._id.toString(),
  orderNumber: order.orderNumber,
  date: formatOrderDate(order.createdAt),
  statusLabel: STATUS_LABELS[order.status] || order.status,
  paymentStatusLabel: PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus,
  paymentMethodLabel: order.paymentGateway?.paymentMethodLabel || PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod,
  deliveryDate: getDeliveryDate(order.createdAt, order.shippingMethod, order.estimatedDeliveryDate),
  estimatedDeliveryDate: order.estimatedDeliveryDate,
  deliveryDelayReason: order.deliveryDelayReason || '',
  subtotal: order.subtotal,
  shipping: order.shippingAmount,
  discount: order.discountAmount,
  total: order.totalAmount,
  customerEmail: order.customer.email,
  trackingNumber: order.trackingNumber || '',
  returnRequest: {
    status: order.returnRequest?.status || 'none',
    statusLabel: RETURN_STATUS_LABELS[order.returnRequest?.status || 'none'],
    reason: order.returnRequest?.reason || '',
    adminNote: order.returnRequest?.adminNote || '',
    requestedAt: order.returnRequest?.requestedAt || null,
    reviewedAt: order.returnRequest?.reviewedAt || null,
  },
  items: order.items.map(mapOrderItem),
  customerName: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
  destination: `${order.shippingAddress.city === 'Other' ? order.shippingAddress.district : order.shippingAddress.city}, ${order.shippingAddress.state}`,
});

const mapOrderSummary = (order) => ({
  ...order.toObject(),
  id: order._id.toString(),
  orderNumber: order.orderNumber,
  date: formatOrderDate(order.createdAt),
  status: order.status,
  statusLabel: STATUS_LABELS[order.status] || order.status,
  total: order.totalAmount,
  subtotal: order.subtotal,
  shipping: order.shippingAmount,
  discount: order.discountAmount,
  itemsCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
  items: order.items.map(mapOrderItem),
  paymentStatus: order.paymentStatus,
  paymentStatusLabel: PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus,
  paymentMethodLabel: order.paymentGateway?.paymentMethodLabel || PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod,
  customerName: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
  customerEmail: order.customer.email,
  user: order.user ? order.user.toString() : null,
  destination: `${order.shippingAddress.city === 'Other' ? order.shippingAddress.district : order.shippingAddress.city}, ${order.shippingAddress.state}`,
  createdAt: order.createdAt,
  returnRequest: {
    status: order.returnRequest?.status || 'none',
    statusLabel: RETURN_STATUS_LABELS[order.returnRequest?.status || 'none'],
  },
  deliveryDate: getDeliveryDate(order.createdAt, order.shippingMethod, order.estimatedDeliveryDate),
  estimatedDeliveryDate: order.estimatedDeliveryDate,
  deliveryDelayReason: order.deliveryDelayReason || '',
});

const appendStatusHistory = (order, status, actorRole, note) => {
  order.statusHistory.push({
    status,
    actorRole,
    note,
    createdAt: new Date(),
  });
};

const CANCELLABLE_STATUSES = new Set(['pending', 'processing']);

export const createOrder = asyncHandler(async (req, res, next) => {
  const draft = await buildOrderDraftFromCheckout(req.body);

  const order = await Order.create({
    user: req.user?._id || null,
    customer: {
      ...req.body.customer,
      email: req.body.customer.email.toLowerCase(),
    },
    shippingAddress: req.body.shippingAddress,
    items: draft.items,
    status: 'processing',
    paymentStatus: 'paid',
    paymentMethod: req.body.paymentMethod,
    shippingMethod: req.body.shippingMethod,
    estimatedDeliveryDate: draft.estimatedDeliveryDate,
    subtotal: draft.subtotal,
    shippingAmount: draft.shippingAmount,
    discountAmount: draft.discountAmount,
    totalAmount: draft.totalAmount,
    coupon: draft.couponData,
    notes: req.body.notes || undefined,
  });

  await applyFulfilledOrderSideEffects({
    resolvedItems: draft.resolvedItems,
    couponData: draft.couponData,
  });

  Promise.resolve(sendOrderConfirmationEmail(order)).catch((error) => {
    logger.warn(`Order confirmation email failed for ${order.orderNumber}: ${error.message}`);
  });

  // Push notification
  Promise.resolve(notifyOrderPlaced(order)).catch(() => {});

  return successResponse(res, 201, 'Order placed successfully', mapOrder(order));
});

export const listMyOrders = asyncHandler(async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Math.min(Number(req.query.limit || 10), 50);
  const skip = (page - 1) * limit;

  const filter = { user: req.user._id };

  // Explicitly hide abandoned checkouts (pending payu/phonepe) from user view
  filter.$or = [
    { paymentMethod: { $nin: ['payu', 'phonepe'] } },
    { paymentMethod: { $in: ['payu', 'phonepe'] }, paymentStatus: { $ne: 'pending' } }
  ];

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);

  return successResponse(
    res,
    200,
    'Orders fetched successfully',
    orders.map(mapOrder),
    { page, limit, total, totalPages: Math.ceil(total / limit) }
  );
});

export const getMyOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  return successResponse(res, 200, 'Order details fetched successfully', mapOrder(order));
});

export const cancelMyOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  if (!CANCELLABLE_STATUSES.has(order.status)) {
    return next(new AppError('This order can no longer be cancelled', 400));
  }

  const previousStatus = order.status;
  order.status = 'cancelled';
  order.cancelledAt = new Date();

  appendStatusHistory(
    order,
    'cancelled',
    'customer',
    req.body.reason || `Order cancelled by customer from ${previousStatus}`
  );

  if (order.paymentStatus === 'paid') {
    await processGatewayRefund(order);
    order.paymentStatus = 'refunded';
    appendStatusHistory(
      order,
      'Refunded',
      'system',
      `Auto-refund of ₹${order.totalAmount} processed for cancelled prepaid order.`
    );
    // Only revert stock if it was actually paid and deducted
    await revertFulfilledOrderSideEffects({
      items: order.items,
      couponData: order.coupon,
    });
  }

  await order.save();

  // Push notification
  Promise.resolve(notifyOrderCancelled(order)).catch(() => {});

  return successResponse(res, 200, 'Order cancelled successfully', mapOrder(order));
});

export const requestMyOrderReturn = asyncHandler(async (req, res, next) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  if (order.status !== 'delivered') {
    return next(new AppError('Return requests are allowed only for delivered orders', 400));
  }

  if (order.paymentStatus !== 'paid') {
    return next(new AppError('Only paid orders can have a refund request', 400));
  }

  if (order.returnRequest?.status && order.returnRequest.status !== 'none' && order.returnRequest.status !== 'rejected') {
    return next(new AppError('A return request already exists for this order', 400));
  }

  order.returnRequest = {
    status: 'requested',
    reason: req.body.reason.trim(),
    adminNote: '',
    requestedAt: new Date(),
    reviewedAt: null,
  };

  appendStatusHistory(order, 'Pending Return', 'customer', 'pending return order created');
  await order.save();

  // Push notification
  Promise.resolve(notifyReturnRequested(order)).catch(() => {});

  return successResponse(res, 200, 'Return request submitted successfully', mapOrder(order));
});

export const getOrderSummary = asyncHandler(async (req, res, next) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber });
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  const isGuestOrder = !order.user;
  const matchesEmail = req.query.email && order.customer?.email && (order.customer.email.toLowerCase() === req.query.email.trim().toLowerCase());
  const matchesUser = req.user && order.user && (order.user.toString() === req.user._id.toString());
  const isAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const isRecentlyPaid = order.paymentStatus === 'paid' && (Date.now() - new Date(order.updatedAt || order.createdAt).getTime() < 24 * 60 * 60 * 1000);

  const canAccess = isAdmin || matchesUser || matchesEmail || isGuestOrder || isRecentlyPaid;

  if (!canAccess) {
    return next(new AppError('You are not allowed to view this order summary', 403));
  }

  return successResponse(res, 200, 'Order summary fetched successfully', mapOrder(order));
});

export const adminListOrders = asyncHandler(async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Math.min(Number(req.query.limit || 20), 10000);
  const skip = (page - 1) * limit;
  const filter = {};

  if (req.query.status) {
    filter.status = req.query.status;
  }
  if (req.query.paymentStatus) {
    filter.paymentStatus = req.query.paymentStatus;
  }
  if (req.query.search) {
    const cleanSearch = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (cleanSearch) {
      filter.$or = [
        { orderNumber: new RegExp(cleanSearch, 'i') },
        { 'customer.firstName': new RegExp(cleanSearch, 'i') },
        { 'customer.lastName': new RegExp(cleanSearch, 'i') },
        { 'customer.email': new RegExp(cleanSearch, 'i') },
      ];
    }
  }

  // Explicitly hide abandoned checkouts from the admin default view unless explicitly filtering by pending
  if (!req.query.status && !req.query.paymentStatus) {
    if (!filter.$or) filter.$or = [];
    if (filter.$or.length === 0) {
      filter.$or = [
        { paymentMethod: { $nin: ['payu', 'phonepe'] } },
        { paymentMethod: { $in: ['payu', 'phonepe'] }, paymentStatus: { $ne: 'pending' } }
      ];
    } else {
      // If there's already an $or (like search), we wrap it in an $and to combine logic safely
      const existingOr = filter.$or;
      delete filter.$or;
      filter.$and = [
        { $or: existingOr },
        {
          $or: [
            { paymentMethod: { $nin: ['payu', 'phonepe'] } },
            { paymentMethod: { $in: ['payu', 'phonepe'] }, paymentStatus: { $ne: 'pending' } }
          ]
        }
      ];
    }
  }

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);

  return successResponse(
    res,
    200,
    'Admin orders fetched successfully',
    orders.map(mapOrderSummary),
    { page, limit, total, totalPages: Math.ceil(total / limit) }
  );
});

export const adminGetOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id).populate('user', 'firstName lastName email createdAt');
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  return successResponse(res, 200, 'Admin order details fetched successfully', mapOrder(order));
});

export const adminUpdateOrderStatus = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id);
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  const previousStatus = order.status;
  if (previousStatus === 'cancelled' && req.body.status !== 'cancelled') {
    return next(new AppError('Cancelled orders cannot be reopened from this flow', 400));
  }
  if (previousStatus === 'delivered' && req.body.status === 'cancelled') {
    return next(new AppError('Delivered orders cannot be cancelled', 400));
  }

  order.status = req.body.status;

  if (req.body.paymentStatus) {
    order.paymentStatus = req.body.paymentStatus;
  }
  if (req.body.trackingNumber !== undefined) {
    order.trackingNumber = req.body.trackingNumber || undefined;
  }
  if (req.body.estimatedDeliveryDate !== undefined) {
    if (!req.body.estimatedDeliveryDate) {
      order.estimatedDeliveryDate = undefined;
      order.deliveryDelayReason = '';
    } else {
      const createdAtStart = new Date(order.createdAt);
      createdAtStart.setHours(0, 0, 0, 0);
      const requestedDate = new Date(req.body.estimatedDeliveryDate);
      requestedDate.setHours(0, 0, 0, 0);

      if (Number.isNaN(requestedDate.getTime())) {
        return next(new AppError('Estimated delivery date is invalid', 400));
      }

      if (requestedDate < createdAtStart) {
        return next(new AppError('Estimated delivery date cannot be earlier than the order date', 400));
      }

      const currentDate = order.estimatedDeliveryDate ? new Date(order.estimatedDeliveryDate) : null;
      if (currentDate) {
        currentDate.setHours(0, 0, 0, 0);
      }

      const isDateChanging = currentDate && currentDate.getTime() !== requestedDate.getTime();
      if (isDateChanging && !req.body.deliveryDelayReason?.trim()) {
        return next(new AppError('A reason is required when updating the delivery date', 400));
      }

      order.estimatedDeliveryDate = requestedDate;
      order.deliveryDelayReason = req.body.deliveryDelayReason?.trim() || '';
    }
  } else if (req.body.deliveryDelayReason !== undefined) {
    order.deliveryDelayReason = req.body.deliveryDelayReason?.trim() || '';
  }
  if (req.body.status === 'delivered') {
    order.deliveredAt = new Date();
  }
  if (req.body.status === 'cancelled') {
    order.cancelledAt = new Date();
    if (previousStatus !== 'cancelled') {
      if (order.paymentStatus === 'paid') {
        await processGatewayRefund(order);
        // Only revert stock if it was actually paid and deducted
        await revertFulfilledOrderSideEffects({
          items: order.items,
          couponData: order.coupon,
        });
        order.paymentStatus = 'refunded';
        appendStatusHistory(
          order,
          'Refunded',
          'system',
          `Auto-refund of ₹${order.totalAmount} processed for cancelled prepaid order.`
        );
      }
    }
  }
  if (previousStatus !== req.body.status || req.body.note) {
    appendStatusHistory(
      order,
      req.body.status,
      req.user.role,
      req.body.note || `Status updated from ${previousStatus} to ${req.body.status}`
    );
  }
  if (req.body.estimatedDeliveryDate !== undefined && req.body.deliveryDelayReason?.trim()) {
    appendStatusHistory(
      order,
      order.status,
      req.user.role,
      `Delivery date updated to ${formatOrderDate(order.estimatedDeliveryDate)}: ${req.body.deliveryDelayReason.trim()}`
    );
  }

  await order.save();

  const shouldSendUpdateEmail = (
    previousStatus !== order.status ||
    req.body.trackingNumber !== undefined ||
    req.body.estimatedDeliveryDate !== undefined ||
    req.body.note
  );

  if (shouldSendUpdateEmail) {
    Promise.resolve(sendOrderStatusUpdateEmail(order, {
      note: req.body.note?.trim() || '',
      deliveryDelayReason: req.body.deliveryDelayReason?.trim() || '',
    })).catch(() => {
      // Email failure must not block order operations.
    })
  }

  // Push notifications
  if (previousStatus !== order.status) {
    Promise.resolve(notifyOrderStatusChanged(order, previousStatus)).catch(() => {});
  }
  if (req.body.estimatedDeliveryDate !== undefined && req.body.deliveryDelayReason?.trim()) {
    Promise.resolve(notifyDeliveryRescheduled(order, req.body.deliveryDelayReason.trim())).catch(() => {});
  }

  return successResponse(res, 200, 'Order status updated successfully', mapOrder(order));
});

export const adminUpdateOrderReturnRequest = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id);
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  if (!order.returnRequest || order.returnRequest.status === 'none') {
    return next(new AppError('No return request exists for this order', 400));
  }

  const nextStatus = req.body.status;
  const previousReturnStatus = order.returnRequest.status;
  const previousAdminNote = order.returnRequest.adminNote || '';
  const newAdminNote = req.body.adminNote?.trim() || '';

  order.returnRequest.status = nextStatus;
  order.returnRequest.adminNote = newAdminNote;
  order.returnRequest.reviewedAt = new Date();

  if (nextStatus === 'refunded' && previousReturnStatus !== 'refunded') {
    await processGatewayRefund(order);
    order.paymentStatus = 'refunded';
    await revertFulfilledOrderSideEffects({
      items: order.items,
      couponData: order.coupon,
    });
  }

  if (previousReturnStatus !== nextStatus || previousAdminNote !== newAdminNote) {
    const displayStatus = nextStatus === 'requested' ? 'Pending Return' : `Refund ${nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)}`;
    const displayNote = nextStatus === 'requested' 
      ? 'pending return order created' 
      : `Return request marked ${nextStatus}${newAdminNote ? `: ${newAdminNote}` : ''}`;

    appendStatusHistory(
      order,
      displayStatus,
      req.user.role,
      displayNote
    );
  }

  await order.save();

  // Push notification
  Promise.resolve(notifyReturnStatusChanged(order)).catch(() => {});

  return successResponse(res, 200, 'Return request updated successfully', mapOrder(order));
});

export const getRevenueStats = asyncHandler(async (req, res) => {
  const { timeframe = 'monthly' } = req.query;
  
  let groupStage = {};
  let sortStage = { "_id.year": -1 };

  if (timeframe === 'yearly') {
    groupStage = { year: { $year: "$createdAt" } };
  } else if (timeframe === 'weekly') {
    groupStage = { 
      year: { $year: "$createdAt" },
      week: { $week: "$createdAt" }
    };
    sortStage = { "_id.year": -1, "_id.week": -1 };
  } else {
    // default: monthly
    groupStage = { 
      year: { $year: "$createdAt" },
      month: { $month: "$createdAt" }
    };
    sortStage = { "_id.year": -1, "_id.month": -1 };
  }

  const stats = await Order.aggregate([
    {
      $match: {
        paymentStatus: 'paid',
        status: { $ne: 'cancelled' }
      }
    },
    {
      $group: {
        _id: groupStage,
        revenue: { $sum: "$totalAmount" },
        count: { $sum: 1 }
      }
    },
    {
      $sort: sortStage
    }
  ]);

  const formattedStats = stats.map(item => {
    let label = '';
    if (timeframe === 'yearly') {
      label = `Year ${item._id.year}`;
    } else if (timeframe === 'weekly') {
      label = `Week ${item._id.week + 1}, ${item._id.year}`;
    } else {
      label = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(item._id.year, item._id.month - 1));
    }

    return {
      ...item._id,
      revenue: item.revenue,
      orderCount: item.count,
      label
    };
  });

  return successResponse(res, 200, 'Revenue stats fetched successfully', formattedStats);
});
