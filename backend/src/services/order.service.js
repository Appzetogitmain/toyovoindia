import Coupon from '../models/Coupon.js';
import Product from '../models/Product.js';
import ShippingMethod from '../models/ShippingMethod.js';
import SiteConfig from '../models/SiteConfig.js';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';
import { getValidatedCouponResult } from './coupon.service.js';
import { jiopayService } from './jiopay.service.js';

const DEFAULT_SHIPPING_METHODS = {
  standard: { charge: 15, maxDays: 5 },
  express: { charge: 45, maxDays: 2 },
};

export const resolveOrderProduct = async (item) => {
  if (item.productId) {
    const productById = await Product.findOne({ _id: item.productId, status: 'active' }).populate('category', 'slug');
    if (productById) {
      return productById;
    }
  }

  if (item.slug) {
    return Product.findOne({ slug: item.slug, status: 'active' }).populate('category', 'slug');
  }

  return null;
};

export const buildOrderDraftFromCheckout = async (checkoutInput) => {
  const resolvedItems = await Promise.all(checkoutInput.items.map(async (item) => {
    const product = await resolveOrderProduct(item);
    if (!product) {
      throw new AppError('One or more products in your cart are unavailable', 400);
    }
    if (product.stock < item.quantity) {
      throw new AppError(`${product.name} is low on stock. Please reduce quantity and try again.`, 400);
    }

    return {
      product,
      quantity: item.quantity,
    };
  }));

  const items = resolvedItems.map(({ product, quantity }) => ({
    product: product._id,
    productName: product.name,
    productSlug: product.slug,
    sku: product.sku,
    image: product.thumbnail?.url || product.images?.[0]?.url || '',
    categorySlug: product.category?.slug || '',
    quantity,
    unitPrice: product.price,
    totalPrice: Number((product.price * quantity).toFixed(2)),
  }));

  const subtotal = Number(items.reduce((sum, item) => sum + item.totalPrice, 0).toFixed(2));
  const shippingMethodDoc = await ShippingMethod.findOne({
    code: String(checkoutInput.shippingMethod || 'standard').toLowerCase(),
    status: 'active',
  }).lean();
  const shippingFallback = DEFAULT_SHIPPING_METHODS[String(checkoutInput.shippingMethod || 'standard').toLowerCase()] || DEFAULT_SHIPPING_METHODS.standard;
  let shippingAmount = Number(shippingMethodDoc?.charge ?? shippingFallback.charge);
  const estimatedDeliveryDays = Number(shippingMethodDoc?.maxDays ?? shippingFallback.maxDays);

  const siteConfigDoc = await SiteConfig.findOne({ key: 'default' }).lean();
  const threshold = siteConfigDoc?.freeShippingThreshold ?? 999;
  if (subtotal >= threshold && String(checkoutInput.shippingMethod || 'standard').toLowerCase() === 'standard') {
    shippingAmount = 0;
  }

  let discountAmount = 0;
  let couponData;

  if (checkoutInput.couponCode) {
    const couponResult = await getValidatedCouponResult({
      code: checkoutInput.couponCode,
      subtotal,
      shippingAmount,
      categorySlugs: [...new Set(items.map((item) => item.categorySlug).filter(Boolean))],
    });

    discountAmount = couponResult.discountAmount;
    couponData = {
      code: couponResult.coupon.code,
      couponId: couponResult.coupon._id,
      title: couponResult.coupon.title,
      type: couponResult.coupon.type,
    };
  }

  const totalAmount = Number(Math.max(subtotal + shippingAmount - discountAmount, 0).toFixed(2));
  const estimatedDeliveryDate = new Date();
  estimatedDeliveryDate.setDate(estimatedDeliveryDate.getDate() + estimatedDeliveryDays);

  return {
    items,
    subtotal,
    shippingAmount,
    discountAmount,
    totalAmount,
    estimatedDeliveryDate,
    couponData,
    resolvedItems,
  };
};

export const applyFulfilledOrderSideEffects = async ({ resolvedItems, couponData }) => {
  await Promise.all(resolvedItems.map(async ({ product, quantity }) => {
    // Atomic update preventing stock from going below zero
    const result = await Product.updateOne(
      { _id: product._id, stock: { $gte: quantity } },
      {
        $inc: {
          stock: -quantity,
          soldCount: quantity,
        },
      }
    );
    
    // If modifiedCount is 0, it means stock was insufficient. 
    // In a production system, this would trigger an out-of-stock alert to admin for a manual refund/backorder,
    // but we strictly enforce no negative stock at the DB level here.
  }));

  if (couponData?.couponId) {
    await Coupon.updateOne({ _id: couponData.couponId }, { $inc: { usedCount: 1 } });
  }
};

// Called from every place this project auto-refunds a paid order (customer cancel,
// admin cancel, admin return-approval). No-ops for gateways other than JioPay so
// existing PayU/PhonePe/COD refund behaviour (a local status flip) is unchanged.
export const processGatewayRefund = async (order) => {
  if (order.paymentMethod !== 'jiopay') {
    return { attempted: false };
  }

  if (!order.paymentGateway?.jiopayTxnId) {
    throw new AppError('Cannot refund: JioPay transaction reference is missing for this order', 400);
  }

  const refundResult = await jiopayService.refund({
    originalTxnNo: order.paymentGateway.jiopayTxnId,
    amount: order.totalAmount,
  });

  const normalized = jiopayService.normalizeCommandStatus(refundResult);
  if (normalized !== 'success') {
    logger.error('JioPay refund did not succeed', { orderNumber: order.orderNumber, refundResult });
    throw new AppError(refundResult.respDescription || 'JioPay refund could not be processed. Please retry or check the JioPay dashboard.', 502);
  }

  order.paymentGateway.rawResponse = { ...(order.paymentGateway.rawResponse || {}), refund: refundResult };
  logger.info('JioPay refund processed successfully', { orderNumber: order.orderNumber, refundTxnId: refundResult.txnId });

  return { attempted: true, refundResult };
};

export const revertFulfilledOrderSideEffects = async ({ items, couponData }) => {
  await Promise.all((items || []).map((item) => Product.updateOne(
    { _id: item.product },
    {
      $inc: {
        stock: item.quantity,
        soldCount: -item.quantity,
      },
    }
  )));

  if (couponData?.couponId) {
    await Coupon.updateOne(
      { _id: couponData.couponId, usedCount: { $gt: 0 } },
      { $inc: { usedCount: -1 } }
    );
  }
};
