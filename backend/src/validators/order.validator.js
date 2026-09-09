import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const optionalString = z.string().trim().optional().or(z.literal(''));

const checkoutItemSchema = z.object({
  productId: objectId.optional(),
  slug: z.string().trim().min(1).optional(),
  quantity: z.coerce.number().int().min(1).max(20),
});

const shippingAddressSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  address: z.string().trim().min(3).max(200),
  apartment: optionalString,
  city: z.string().trim().min(1).max(80),
  district: optionalString,
  state: z.string().trim().min(1).max(80),
  country: z.string().trim().min(1).max(80).default('India'),
  postalCode: z.string().trim().min(3).max(20),
  phone: z.string().trim().min(8).max(20),
});

export const createOrderSchema = z.object({
  body: z.object({
    customer: z.object({
      firstName: z.string().trim().min(1).max(80),
      lastName: z.string().trim().min(1).max(80),
      email: z.string().trim().email(),
      phone: z.string().trim().min(8).max(20),
    }),
    shippingAddress: shippingAddressSchema,
    items: z.array(checkoutItemSchema).min(1),
    shippingMethod: z.string().trim().min(1).max(40).default('standard'),
    paymentMethod: z.enum(['card', 'upi', 'netbanking', 'cod', 'payu', 'phonepe', 'jiopay', 'airpay']).default('card'),
    couponCode: optionalString,
    notes: optionalString,
  }),
});

export const listMyOrdersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
});

export const orderIdParamSchema = z.object({
  params: z.object({
    id: objectId,
  }),
});

export const cancelMyOrderSchema = z.object({
  params: z.object({
    id: objectId,
  }),
  body: z.object({
    reason: optionalString,
  }),
});

export const requestReturnSchema = z.object({
  params: z.object({
    id: objectId,
  }),
  body: z.object({
    reason: z.string().trim().min(5).max(500),
  }),
});

export const orderSummaryParamSchema = z.object({
  params: z.object({
    orderNumber: z.string().trim().min(8).max(40),
  }),
  query: z.object({
    email: z.string().trim().email().optional(),
  }),
});

export const adminListOrdersSchema = z.object({
  query: z.object({
    search: optionalString,
    status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']).optional().or(z.literal('')),
    paymentStatus: z.enum(['pending', 'paid', 'failed', 'refunded']).optional().or(z.literal('')),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(10000).optional(),
  }),
});

export const adminUpdateOrderStatusSchema = z.object({
  params: z.object({
    id: objectId,
  }),
  body: z.object({
    status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']),
    note: optionalString,
    trackingNumber: optionalString,
    paymentStatus: z.enum(['pending', 'paid', 'failed', 'refunded']).optional(),
    estimatedDeliveryDate: z.string().datetime().optional().or(z.literal('')),
    deliveryDelayReason: optionalString,
  }),
});

export const adminUpdateReturnRequestSchema = z.object({
  params: z.object({
    id: objectId,
  }),
  body: z.object({
    status: z.enum(['requested', 'approved', 'rejected', 'refunded']),
    adminNote: optionalString,
  }),
});
