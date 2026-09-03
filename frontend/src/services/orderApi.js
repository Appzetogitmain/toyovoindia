import { apiRequest } from './api'

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
})

const statusMap = {
  pending: 'Pending',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

const paymentStatusMap = {
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
}

const paymentMethodMap = {
  card: 'Card',
  upi: 'UPI',
  netbanking: 'Net Banking',
  cod: 'Cash on Delivery',
  payu: 'PayU',
  phonepe: 'PhonePe',
  jiopay: 'JioPay',
}

export const normalizeOrder = (order) => ({
  ...order,
  id: order.id || order._id,
  orderNumber: order.orderNumber || order.id || order._id,
  statusLabel: order.statusLabel || statusMap[order.status] || order.status,
  paymentStatusLabel: order.paymentStatusLabel || paymentStatusMap[order.paymentStatus] || order.paymentStatus,
  paymentMethodLabel: order.paymentMethodLabel || paymentMethodMap[order.paymentMethod] || order.paymentMethod,
  total: Number(order.total ?? order.totalAmount ?? 0),
  subtotal: Number(order.subtotal ?? 0),
  shipping: Number(order.shipping ?? order.shippingAmount ?? 0),
  discount: Number(order.discount ?? order.discountAmount ?? 0),
  items: (order.items || []).map((item) => ({
    ...item,
    id: item.id || item.product,
    title: item.title || item.productName,
    img: item.img || item.image || '',
    qty: Number(item.qty ?? item.quantity ?? 0),
    price: Number(item.price ?? item.unitPrice ?? 0),
    total: Number(item.total ?? item.totalPrice ?? 0),
  })),
  totalDisplay: currencyFormatter.format(Number(order.total ?? order.totalAmount ?? 0)),
  subtotalDisplay: currencyFormatter.format(Number(order.subtotal ?? 0)),
  shippingDisplay: currencyFormatter.format(Number(order.shipping ?? order.shippingAmount ?? 0)),
  discountDisplay: currencyFormatter.format(Number(order.discount ?? order.discountAmount ?? 0)),
  customerName: order.customerName || `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim(),
  customerEmail: order.customerEmail || order.customer?.email || '',
  destination: order.destination || (order.shippingAddress 
    ? `${order.shippingAddress.address}${order.shippingAddress.apartment ? `, ${order.shippingAddress.apartment}` : ''}, ${order.shippingAddress.city === 'Other' ? order.shippingAddress.district : order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode}`
    : ''),
  deliveryDate: order.deliveryDate || '',
  estimatedDeliveryDate: order.estimatedDeliveryDate || '',
  deliveryDelayReason: order.deliveryDelayReason || '',
  trackingNumber: order.trackingNumber || '',
  returnRequest: {
    status: order.returnRequest?.status || 'none',
    statusLabel: order.returnRequest?.statusLabel || 'No Request',
    reason: order.returnRequest?.reason || '',
    adminNote: order.returnRequest?.adminNote || '',
    requestedAt: order.returnRequest?.requestedAt || null,
    reviewedAt: order.returnRequest?.reviewedAt || null,
  },
})

export const createOrder = async (data) => {
  const payload = await apiRequest('/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return normalizeOrder(payload.data)
}

export const createPayuPaymentOrder = async (data) => {
  const payload = await apiRequest('/payments/payu/order', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return payload.data
}

export const createPhonepePaymentOrder = async (data) => {
  const payload = await apiRequest('/payments/phonepe/initiate', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return payload.data
}

export const checkPhonepePaymentStatus = async (txnid) => {
  const payload = await apiRequest(`/payments/phonepe/status/${txnid}`)
  return payload.data
}

export const createJiopayPaymentOrder = async (data) => {
  const payload = await apiRequest('/payments/jiopay/initiate', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return payload.data
}

export const checkJiopayPaymentStatus = async (txnid) => {
  const payload = await apiRequest(`/payments/jiopay/status/${txnid}`)
  return payload.data
}

export const getOrderSummary = async (orderNumber, email) => {
  const query = new URLSearchParams()
  if (email) {
    query.set('email', email)
  }
  const payload = await apiRequest(`/orders/summary/${orderNumber}${query.toString() ? `?${query}` : ''}`)
  return normalizeOrder(payload.data)
}

export const getMyOrders = async (params = {}) => {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, value)
    }
  })

  const payload = await apiRequest(`/orders/my${query.toString() ? `?${query}` : ''}`)
  return {
    orders: (payload.data || []).map(normalizeOrder),
    meta: payload.meta || {},
  }
}

export const getMyOrder = async (id) => {
  const payload = await apiRequest(`/orders/my/${id}`)
  return normalizeOrder(payload.data)
}

export const cancelMyOrder = async (id, data = {}) => {
  const payload = await apiRequest(`/orders/my/${id}/cancel`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  return normalizeOrder(payload.data)
}

export const requestMyOrderReturn = async (id, data) => {
  const payload = await apiRequest(`/orders/my/${id}/return-request`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  return normalizeOrder(payload.data)
}

export const getAdminOrders = async (params = {}) => {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, value)
    }
  })

  const payload = await apiRequest(`/admin/orders${query.toString() ? `?${query}` : ''}`)
  return {
    orders: (payload.data || []).map(normalizeOrder),
    meta: payload.meta || {},
  }
}

export const getAdminOrder = async (id) => {
  const payload = await apiRequest(`/admin/orders/${id}`)
  return normalizeOrder(payload.data)
}

export const updateAdminOrderStatus = async (id, data) => {
  const payload = await apiRequest(`/admin/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  return normalizeOrder(payload.data)
}

export const updateAdminOrderReturnRequest = async (id, data) => {
  const payload = await apiRequest(`/admin/orders/${id}/return-request`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  return normalizeOrder(payload.data)
}

export const getAdminRevenueStats = async (timeframe = 'monthly') => {
  const payload = await apiRequest(`/admin/orders/stats/revenue?timeframe=${timeframe}`)
  return payload.data
}

export const exportDetailedTransactions = async () => {
  // Uses raw fetch to handle the CSV Blob instead of JSON
  const authRaw = localStorage.getItem('TOYOVOINDIA_auth_user')
  let token = ''
  if (authRaw) {
    try { token = JSON.parse(authRaw)?.accessToken || '' } catch {}
  }

  const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000/api'}/admin/reports/transactions/export`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  
  if (!response.ok) throw new Error('Failed to download transactions')
  
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `transaction_report_${new Date().toISOString().split('T')[0]}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  return true
}
