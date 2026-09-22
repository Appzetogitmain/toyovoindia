import nodemailer from 'nodemailer';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import Order from '../models/Order.js';

let transporter;

// In-memory concurrency locks to prevent race conditions on simultaneous webhooks/status transitions
const sendingConfirmationLocks = new Set();
const sendingDeliveredLocks = new Set();

const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
};

const escapeHtml = (str) => {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const formatDate = (value) => {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

const PAYMENT_METHOD_LABELS = {
  card: 'Credit / Debit Card',
  upi: 'UPI',
  netbanking: 'Net Banking',
  cod: 'Cash on Delivery',
  razorpay: 'Razorpay',
  payu: 'PayU',
  phonepe: 'PhonePe',
  jiopay: 'JioPay',
  airpay: 'Airpay',
  deekpay: 'DeekPay',
};

const PAYMENT_STATUS_LABELS = {
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
};

const maskEmail = (email) => {
  if (!email || typeof email !== 'string') return 'N/A';
  const parts = email.trim().split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length <= 2 ? `${name[0]}***` : `${name.slice(0, 2)}***${name.slice(-1)}`;
  return `${maskedName}@${domain}`;
};

const resolveCustomerEmail = async (order) => {
  let email = (order.customer?.email || order.shippingAddress?.email || '')?.trim();
  if (!email && order.user) {
    if (typeof order.user === 'object' && order.user.email) {
      email = order.user.email.trim();
    } else if (typeof order.user === 'string' || (order.user && order.user._id)) {
      try {
        const userId = order.user._id || order.user;
        const userDoc = await mongoose.model('User').findById(userId).select('email firstName lastName').lean();
        if (userDoc?.email) {
          email = userDoc.email.trim();
        }
      } catch (err) {
        // Safe fallback
      }
    }
  }
  return email;
};

const getSmtpConfig = () => {
  const host = process.env.SMTP_HOST || env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || env.SMTP_PORT) || 587;
  const user = (process.env.SMTP_USER || process.env.EMAIL_USER || env.SMTP_USER || '').trim();
  const rawPass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || env.SMTP_PASS || '').trim();
  const pass = rawPass.replace(/\s+/g, '');
  const from = (process.env.SMTP_FROM || env.SMTP_FROM || user || 'toyovoindia@gmail.com').trim();
  return { host, port, user, pass, from };
};

const canSendEmail = () => {
  const { host, user, pass } = getSmtpConfig();
  return Boolean(host && user && pass);
};

const getTransporter = () => {
  const config = getSmtpConfig();
  if (!canSendEmail()) {
    logger.warn('[ORDER EMAIL] Skipped - SMTP not configured. Missing SMTP_USER or SMTP_PASS in environment.');
    return null;
  }

  if (!transporter) {
    try {
      logger.info('Creating new SMTP transporter', { user: config.user, host: config.host });
      if (config.host && config.host !== 'smtp.gmail.com' && config.host !== 'gmail') {
        transporter = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.port === 465,
          auth: {
            user: config.user,
            pass: config.pass,
          },
        });
      } else {
        transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: config.user,
            pass: config.pass,
          },
        });
      }
    } catch (error) {
      logger.error('[ORDER EMAIL] Failed to create transporter', { error: error.message });
      return null;
    }
  }

  return transporter;
};

export const _resetTransporter = () => {
  transporter = null;
};

const currency = (amount) => `₹${Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const buildBaseTemplate = (content, title) => `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8">
      <style>
        .container { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #f0f0f0; border-radius: 16px; overflow: hidden; }
        .header { background: #6651A4; padding: 30px; text-align: center; color: white; }
        .header h1 { margin: 0; font-size: 24px; letter-spacing: 1px; }
        .content { padding: 30px; line-height: 1.6; }
        .card { background: #f9f9f9; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #eee; }
        .footer { background: #f4f4f4; padding: 20px; text-align: center; font-size: 12px; color: #888; }
        .btn { display: inline-block; padding: 12px 24px; background: #F1641E; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px; }
        .item-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .item-table th { text-align: left; border-bottom: 2px solid #6651A4; padding-bottom: 10px; font-size: 13px; text-transform: uppercase; color: #6651A4; }
        .item-table td { padding: 12px 0; border-bottom: 1px solid #eee; font-size: 14px; }
        .summary-table { width: 100%; margin-top: 15px; }
        .summary-table td { padding: 4px 0; font-size: 14px; }
        .total-row { font-weight: bold; font-size: 18px; color: #6651A4; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Toyovo India</h1>
          <p style="margin: 5px 0 0; opacity: 0.8; font-size: 12px; text-transform: uppercase; letter-spacing: 2px;">Premium Kids Wear &amp; Toys</p>
        </div>
        <div class="content">
          ${content}
        </div>
        <div class="footer">
          <p><strong>Toyovo India</strong><br/>Email: toyovoindia@gmail.com | Web: toyovo.in</p>
          <p>&copy; 2026 Toyovo India. All rights reserved.</p>
        </div>
      </div>
    </body>
  </html>
`;

export const buildOrderConfirmationHtml = (order, isAdmin = false) => {
  const items = (order.items || [])
    .map((item) => `<tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #eee; font-size: 14px;">
        <strong>${escapeHtml(item.productName)}</strong>
        ${item.sku ? `<br/><span style="font-size: 11px; color: #777;">SKU: ${escapeHtml(item.sku)}</span>` : ''}
      </td>
      <td style="text-align:center; padding: 12px 0; border-bottom: 1px solid #eee; font-size: 14px;">${item.quantity}</td>
      <td style="text-align:right; padding: 12px 0; border-bottom: 1px solid #eee; font-size: 14px;">${currency(item.unitPrice)}</td>
      <td style="text-align:right; padding: 12px 0; border-bottom: 1px solid #eee; font-size: 14px; font-weight: bold;">${currency(item.totalPrice)}</td>
    </tr>`)
    .join('');

  const customerName = `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim() || 'Valued Customer';
  const paymentMethodLabel = order.paymentGateway?.paymentMethodLabel || PAYMENT_METHOD_LABELS[order.paymentMethod] || (order.paymentMethod || '').toUpperCase();
  const paymentStatusLabel = PAYMENT_STATUS_LABELS[order.paymentStatus] || (order.paymentStatus || '').toUpperCase();
  const orderDateFormatted = formatDate(order.createdAt || new Date());
  const deliveryDateFormatted = order.estimatedDeliveryDate ? formatDate(order.estimatedDeliveryDate) : null;

  const content = `
    <h2 style="color: #6651A4; margin-top: 0; font-size: 22px;">${isAdmin ? 'New Order Alert' : 'Order Confirmed'}</h2>
    <p>Hello ${isAdmin ? 'Admin' : escapeHtml(order.customer?.firstName || 'Customer')},</p>
    <p>${isAdmin 
      ? `A new order has been placed by <strong>${escapeHtml(customerName)}</strong>.` 
      : 'Your order has been successfully placed and confirmed. Thank you for shopping with Toyovo India!'}</p>
    
    <div class="card">
      <p style="margin: 0 0 8px;"><strong>Order Number:</strong> #${escapeHtml(order.orderNumber)}</p>
      <p style="margin: 0 0 8px;"><strong>Order Date:</strong> ${orderDateFormatted}</p>
      <p style="margin: 0 0 8px;"><strong>Payment Method:</strong> ${escapeHtml(paymentMethodLabel)}</p>
      <p style="margin: 0 0 8px;"><strong>Payment Status:</strong> <span style="color: ${order.paymentStatus === 'paid' ? '#10b981' : '#F1641E'}; font-weight: bold;">${escapeHtml(paymentStatusLabel)}</span></p>
      <p style="margin: 0 0 8px;"><strong>Order Status:</strong> <span style="color: #6651A4; font-weight: bold; text-transform: uppercase;">${escapeHtml(order.status || 'processing')}</span></p>
      ${deliveryDateFormatted ? `<p style="margin: 0;"><strong>Estimated Delivery:</strong> ${deliveryDateFormatted}</p>` : ''}
    </div>

    <table class="item-table" style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <thead>
        <tr>
          <th style="text-align: left; border-bottom: 2px solid #6651A4; padding-bottom: 10px; font-size: 13px; text-transform: uppercase; color: #6651A4;">Product</th>
          <th style="text-align: center; border-bottom: 2px solid #6651A4; padding-bottom: 10px; font-size: 13px; text-transform: uppercase; color: #6651A4;">Qty</th>
          <th style="text-align: right; border-bottom: 2px solid #6651A4; padding-bottom: 10px; font-size: 13px; text-transform: uppercase; color: #6651A4;">Price</th>
          <th style="text-align: right; border-bottom: 2px solid #6651A4; padding-bottom: 10px; font-size: 13px; text-transform: uppercase; color: #6651A4;">Total</th>
        </tr>
      </thead>
      <tbody>${items}</tbody>
    </table>

    <table class="summary-table" style="width: 100%; margin-top: 15px;">
      <tr><td style="padding: 4px 0; font-size: 14px;">Subtotal:</td><td style="text-align:right; font-size: 14px;">${currency(order.subtotal)}</td></tr>
      <tr>
        <td style="padding: 4px 0; font-size: 14px;">Shipping Charges:</td>
        <td style="text-align:right; font-size: 14px;">${order.shippingAmount > 0 ? currency(order.shippingAmount) : '<span style="color: #10b981; font-weight: bold;">FREE</span>'}</td>
      </tr>
      ${order.discountAmount > 0 ? `<tr><td style="padding: 4px 0; font-size: 14px; color: #10b981;">Discount${order.coupon?.code ? ` (${escapeHtml(order.coupon.code)})` : ''}:</td><td style="text-align:right; font-size: 14px; color: #10b981; font-weight: bold;">-${currency(order.discountAmount)}</td></tr>` : ''}
      <tr class="total-row"><td style="padding: 10px 0 4px; font-weight: bold; font-size: 18px; color: #6651A4; border-top: 1px solid #eee;">Grand Total:</td><td style="text-align:right; padding: 10px 0 4px; font-weight: bold; font-size: 18px; color: #6651A4; border-top: 1px solid #eee;">${currency(order.totalAmount)}</td></tr>
    </table>

    ${order.shippingAddress ? `
    <div class="card" style="background: #fff; border: 1px dashed #6651A4; margin-top: 25px;">
      <p style="margin: 0 0 5px; color: #6651A4; font-weight: bold; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Shipping Address</p>
      <p style="margin: 0; font-size: 13px; line-height: 1.5;">
        <strong>${escapeHtml(order.shippingAddress.firstName)} ${escapeHtml(order.shippingAddress.lastName)}</strong><br/>
        ${escapeHtml(order.shippingAddress.address)}${order.shippingAddress.apartment ? `, ${escapeHtml(order.shippingAddress.apartment)}` : ''}<br/>
        ${escapeHtml(order.shippingAddress.city === 'Other' ? order.shippingAddress.district : order.shippingAddress.city)}, ${escapeHtml(order.shippingAddress.state)} - ${escapeHtml(order.shippingAddress.postalCode)}<br/>
        ${escapeHtml(order.shippingAddress.country || 'India')}<br/>
        ${order.shippingAddress.phone ? `Phone: ${escapeHtml(order.shippingAddress.phone)}` : ''}
      </p>
    </div>` : ''}

    <p style="margin-top: 25px; font-size: 14px; color: #555;">Thank you for shopping with <strong>Toyovo India</strong>! If you have any questions, our support team is always here to help.</p>

    ${!isAdmin ? `<div style="text-align: center; margin-top: 20px;"><a href="${env.CLIENT_URL}/account/orders/${order._id}" class="btn">View / Track My Order</a></div>` : ''}
  `;

  return buildBaseTemplate(content, isAdmin ? 'New Order Alert' : 'Order Confirmed');
};

export const buildOrderDeliveredHtml = (order, isAdmin = false) => {
  const items = (order.items || [])
    .map((item) => `<tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #eee; font-size: 14px;">
        <strong>${escapeHtml(item.productName)}</strong>
      </td>
      <td style="text-align:center; padding: 12px 0; border-bottom: 1px solid #eee; font-size: 14px;">${item.quantity}</td>
      <td style="text-align:right; padding: 12px 0; border-bottom: 1px solid #eee; font-size: 14px; font-weight: bold;">${currency(item.totalPrice)}</td>
    </tr>`)
    .join('');

  const customerName = `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim() || 'Valued Customer';
  const deliveredDateFormatted = formatDate(order.deliveredAt || new Date());

  const content = `
    <div style="text-align: center; margin-bottom: 20px;">
      <span style="display: inline-block; background: #E6F7F0; color: #10B981; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px; padding: 6px 14px; border-radius: 20px;">Delivered Successfully</span>
    </div>
    <h2 style="color: #10B981; margin-top: 0; font-size: 22px; text-align: center;">${isAdmin ? 'Order Delivered Notice' : 'Order Delivered'}</h2>
    <p>Hello ${isAdmin ? 'Admin' : escapeHtml(order.customer?.firstName || 'Customer')},</p>
    <p>${isAdmin 
      ? `Order #${escapeHtml(order.orderNumber)} for <strong>${escapeHtml(customerName)}</strong> has been successfully marked as delivered.` 
      : 'Your order has been successfully delivered. Thank you for shopping with Toyovo India!'}</p>
    
    <div class="card" style="border-left: 4px solid #10B981;">
      <p style="margin: 0 0 8px;"><strong>Order Number:</strong> #${escapeHtml(order.orderNumber)}</p>
      <p style="margin: 0 0 8px;"><strong>Delivery Date:</strong> ${deliveredDateFormatted}</p>
      <p style="margin: 0 0 8px;"><strong>Order Total:</strong> ${currency(order.totalAmount)}</p>
      ${order.trackingNumber ? `<p style="margin: 0 0 8px;"><strong>Tracking Number:</strong> <span style="font-family: monospace; background: #eee; padding: 2px 6px; border-radius: 4px;">${escapeHtml(order.trackingNumber)}</span></p>` : ''}
      <p style="margin: 0;"><strong>Status:</strong> <span style="color: #10B981; font-weight: bold; text-transform: uppercase;">Delivered</span></p>
    </div>

    <h3 style="color: #6651A4; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px; margin: 25px 0 10px;">Ordered Products Summary</h3>
    <table class="item-table" style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
      <thead>
        <tr>
          <th style="text-align: left; border-bottom: 2px solid #6651A4; padding-bottom: 10px; font-size: 13px; text-transform: uppercase; color: #6651A4;">Product</th>
          <th style="text-align: center; border-bottom: 2px solid #6651A4; padding-bottom: 10px; font-size: 13px; text-transform: uppercase; color: #6651A4;">Qty</th>
          <th style="text-align: right; border-bottom: 2px solid #6651A4; padding-bottom: 10px; font-size: 13px; text-transform: uppercase; color: #6651A4;">Total</th>
        </tr>
      </thead>
      <tbody>${items}</tbody>
    </table>

    ${order.shippingAddress ? `
    <div class="card" style="background: #fff; border: 1px dashed #10B981; margin-top: 20px;">
      <p style="margin: 0 0 5px; color: #10B981; font-weight: bold; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Delivered To</p>
      <p style="margin: 0; font-size: 13px; line-height: 1.5;">
        <strong>${escapeHtml(order.shippingAddress.firstName)} ${escapeHtml(order.shippingAddress.lastName)}</strong><br/>
        ${escapeHtml(order.shippingAddress.address)}${order.shippingAddress.apartment ? `, ${escapeHtml(order.shippingAddress.apartment)}` : ''}<br/>
        ${escapeHtml(order.shippingAddress.city === 'Other' ? order.shippingAddress.district : order.shippingAddress.city)}, ${escapeHtml(order.shippingAddress.state)} - ${escapeHtml(order.shippingAddress.postalCode)}<br/>
        ${escapeHtml(order.shippingAddress.country || 'India')}
      </p>
    </div>` : ''}

    <p style="margin-top: 25px; font-size: 14px; color: #555;">Thank you for shopping with <strong>Toyovo India</strong>! We hope you and your family enjoy our products.</p>

    ${!isAdmin ? `<div style="text-align: center; margin-top: 25px;"><a href="${env.CLIENT_URL}/account/orders/${order._id}" class="btn" style="background: #10B981;">View Order Details</a></div>` : ''}
  `;

  return buildBaseTemplate(content, isAdmin ? 'Order Delivered Alert' : 'Order Delivered');
};

const buildOrderStatusUpdateHtml = (order, options = {}, isAdmin = false) => {
  const statusColor = order.status === 'cancelled' ? '#E8312A' : order.status === 'delivered' ? '#10b981' : '#6651A4';
  
  const deliveryLine = order.estimatedDeliveryDate
    ? `<p style="margin: 0 0 8px;"><strong>Estimated Delivery:</strong> ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(order.estimatedDeliveryDate))}</p>`
    : '';

  const trackingLine = order.trackingNumber
    ? `<p style="margin: 0 0 8px;"><strong>Tracking Number:</strong> <span style="font-family: monospace; background: #eee; padding: 2px 5px; border-radius: 4px;">${order.trackingNumber}</span></p>`
    : '';

  const reasonLine = options.deliveryDelayReason
    ? `<p style="margin: 0 0 8px; color: #666;"><strong>Update Reason:</strong> ${options.deliveryDelayReason}</p>`
    : '';

  const noteLine = options.note
    ? `<div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #eee; font-style: italic; color: #555;">"${options.note}"</div>`
    : '';

  const secretCode = order.orderNumber ? order.orderNumber.split('-').pop() : '';
  const secretCodeLine = (!isAdmin && order.status === 'shipped' && secretCode)
    ? `<div style="margin: 20px 0; padding: 15px; background: #FFF4E6; border: 1px dashed #F1641E; border-radius: 8px; text-align: center;">
         <p style="margin: 0 0 5px; font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 1px;"><strong>Delivery Verification Code</strong></p>
         <span style="font-size: 24px; font-weight: bold; color: #F1641E; letter-spacing: 2px;">${secretCode}</span>
         <p style="margin: 5px 0 0; font-size: 11px; color: #888;">Share this secret code only with the delivery agent to receive your package.</p>
       </div>`
    : '';

  const content = `
    <h2 style="color: ${statusColor}; margin-top: 0;">Order Status: ${order.status.toUpperCase()}</h2>
    <p>Hello ${isAdmin ? 'Admin' : order.customer.firstName},</p>
    <p>${isAdmin ? `Order #${order.orderNumber} status has been updated to <strong>${order.status}</strong>.` : `The status of your Toyovo India order has been updated.`}</p>
    
    <div class="card">
      <p style="margin: 0 0 8px;"><strong>Order ID:</strong> #${order.orderNumber}</p>
      <p style="margin: 0 0 8px;"><strong>Current Status:</strong> <span style="color: ${statusColor}; font-weight: bold; text-transform: uppercase;">${order.status}</span></p>
      ${deliveryLine}
      ${trackingLine}
      ${reasonLine}
      ${noteLine}
    </div>

    ${secretCodeLine}

    <p style="font-size: 13px; color: #777;">Order Total: ${currency(order.totalAmount)}</p>
    ${!isAdmin ? `<div style="text-align: center;"><a href="${env.CLIENT_URL}/account/orders/${order._id}" class="btn">View Order Details</a></div>` : ''}
  `;

  return buildBaseTemplate(content, 'Order Update');
};

const buildPasswordResetOtpHtml = (user, otp) => {
  const content = `
    <h2 style="color: #6651A4; margin-top: 0;">Password Reset Request</h2>
    <p>Hello ${user.firstName},</p>
    <p>We received a request to reset your password for your Toyovo India account. Use the following 6-digit OTP to complete the process:</p>
    
    <div style="background: #f4f4f4; padding: 20px; border-radius: 12px; text-align: center; margin: 30px 0;">
      <span style="font-size: 32px; font-weight: bold; letter-spacing: 10px; color: #E84949;">${otp}</span>
    </div>

    <p style="font-size: 13px; color: #777;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
    <p style="font-size: 13px; color: #777;">For security, never share this code with anyone.</p>
  `;

  return buildBaseTemplate(content, 'Password Reset OTP');
};

export const sendPasswordResetOtpEmail = async (user, otp) => {
  const mailer = getTransporter();
  if (!mailer) {
    logger.warn('Reset email skipped because SMTP is not configured.');
    return { skipped: true };
  }

  try {
    await mailer.sendMail({
      from: `"Toyovo India" <${env.SMTP_USER}>`,
      to: user.email,
      subject: `${otp} is your Toyovo account recovery code`,
      html: buildPasswordResetOtpHtml(user, otp),
    });

    logger.info(`Password reset OTP sent to ${user.email}`);
    return { skipped: false };
  } catch (error) {
    logger.error(`Error sending reset email: ${error.message}`);
    throw error;
  }
};

const buildContactMessageHtml = (data) => {
  const content = `
    <h2 style="color: #6651A4; margin-top: 0;">New Contact Enquiry</h2>
    <p>You have received a new message from the Toyovo India website:</p>
    
    <div class="card">
      <p style="margin: 0 0 8px;"><strong>Name:</strong> ${data.name}</p>
      <p style="margin: 0 0 8px;"><strong>Email:</strong> ${data.email}</p>
      <p style="margin: 0 0 8px;"><strong>Phone:</strong> ${data.phone || 'N/A'}</p>
      <p style="margin: 0 0 8px;"><strong>Subject:</strong> ${data.subject}</p>
      <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #eee;">
        <strong>Message:</strong><br/>
        <p style="white-space: pre-line; color: #555;">${data.message}</p>
      </div>
    </div>
  `;

  return buildBaseTemplate(content, 'New Contact Message');
};

export const sendContactMessageEmail = async (data) => {
  const mailer = getTransporter();
  if (!mailer) {
    logger.warn('Contact email skipped because SMTP is not configured.');
    return { skipped: true };
  }

  const adminEmail = process.env.ADMIN_SEED_EMAIL || 'toyovoindia@gmail.com';

  try {
    await mailer.sendMail({
      from: `"Toyovo Website" <${env.SMTP_USER}>`,
      to: adminEmail,
      replyTo: data.email,
      subject: `[CONTACT] ${data.subject} - from ${data.name}`,
      html: buildContactMessageHtml(data),
    });

    logger.info(`Contact message notification sent to ${adminEmail}`);
    return { skipped: false };
  } catch (error) {
    logger.error(`Error sending contact email: ${error.message}`);
    throw error;
  }
};

export const sendOrderConfirmationEmail = async (order) => {
  if (!order) {
    logger.warn('[ORDER EMAIL] Order confirmation email skipped: Order is null or undefined.');
    return { skipped: true, reason: 'missing_order' };
  }

  const orderId = order._id ? order._id.toString() : null;
  const orderNumber = order.orderNumber || orderId || 'UNKNOWN';

  logger.info(`[ORDER EMAIL] Order confirmation email triggered for #${orderNumber}`);

  // 1. Resolve and validate customer email
  const customerEmail = await resolveCustomerEmail(order);
  const maskedEmail = maskEmail(customerEmail);
  logger.info(`[ORDER EMAIL] Customer email: ${maskedEmail}`);

  if (!isValidEmail(customerEmail)) {
    logger.warn(`[ORDER EMAIL] Order confirmation email skipped: Missing or invalid customer email for order #${orderNumber}.`, { customerEmail: maskedEmail });
    return { skipped: true, reason: 'invalid_email' };
  }

  // Ensure customer object on order has email
  if (!order.customer) order.customer = {};
  if (!order.customer.email) order.customer.email = customerEmail;

  // 2. Payment safety guard: for online payments, send only after payment verification confirms paid!
  // For COD, paymentMethod is 'cod' and confirmed upon order creation.
  const isCod = order.paymentMethod === 'cod';
  const isPaid = order.paymentStatus === 'paid';
  if (!isCod && !isPaid) {
    logger.warn(`[ORDER EMAIL] Skipped - payment not confirmed for #${orderNumber} (method: ${order.paymentMethod}, status: ${order.paymentStatus}).`);
    return { skipped: true, reason: 'payment_not_confirmed' };
  }

  // 3. Duplicate protection check (In-memory concurrency lock + DB check)
  if (orderId && sendingConfirmationLocks.has(orderId)) {
    logger.info(`[ORDER EMAIL] Skipped - in flight (already being processed) for #${orderNumber}`);
    return { skipped: true, reason: 'in_flight' };
  }

  try {
    if (orderId) {
      sendingConfirmationLocks.add(orderId);
      const dbOrder = await Order.findById(orderId).lean();
      if (dbOrder?.confirmationEmailSent) {
        logger.info(`[ORDER EMAIL] Skipped - already sent for #${orderNumber}`);
        return { skipped: true, reason: 'already_sent' };
      }
    }

    const mailer = getTransporter();
    if (!mailer) {
      logger.warn(`[ORDER EMAIL] Skipped - SMTP not configured for #${orderNumber}`);
      return { skipped: true, reason: 'smtp_not_configured' };
    }

    const { from } = getSmtpConfig();
    const adminEmail = process.env.ADMIN_SEED_EMAIL || 'toyovoindia@gmail.com';
    const emailSubject = `Order Confirmed - Order #${order.orderNumber}`;

    logger.info(`[ORDER EMAIL] Sending confirmation email for #${orderNumber} to ${maskedEmail}`);

    // Send to Customer
    await mailer.sendMail({
      from: `"Toyovo India" <${from}>`,
      to: customerEmail,
      subject: emailSubject,
      html: buildOrderConfirmationHtml(order, false),
    });

    // Send to Admin (optional notification copy)
    if (isValidEmail(adminEmail) && adminEmail !== customerEmail) {
      await mailer.sendMail({
        from: `"Toyovo India System" <${from}>`,
        to: adminEmail,
        subject: `[NEW ORDER] #${order.orderNumber} - ${order.customer?.firstName || 'Customer'}`,
        html: buildOrderConfirmationHtml(order, true),
      }).catch((adminErr) => {
        logger.warn(`Admin order notification email failed for #${orderNumber}: ${adminErr.message}`);
      });
    }

    // Mark confirmation email sent in DB ONLY after successful sendMail
    if (orderId) {
      await Order.findByIdAndUpdate(orderId, {
        $set: {
          confirmationEmailSent: true,
          confirmationEmailSentAt: new Date(),
        },
      });
      if (typeof order.set === 'function') {
        order.confirmationEmailSent = true;
        order.confirmationEmailSentAt = new Date();
      }
    }

    logger.info(`[ORDER EMAIL] Confirmation email sent successfully for #${order.orderNumber}`);
    return { skipped: false, success: true };
  } catch (error) {
    logger.error(`[ORDER EMAIL] Failed - ${error.message} for #${orderNumber}`);
    return { skipped: false, success: false, error: error.message };
  } finally {
    if (orderId) {
      sendingConfirmationLocks.delete(orderId);
    }
  }
};

export const sendOrderDeliveredEmail = async (order) => {
  if (!order) {
    logger.warn('[ORDER EMAIL] Order delivered email skipped: Order is null or undefined.');
    return { skipped: true, reason: 'missing_order' };
  }

  const orderId = order._id ? order._id.toString() : null;
  const orderNumber = order.orderNumber || orderId || 'UNKNOWN';

  logger.info(`[ORDER EMAIL] Order delivered email triggered for #${orderNumber}`);

  // 1. Resolve and validate customer email
  const customerEmail = await resolveCustomerEmail(order);
  const maskedEmail = maskEmail(customerEmail);
  logger.info(`[ORDER EMAIL] Customer email: ${maskedEmail}`);

  if (!isValidEmail(customerEmail)) {
    logger.warn(`[ORDER EMAIL] Order delivered email skipped: Missing or invalid customer email for order #${orderNumber}.`, { customerEmail: maskedEmail });
    return { skipped: true, reason: 'invalid_email' };
  }

  // Ensure customer object on order has email
  if (!order.customer) order.customer = {};
  if (!order.customer.email) order.customer.email = customerEmail;

  // 2. Status safety guard: Ensure order status is actually 'delivered'
  if (order.status !== 'delivered') {
    logger.warn(`[ORDER EMAIL] Skipped (delivered) - status is not delivered (${order.status}) for #${orderNumber}.`);
    return { skipped: true, reason: 'status_not_delivered' };
  }

  // 3. Duplicate protection check (In-memory concurrency lock + DB check)
  if (orderId && sendingDeliveredLocks.has(orderId)) {
    logger.info(`[ORDER EMAIL] Skipped (delivered) - in flight (already being processed) for #${orderNumber}`);
    return { skipped: true, reason: 'in_flight' };
  }

  try {
    if (orderId) {
      sendingDeliveredLocks.add(orderId);
      const dbOrder = await Order.findById(orderId).lean();
      if (dbOrder?.deliveredEmailSent) {
        logger.info(`[ORDER EMAIL] Skipped - already sent (delivered) for #${orderNumber}`);
        return { skipped: true, reason: 'already_sent' };
      }
    }

    const mailer = getTransporter();
    if (!mailer) {
      logger.warn(`[ORDER EMAIL] Skipped (delivered) - SMTP not configured for #${orderNumber}`);
      return { skipped: true, reason: 'smtp_not_configured' };
    }

    const { from } = getSmtpConfig();
    const adminEmail = process.env.ADMIN_SEED_EMAIL || 'toyovoindia@gmail.com';
    const emailSubject = `Your Order Has Been Delivered - Order #${order.orderNumber}`;

    logger.info(`[ORDER EMAIL] Sending delivered email for #${orderNumber} to ${maskedEmail}`);

    // Send to Customer
    await mailer.sendMail({
      from: `"Toyovo India" <${from}>`,
      to: customerEmail,
      subject: emailSubject,
      html: buildOrderDeliveredHtml(order, false),
    });

    // Send to Admin (optional notification copy)
    if (isValidEmail(adminEmail) && adminEmail !== customerEmail) {
      await mailer.sendMail({
        from: `"Toyovo India System" <${from}>`,
        to: adminEmail,
        subject: `[ORDER DELIVERED] #${order.orderNumber} - ${order.customer?.firstName || 'Customer'}`,
        html: buildOrderDeliveredHtml(order, true),
      }).catch((adminErr) => {
        logger.warn(`Admin order delivered notification failed for #${orderNumber}: ${adminErr.message}`);
      });
    }

    // Mark delivered email sent in DB ONLY after successful sendMail
    if (orderId) {
      await Order.findByIdAndUpdate(orderId, {
        $set: {
          deliveredEmailSent: true,
          deliveredEmailSentAt: new Date(),
        },
      });
      if (typeof order.set === 'function') {
        order.deliveredEmailSent = true;
        order.deliveredEmailSentAt = new Date();
      }
    }

    logger.info(`[ORDER EMAIL] Delivered email sent successfully for #${order.orderNumber}`);
    return { skipped: false, success: true };
  } catch (error) {
    logger.error(`[ORDER EMAIL] Failed (delivered) - ${error.message} for #${orderNumber}`);
    return { skipped: false, success: false, error: error.message };
  } finally {
    if (orderId) {
      sendingDeliveredLocks.delete(orderId);
    }
  }
};

export const sendOrderStatusUpdateEmail = async (order, options = {}) => {
  const mailer = getTransporter();
  if (!mailer) {
    logger.warn('Order update email skipped because SMTP is not configured.');
    return { skipped: true };
  }

  const adminEmail = process.env.ADMIN_SEED_EMAIL || 'toyovoindia@gmail.com';

  try {
    // Send to Customer
    await mailer.sendMail({
      from: `"Toyovo India" <${env.SMTP_USER}>`,
      to: order.customer.email,
      subject: `Update on your Order #${order.orderNumber} - ${order.status.toUpperCase()}`,
      html: buildOrderStatusUpdateHtml(order, options, false),
    });

    // Send to Admin
    await mailer.sendMail({
      from: `"Toyovo India System" <${env.SMTP_USER}>`,
      to: adminEmail,
      subject: `[STATUS UPDATE] Order #${order.orderNumber} is now ${order.status.toUpperCase()}`,
      html: buildOrderStatusUpdateHtml(order, options, true),
    });

    logger.info(`Order update emails sent for ${order.orderNumber} to customer and admin.`);
    return { skipped: false };
  } catch (error) {
    logger.error(`Error sending status update email: ${error.message}`);
    throw error;
  }
};

const buildNewsletterWelcomeHtml = (email) => {
  const content = `
    <h2 style="color: #6651A4; margin-top: 0;">Welcome to the Toyovo Family! 🎈</h2>
    <p>Hi there,</p>
    <p>Thank you for subscribing to our newsletter. We're thrilled to have you with us!</p>
    <p>As a token of our appreciation, here's a special gift for your little one's first order:</p>
    
    <div style="background: #f9ead3; border: 2px dashed #e84949; padding: 25px; border-radius: 16px; text-align: center; margin: 30px 0;">
      <p style="margin: 0 0 10px; font-size: 14px; font-weight: bold; color: #666; text-transform: uppercase; letter-spacing: 1px;">Use Code At Checkout</p>
      <span style="font-size: 36px; font-weight: 900; color: #e84949; letter-spacing: 2px;">WELCOME10</span>
      <p style="margin: 10px 0 0; font-size: 18px; font-weight: bold; color: #333;">10% OFF YOUR FIRST ORDER</p>
    </div>

    <p>Get ready for exclusive updates on new arrivals, parenting tips, and special offers delivered straight to your inbox.</p>
    
    <div style="text-align: center; margin-top: 30px;">
      <a href="${env.CLIENT_URL}/shop" class="btn">Shop Now</a>
    </div>

    <p style="font-size: 13px; color: #777; margin-top: 40px;">*Valid on first order only. Cannot be combined with other offers.</p>
  `;

  return buildBaseTemplate(content, 'Welcome to Toyovo India');
};

export const sendNewsletterWelcomeEmail = async (email) => {
  const mailer = getTransporter();
  if (!mailer) {
    logger.warn('Newsletter welcome email skipped because SMTP is not configured.');
    return { skipped: true };
  }

  try {
    await mailer.sendMail({
      from: `"Toyovo India" <${env.SMTP_USER}>`,
      to: email,
      subject: 'Welcome to Toyovo India! Here is your 10% Discount Code 🎁',
      html: buildNewsletterWelcomeHtml(email),
    });

    logger.info(`Newsletter welcome email sent to ${email}`);
    return { skipped: false };
  } catch (error) {
    logger.error(`Error sending newsletter email: ${error.message}`);
    throw error;
  }
};
