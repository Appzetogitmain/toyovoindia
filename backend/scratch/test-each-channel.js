import { airpayService } from '../src/services/airpay.service.js';
import env from '../src/config/env.js';

const channels = [
  { name: 'UPI', chmod: 'upi' },
  { name: 'Credit Card', chmod: 'pg' },
  { name: 'Debit Card', chmod: 'pg' },
  { name: 'Net Banking', chmod: 'nb' },
  { name: 'Wallet', chmod: 'ppc' },
];

async function run() {
  console.log('=== TESTING AIRPAY CHANNELS ===\n');

  for (const ch of channels) {
    const txnid = 'TXN_' + ch.chmod.toUpperCase() + '_' + Date.now();
    const orderNumber = 'TYV-' + ch.chmod.toUpperCase() + '-' + Date.now();
    const domain = 'https://www.toyovoindia.com';
    const amount = '1.00';

    const payload = airpayService.prepareHostedCheckoutData({
      orderNumber,
      txnid,
      amount,
      customer: {
        email: 'toyovoindia@gmail.com',
        firstName: 'Aman',
        lastName: 'Walia',
        phone: '7901931534',
      },
      shippingAddress: {
        street: 'UNIT 703 7th FLOOR BLOCK 1 MAYAGARDEN',
        city: 'Zirakpur',
        state: 'Punjab',
        country: 'India',
        postalCode: '140603',
      },
      returnUrl: domain + '/api/payments/airpay/response',
    });

    // Set channel-specific chmod
    payload.chmod = ch.chmod;

    const formData = new URLSearchParams();
    for (const [k, v] of Object.entries(payload)) {
      if (k !== 'airpayBaseUrl') formData.append(k, v);
    }

    try {
      const res = await fetch(payload.airpayBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': domain,
          'Referer': domain + '/checkout',
        },
        body: formData,
      });

      const html = await res.text();
      const txnidMatch = html.match(/data-txnid="([^"]+)"/);
      const airpayTxnId = txnidMatch ? txnidMatch[1] : null;

      // Status check via verify.php
      const statusRes = await airpayService.checkStatus(txnid);

      console.log(`[CHANNEL: ${ch.name}]`);
      console.log(` - chmod: '${ch.chmod}'`);
      console.log(` - Order ID: ${txnid}`);
      console.log(` - Airpay HTTP Status: ${res.status}`);
      console.log(` - Airpay Gateway Txn ID: ${airpayTxnId || 'None'}`);
      console.log(` - Verify API Status: ${statusRes.status} (${statusRes.message})`);
      console.log('--------------------------------------------------\n');
    } catch (err) {
      console.error(`[CHANNEL: ${ch.name}] Error:`, err.message);
    }
  }
}

run();
