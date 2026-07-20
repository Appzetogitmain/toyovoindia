import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  productName: {
    type: String,
    required: true,
    trim: true,
  },
  productSlug: {
    type: String,
    trim: true,
  },
  sku: {
    type: String,
    trim: true,
  },
  image: {
    type: String,
    trim: true,
  },
  categorySlug: {
    type: String,
    trim: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1'],
  },
  unitPrice: {
    type: Number,
    required: true,
    min: [0, 'Unit price cannot be negative'],
  },
  totalPrice: {
    type: Number,
    required: true,
    min: [0, 'Total price cannot be negative'],
  },
}, { _id: false });

const orderStatusEventSchema = new mongoose.Schema({
  status: {
    type: String,
    required: true,
    trim: true,
  },
  note: {
    type: String,
    trim: true,
    maxlength: [240, 'Status note cannot exceed 240 characters'],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  actorRole: {
    type: String,
    enum: ['system', 'customer', 'admin', 'super_admin'],
    default: 'system',
  },
}, { _id: false });

const returnRequestSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['none', 'requested', 'approved', 'rejected', 'refunded'],
    default: 'none',
  },
  reason: {
    type: String,
    trim: true,
    maxlength: [500, 'Return reason cannot exceed 500 characters'],
  },
  adminNote: {
    type: String,
    trim: true,
    maxlength: [500, 'Admin note cannot exceed 500 characters'],
  },
  requestedAt: Date,
  reviewedAt: Date,
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    index: true,
    trim: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  customer: {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
  },
  shippingAddress: {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    apartment: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      required: true,
      trim: true,
    },
    district: {
      type: String,
      trim: true,
    },
    state: {
      type: String,
      required: true,
      trim: true,
    },
    country: {
      type: String,
      required: true,
      trim: true,
      default: 'India',
    },
    postalCode: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
  },
  items: {
    type: [orderItemSchema],
    validate: {
      validator: (items) => Array.isArray(items) && items.length > 0,
      message: 'Order must contain at least one item',
    },
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'processing',
    index: true,
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'paid',
    index: true,
  },
  paymentMethod: {
    type: String,
    enum: ['card', 'upi', 'netbanking', 'cod', 'payu', 'phonepe'],
    default: 'card',
  },
  shippingMethod: {
    type: String,
    trim: true,
    lowercase: true,
    default: 'standard',
  },
  currency: {
    type: String,
    default: 'INR',
    trim: true,
  },
  subtotal: {
    type: Number,
    required: true,
    min: [0, 'Subtotal cannot be negative'],
  },
  shippingAmount: {
    type: Number,
    required: true,
    min: [0, 'Shipping amount cannot be negative'],
  },
  discountAmount: {
    type: Number,
    default: 0,
    min: [0, 'Discount amount cannot be negative'],
  },
  totalAmount: {
    type: Number,
    required: true,
    min: [0, 'Total amount cannot be negative'],
  },
  coupon: {
    code: {
      type: String,
      trim: true,
      uppercase: true,
    },
    couponId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon',
    },
    title: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      trim: true,
    },
  },
  paymentGateway: {
    provider: {
      type: String,
      enum: ['payu', 'phonepe'],
    },
    payuTxnId: {
      type: String,
      trim: true,
      index: true,
      sparse: true,
    },
    phonepeTxnId: {
      type: String,
      trim: true,
      index: true,
      sparse: true,
    },
    payuMihpayid: {
      type: String,
      trim: true,
      index: true,
      sparse: true,
    },
    payuHash: {
      type: String,
      trim: true,
    },
    rawResponse: {
      type: mongoose.Schema.Types.Mixed,
    },
    paymentMethodLabel: {
      type: String,
      trim: true,
    },
    verifiedAt: Date,
    lastWebhookEvent: {
      type: String,
      trim: true,
    },
    lastWebhookAt: Date,
  },
  financialDetails: {
    bankName: String,
    cardType: String,
    networkType: String,
    issuingBank: String,
    settlementAmount: Number,
    transactionFee: Number,
    cgst: Number,
    sgst: Number,
    igst: Number,
    utr: String,
    errorCode: String,
  },
  platform: {
    type: String,
    enum: ['web', 'app'],
    default: 'web',
    index: true,
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Order note cannot exceed 500 characters'],
  },
  trackingNumber: {
    type: String,
    trim: true,
  },
  estimatedDeliveryDate: Date,
  deliveryDelayReason: {
    type: String,
    trim: true,
    maxlength: [240, 'Delivery delay reason cannot exceed 240 characters'],
  },
  deliveredAt: Date,
  cancelledAt: Date,
  returnRequest: {
    type: returnRequestSchema,
    default: () => ({ status: 'none' }),
  },
  statusHistory: {
    type: [orderStatusEventSchema],
    default: [],
  },
}, {
  timestamps: true,
});

orderSchema.pre('validate', function() {
  if (!this.orderNumber) {
    const timePart = Date.now().toString().slice(-4);
    const randomPart = Math.random().toString().slice(2, 6);
    this.orderNumber = `TYV-${timePart}${randomPart}`;
  }

  if (!this.statusHistory.length) {
    this.statusHistory = [{
      status: this.status,
      note: 'Order created',
      actorRole: 'system',
      createdAt: new Date(),
    }];
  }

  if (!this.estimatedDeliveryDate) {
    const baseDate = this.createdAt ? new Date(this.createdAt) : new Date();
    const days = this.shippingMethod === 'express' ? 2 : 5;
    baseDate.setDate(baseDate.getDate() + days);
    this.estimatedDeliveryDate = baseDate;
  }
});

orderSchema.index({ orderNumber: 1, createdAt: -1 });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ 'customer.email': 1, createdAt: -1 });

const Order = mongoose.model('Order', orderSchema);
export default Order;
