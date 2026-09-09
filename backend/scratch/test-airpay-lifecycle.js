import mongoose from 'mongoose';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';
import Category from '../src/models/Category.js';
import env from '../src/config/env.js';
import { crc32 } from '../src/utils/airpay.js';
import { handleAirpayWebhook, handleAirpayResponse } from '../src/controllers/payment.controller.js';

async function testLifecycle() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(env.MONGO_URI);
  console.log('Connected to MongoDB.');

  const product = await Product.findOne();
  if (!product) {
    console.error('No product found in DB for checkout draft!');
    return;
  }
  console.log('Using real Product:', { id: product._id, name: product.name, price: product.price });

  const txnid = 'TXN_TEST_' + Date.now();
  const orderNumber = 'TYV-AIRPAY-' + Date.now();
  const itemPrice = product.price;

  // 1. Create Pending Order in DB
  console.log('\n--- 1. Testing Pending Order Creation in DB ---');
  const order = await Order.create({
    orderNumber,
    customer: {
      firstName: 'Aman',
      lastName: 'Walia',
      email: 'toyovoindia@gmail.com',
      phone: '7901931534',
    },
    shippingAddress: {
      firstName: 'Aman',
      lastName: 'Walia',
      address: 'UNIT 703 7th FLOOR BLOCK 1 MAYAGARDEN',
      city: 'Zirakpur',
      state: 'Punjab',
      country: 'India',
      postalCode: '140603',
      phone: '7901931534',
    },
    items: [
      {
        product: product._id,
        productName: product.name || 'Sample Product',
        unitPrice: itemPrice,
        totalPrice: itemPrice,
        quantity: 1,
        sku: product.sku || 'SKU-001',
      },
    ],
    subtotal: itemPrice,
    shippingAmount: 0,
    discountAmount: 0,
    totalAmount: itemPrice,
    status: 'pending',
    paymentStatus: 'pending',
    paymentMethod: 'airpay',
    shippingMethod: 'standard',
    paymentGateway: {
      provider: 'airpay',
      airpayTxnId: txnid,
    },
  });

  console.log('Order created in DB:', {
    id: order._id.toString(),
    orderNumber: order.orderNumber,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    airpayTxnId: order.paymentGateway.airpayTxnId,
    totalAmount: order.totalAmount,
  });

  // 2. Simulate Airpay S2S Callback / Webhook
  console.log('\n--- 2. Testing Airpay Webhook & Hash Verification ---');
  const apTransactionId = 'AP_' + Math.floor(Math.random() * 1000000000);
  const amount = Number(itemPrice).toFixed(2);
  const status = '200';
  const message = 'Success';
  const merchantId = env.AIRPAY_MERCHANT_ID;
  const username = env.AIRPAY_USERNAME;

  // Compute CRC32 hash as Airpay does
  const checkString = `${txnid}:${apTransactionId}:${amount}:${status}:${message}:${merchantId}:${username}`;
  const ap_SecureHash = crc32(checkString);

  const mockWebhookReq = {
    body: {
      TRANSACTIONID: txnid,
      APTRANSACTIONID: apTransactionId,
      AMOUNT: amount,
      TRANSACTIONSTATUS: status,
      MESSAGE: message,
      ap_SecureHash,
      CHMOD: 'pg',
    },
  };

  let statusCode = 200;
  let responseBody = '';
  const mockWebhookRes = {
    status: (code) => {
      statusCode = code;
      return {
        send: (msg) => { responseBody = msg; },
      };
    },
  };

  await handleAirpayWebhook(mockWebhookReq, mockWebhookRes);
  console.log('Webhook Handler Result:', { statusCode, responseBody });

  // 3. Verify Order Status in DB after Webhook
  console.log('\n--- 3. Verifying Final Order/Payment Status in DB ---');
  const updatedOrder = await Order.findOne({ 'paymentGateway.airpayTxnId': txnid });
  console.log('Updated Order from DB:', {
    orderNumber: updatedOrder.orderNumber,
    status: updatedOrder.status,
    paymentStatus: updatedOrder.paymentStatus,
    airpayPaymentId: updatedOrder.paymentGateway.airpayPaymentId,
    verifiedAt: updatedOrder.paymentGateway.verifiedAt,
  });

  if (updatedOrder.paymentStatus === 'paid' && updatedOrder.paymentGateway.airpayPaymentId === apTransactionId) {
    console.log('\n>>> BACKEND AIRPAY PAYMENT LIFECYCLE: 100% PASSED! <<<');
  } else {
    console.error('\n>>> BACKEND AIRPAY PAYMENT LIFECYCLE: FAILED <<<');
  }

  // Cleanup test order
  await Order.deleteOne({ _id: order._id });
  console.log('Test order cleaned up.');

  await mongoose.disconnect();
}

testLifecycle().catch(err => {
  console.error('Lifecycle test error:', err);
  process.exit(1);
});
