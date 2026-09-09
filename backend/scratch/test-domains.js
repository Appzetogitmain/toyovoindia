import { airpayService } from '../src/services/airpay.service.js';

const domains = [
  'https://toyovoindia.com',
  'https://www.toyovoindia.com',
  'https://api.toyovoindia.com',
  'https://toyovoindia.vercel.app',
  'http://localhost:5173',
  'http://localhost:5090',
];

async function run() {
  for (const domain of domains) {
    const payload = airpayService.prepareHostedCheckoutData({
      orderNumber: 'TYV-TEST-' + Date.now(),
      txnid: 'TXN' + Date.now(),
      amount: 1.00,
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
      const msgMatch = html.match(/name="msg" value="([^"]*)"/);
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      console.log('Tested Domain:', domain);
      if (msgMatch) {
        console.log(' -> Result Msg:', msgMatch[1]);
      } else {
        console.log(' -> Result Status:', res.status, 'Title:', titleMatch ? titleMatch[1] : 'No Title', 'Length:', html.length);
        if (html.length > 3000) {
          console.log(' -> Full checkout page rendered successfully!');
        }
      }
    } catch (e) {
      console.error('Error with domain', domain, e.message);
    }
  }
}

run();
