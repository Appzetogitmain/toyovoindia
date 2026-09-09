import fs from 'fs';

async function run() {
  const html = fs.readFileSync('scratch/airpay_live_success_page.html', 'utf8');
  const tokenMatch = html.match(/data-token="([^"]+)"/);
  const txnidMatch = html.match(/data-txnid="([^"]+)"/);
  console.log('Airpay Txn ID:', txnidMatch ? txnidMatch[1] : 'None');
  
  if (tokenMatch) {
    const token = tokenMatch[1];
    const parts = token.split('.');
    const decoded = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    console.log('Decoded Token payload:', decoded);

    // Common Airpay internal endpoints
    const testEndpoints = [
      `/pay/simple/api/payment-modes`,
      `/pay/simple/api/init`,
      `/pay/simple/api/details`,
      `/pay/simple/api/transaction/${txnidMatch?.[1]}`,
      `/pay/api/v1/payment-modes`,
      `/api/payment-modes`,
    ];

    for (const ep of testEndpoints) {
      try {
        const res = await fetch(`https://payments.airpay.co.in${ep}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Origin': 'https://www.toyovoindia.com',
            'Referer': 'https://payments.airpay.co.in/',
          }
        });
        console.log(ep, 'Status:', res.status);
        if (res.ok) {
          const body = await res.json().catch(() => res.text());
          console.log(ep, 'Response:', typeof body === 'object' ? JSON.stringify(body).slice(0, 300) : body.slice(0, 300));
        }
      } catch (e) {}
    }
  }
}

run();
