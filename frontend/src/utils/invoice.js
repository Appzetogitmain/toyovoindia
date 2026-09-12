const currency = (value) => `Rs ${Number(value || 0).toFixed(2)}`

const escapeHtml = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

export const printOrderInvoice = (order) => {
  if (!order) return

  const rows = (order.items || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.title || item.productName)}</td>
      <td>${escapeHtml(item.sku || '-')}</td>
      <td>${item.qty || item.quantity}</td>
      <td>${currency(item.price || item.unitPrice)}</td>
      <td>${currency(item.total || item.totalPrice || (Number(item.price || item.unitPrice || 0) * Number(item.qty || item.quantity || 0)))}</td>
    </tr>
  `).join('')

  const s = order.shippingAddress || {};
  const gatewayTxnId = order.gatewayTxnId || order.paymentGateway?.airpayPaymentId || order.paymentGateway?.payuMoneyId || order.paymentGateway?.phonepeTransactionId || order.paymentGateway?.airpayTxnId || '';
  const isPaid = (order.paymentStatus === 'paid' || (order.paymentStatusLabel || '').toLowerCase() === 'paid');

  const htmlContent = `
    <!doctype html>
    <html>
      <head>
        <title>Invoice ${escapeHtml(order.orderNumber)}</title>
        <style>
          @page { margin: 0; size: auto; }
          @media print {
            body { margin: 1.5cm; }
          }
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 32px; color: #222; font-size: 14px; line-height: 1.5; }
          h1, h2, h3, h4, p { margin: 0; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; border-bottom: 2px solid #eee; padding-bottom: 24px; }
          .muted { color: #666; font-size: 12px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
          .card { border: 1px solid #eaeaea; border-radius: 8px; padding: 20px; background-color: #fafafa; }
          .card h3 { margin-bottom: 12px; font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 8px; color: #111; }
          table { width: 100%; border-collapse: collapse; margin-top: 32px; }
          th, td { border-bottom: 1px solid #eee; padding: 12px 10px; text-align: left; font-size: 13px; }
          th { background: #f4f4f5; text-transform: uppercase; font-size: 11px; letter-spacing: .08em; font-weight: 600; color: #444; }
          .totals { margin-top: 32px; margin-left: auto; width: 320px; }
          .totals div { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
          .total { font-weight: 700; font-size: 18px; border-top: 2px solid #222; margin-top: 8px; padding-top: 12px; color: #000; }
          .badge { display: inline-block; padding: 3px 8px; background: #eee; border-radius: 4px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1 style="font-size: 28px; margin-bottom: 4px; letter-spacing: -0.5px;">TOYOVOINDIA</h1>
            <p class="muted" style="font-size: 14px;">Invoice / Payment Receipt</p>
          </div>
          <div style="text-align:right">
            <h2 style="font-size: 24px; margin-bottom: 4px;">#${escapeHtml(order.orderNumber)}</h2>
            <p class="muted">Date: <strong>${escapeHtml(order.date || new Date().toLocaleDateString())}</strong></p>
            <p style="margin-top: 8px;">
              <span class="badge" style="background:#e0e7ff; color:#3730a3;">Order: ${escapeHtml(order.statusLabel || order.status || '')}</span>
              <span class="badge" style="background:${isPaid ? '#dcfce7' : '#fee2e2'}; color:${isPaid ? '#166534' : '#991b1b'};">Payment: ${isPaid ? 'Payment Paid' : escapeHtml(order.paymentStatusLabel || order.paymentStatus || '')}</span>
            </p>
          </div>
        </div>
        
        <div class="grid">
          <div class="card">
            <h3>Customer Details</h3>
            <p style="font-weight: 600;">${escapeHtml(order.customerName || `${s.firstName || ''} ${s.lastName || ''}`.trim() || '')}</p>
            <p class="muted" style="margin-top: 4px;">${escapeHtml(order.customerEmail || order.customer?.email || '')}</p>
            <p class="muted">Ph: ${escapeHtml(s.phone || order.customer?.phone || '-')}</p>
            <div style="margin-top: 12px;">
              <p style="font-size: 12px; color: #555;">Payment Method:</p>
              <p style="font-weight: 600; font-size: 13px;">${escapeHtml(order.paymentMethodLabel || (order.paymentMethod === 'airpay' ? 'Airpay' : order.paymentMethod) || 'Prepaid')}</p>
              ${gatewayTxnId ? `<p class="muted" style="font-size: 11px; margin-top: 4px;">Gateway Txn ID: <strong style="color: #111;">${escapeHtml(gatewayTxnId)}</strong></p>` : ''}
            </div>
          </div>
          
          <div class="card">
            <h3>Shipping Address</h3>
            <p style="font-weight: 600;">${escapeHtml(`${s.firstName || ''} ${s.lastName || ''}`.trim() || order.customerName)}</p>
            <p class="muted" style="margin-top: 4px;">${escapeHtml(s.address || '')}${s.apartment ? ', ' + escapeHtml(s.apartment) : ''}</p>
            <p class="muted">${escapeHtml(s.city || '')}, ${escapeHtml(s.state || '')} - ${escapeHtml(s.postalCode || '')}</p>
            <p class="muted">${escapeHtml(s.country || 'India')}</p>
            
            <div style="margin-top: 12px; border-top: 1px dashed #ddd; padding-top: 12px;">
              <p class="muted" style="display: flex; justify-content: space-between;"><span>ETA:</span> <strong>${escapeHtml(order.deliveryDate || '-')}</strong></p>
              <p class="muted" style="display: flex; justify-content: space-between; margin-top: 4px;"><span>Tracking:</span> <strong>${escapeHtml(order.trackingNumber || 'Pending')}</strong></p>
            </div>
          </div>
        </div>
        
        <table>
          <thead>
            <tr>
              <th>Product Details</th>
              <th style="width: 15%">SKU</th>
              <th style="width: 10%; text-align: center;">Qty</th>
              <th style="width: 15%; text-align: right;">Unit Price</th>
              <th style="width: 15%; text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        
        <div class="totals">
          <div><span class="muted">Subtotal</span><span>${currency(order.subtotal)}</span></div>
          <div><span class="muted">Shipping Charge</span><span>${currency(order.shipping || order.shippingAmount)}</span></div>
          ${(order.discount || order.discountAmount) > 0 ? `<div><span class="muted" style="color: #ef4444;">Discount</span><span style="color: #ef4444;">- ${currency(order.discount || order.discountAmount)}</span></div>` : ''}
          <div class="total"><span>Grand Total</span><span>${currency(order.total || order.totalAmount)}</span></div>
        </div>
        
        <div style="margin-top: 64px; text-align: center; color: #888; font-size: 12px; border-top: 1px solid #eee; padding-top: 16px;">
          <p>Thank you for shopping with Toyovo India!</p>
          <p style="margin-top: 4px;">This is a computer generated invoice and does not require a physical signature.</p>
        </div>
      </body>
    </html>
  `

  try {
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    document.body.appendChild(iframe)
    
    const iframeDoc = iframe.contentWindow.document
    iframeDoc.open()
    iframeDoc.write(htmlContent)
    iframeDoc.close()
    
    iframe.contentWindow.focus()
    setTimeout(() => {
      iframe.contentWindow.print()
      setTimeout(() => {
        document.body.removeChild(iframe)
      }, 2000)
    }, 500)
    
  } catch (error) {
    console.error('Failed to generate invoice:', error)
    alert('Failed to generate invoice document.')
  }
}
