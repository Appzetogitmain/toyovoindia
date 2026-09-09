import fs from 'fs';

const html = fs.readFileSync('scratch/airpay_live_success_page.html', 'utf8');
const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"([^"]+)"\]\)/g)].map(m => m[1]);
console.log('Total next_f chunks:', chunks.length);
const fullPayload = chunks.join('\n');
console.log('Payload length:', fullPayload.length);
fs.writeFileSync('scratch/next_f_payload.txt', fullPayload);
console.log('Saved to scratch/next_f_payload.txt');
