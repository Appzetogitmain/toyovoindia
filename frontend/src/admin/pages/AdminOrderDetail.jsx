import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { 
  ChevronLeft, Package, Truck, CreditCard, 
  User, Mail, Phone, MapPin, Calendar, 
  ExternalLink, Printer, CheckCircle, Clock, RefreshCw
} from 'lucide-react'
import { useToast } from '../../context/ToastContext'
import { getAdminOrder, updateAdminOrderReturnRequest, updateAdminOrderStatus, checkAirpayPaymentStatus } from '../../services/orderApi'
import { printOrderInvoice } from '../../utils/invoice'

const getAllowedStatusOptions = (status) => {
  switch (status) {
    case 'pending':
      return ['pending', 'processing', 'shipped', 'cancelled']
    case 'processing':
      return ['processing', 'shipped', 'cancelled']
    case 'shipped':
      return ['shipped', 'delivered', 'cancelled']
    case 'delivered':
      return ['delivered']
    case 'cancelled':
      return ['cancelled']
    default:
      return ['pending', 'processing', 'shipped', 'delivered', 'cancelled']
  }
}

const formatJoinedDate = (value) => {
  if (!value) return 'Guest checkout'
  return new Date(value).toLocaleDateString('en-IN', { dateStyle: 'medium' })
}

const getReturnStatusOptions = (currentStatus) => {
  switch (currentStatus) {
    case 'requested':
      return ['requested', 'approved', 'rejected'];
    case 'approved':
      return ['approved', 'refunded', 'rejected'];
    case 'rejected':
      return ['rejected', 'approved'];
    case 'refunded':
      return ['refunded'];
    default:
      return ['requested', 'approved', 'rejected', 'refunded'];
  }
}

export function AdminOrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { success, error: showError } = useToast()
  const [loading, setLoading] = useState(true)
  const [order, setOrder] = useState(null)
  const [status, setStatus] = useState('processing')
  const [trackingNumber, setTrackingNumber] = useState('')
  const [estimatedDeliveryDate, setEstimatedDeliveryDate] = useState('')
  const [deliveryDelayReason, setDeliveryDelayReason] = useState('')
  const [statusNote, setStatusNote] = useState('')
  const [returnStatus, setReturnStatus] = useState('requested')
  const [returnAdminNote, setReturnAdminNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let isMounted = true
    const loadOrder = async () => {
      setLoading(true)
      try {
        const data = await getAdminOrder(id)
        if (!isMounted) return
        setOrder(data)
        setStatus(data.status)
        setTrackingNumber(data.trackingNumber || '')
        setEstimatedDeliveryDate(data.estimatedDeliveryDate ? new Date(data.estimatedDeliveryDate).toISOString().split('T')[0] : '')
        setDeliveryDelayReason(data.deliveryDelayReason || '')
        setStatusNote('')
        setReturnStatus(data.returnRequest?.status === 'none' ? 'requested' : (data.returnRequest?.status || 'requested'))
        setReturnAdminNote(data.returnRequest?.adminNote || '')
      } catch (err) {
        if (isMounted) {
          showError(err.message || 'Order could not be loaded')
          navigate('/admin/orders')
        }
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadOrder()
    return () => {
      isMounted = false
    }
  }, [id])

  const [isSyncingPayment, setIsSyncingPayment] = useState(false)

  const handleSyncAirpay = async (silent = false) => {
    if (!order) return
    const lookupId = order.paymentGateway?.airpayTxnId || order.orderNumber
    if (!lookupId) return

    setIsSyncingPayment(true)
    try {
      const res = await checkAirpayPaymentStatus(lookupId)
      if (res?.status === 'success' || res?.paymentStatus === 'paid') {
        const refreshed = await getAdminOrder(id)
        setOrder(refreshed)
        setStatus(refreshed.status)
        if (!silent) success('Payment verified successfully via Airpay!')
      } else {
        if (!silent) showError('Airpay reports payment is still pending.')
      }
    } catch (err) {
      if (!silent) showError(err.message || 'Failed to sync with Airpay')
    } finally {
      setIsSyncingPayment(false)
    }
  }

  // Auto-sync pending Airpay orders on load
  useEffect(() => {
    if (order && order.paymentMethod === 'airpay' && order.paymentStatus === 'pending') {
      handleSyncAirpay(true)
    }
  }, [order?.paymentStatus, order?.paymentMethod])

  const timeline = order?.statusHistory?.map((entry) => ({
    status: entry.status,
    time: new Date(entry.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
    desc: entry.note || 'Status updated',
    done: true,
  })) || []

  const handleSave = async () => {
    setSaving(true)
    try {
      const updatedOrder = await updateAdminOrderStatus(order.id, {
        status,
        trackingNumber,
        estimatedDeliveryDate: estimatedDeliveryDate ? new Date(`${estimatedDeliveryDate}T00:00:00.000Z`).toISOString() : '',
        deliveryDelayReason,
        note: statusNote,
      })
      setOrder(updatedOrder)
      setStatus(updatedOrder.status)
      setTrackingNumber(updatedOrder.trackingNumber || '')
      setEstimatedDeliveryDate(updatedOrder.estimatedDeliveryDate ? new Date(updatedOrder.estimatedDeliveryDate).toISOString().split('T')[0] : '')
      setDeliveryDelayReason(updatedOrder.deliveryDelayReason || '')
      setStatusNote('')
      success(`Order ${updatedOrder.orderNumber} updated.`)
    } catch (err) {
      showError(err.message || 'Order update failed')
    } finally {
      setSaving(false)
    }
  }

  const handleReturnRequestUpdate = async () => {
    setSaving(true)
    try {
      const updatedOrder = await updateAdminOrderReturnRequest(order.id, {
        status: returnStatus,
        adminNote: returnAdminNote,
      })
      setOrder(updatedOrder)
      setReturnStatus(updatedOrder.returnRequest?.status || 'requested')
      setReturnAdminNote(updatedOrder.returnRequest?.adminNote || '')
      success(`Return request updated for order ${updatedOrder.orderNumber}.`)
    } catch (err) {
      showError(err.message || 'Return request update failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="shell flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-gray-200 border-t-[#6651A4] rounded-full animate-spin" />
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest animate-pulse">Scanning Blueprint...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="shell space-y-6 md:space-y-8 pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black/[0.05] pb-6 md:pb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="w-10 h-10 md:w-12 md:h-12 bg-white rounded-xl md:rounded-2xl flex items-center justify-center text-gray-400 hover:text-[#6651A4] hover:bg-[#FAEAD3] shadow-sm transition-all shrink-0">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl md:text-3xl font-grandstander font-bold text-gray-800 flex flex-wrap items-center gap-3">
              Order #{order.orderNumber}
              <span className={`px-3 py-1 rounded-full text-[9px] md:text-[10px] font-bold uppercase tracking-widest bg-blue-50 text-blue-600`}>
                {order.statusLabel}
              </span>
            </h1>
            <p className="text-gray-500 font-medium text-[12px] md:text-sm flex flex-wrap items-center gap-2 mt-1">
              <Calendar size={14} /> Placed on {order.date}
              {(order.estimatedDeliveryDate || order.deliveryDate) && (
                <>
                  <span className="text-gray-300">•</span>
                  <span className="text-[#F1641E] font-bold">
                    ETA: {order.estimatedDeliveryDate 
                      ? new Date(order.estimatedDeliveryDate).toLocaleDateString('en-IN', { dateStyle: 'medium' }) 
                      : order.deliveryDate}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        
        <div className="flex gap-3 overflow-x-auto pb-2 md:pb-0">
          <button onClick={() => printOrderInvoice(order)} className="h-10 md:h-12 px-5 bg-white border border-black/[0.05] text-gray-600 rounded-xl md:rounded-2xl font-bold uppercase tracking-widest text-[9px] md:text-[10px] shadow-sm hover:bg-gray-50 flex items-center gap-2 transition-all whitespace-nowrap">
            <Printer size={16} /> Print Invoice
          </button>
          <button onClick={handleSave} disabled={saving} className="h-10 md:h-12 px-6 bg-[#6651A4] text-white rounded-xl md:rounded-2xl font-bold uppercase tracking-widest text-[9px] md:text-[10px] shadow-lg hover:bg-[#5a4892] flex items-center gap-2 transition-all whitespace-nowrap disabled:opacity-60">
            {saving ? 'Saving...' : 'Update Status'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-8">
          {/* Order Items */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[32px] p-6 md:p-8 shadow-sm border border-black/[0.03]">
            <h3 className="text-lg md:text-xl font-grandstander font-bold text-gray-800 mb-6 flex items-center gap-2">
              <Package size={20} className="text-[#6651A4]" /> Package Contents
            </h3>
            <div className="space-y-4">
              {order.items.map(item => (
                <div key={item.id} className="flex items-center justify-between p-4 bg-[#FDF4E6]/30 rounded-[24px] border border-black/[0.02] hover:bg-[#FAEAD3]/50 transition-colors group">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform overflow-hidden">
                      {item.img ? <img src={item.img} alt={item.title} className="w-full h-full object-cover" /> : <Package size={20} className="text-[#6651A4]" />}
                    </div>
                    <div>
                      <p className="text-[14px] md:text-[15px] font-bold text-gray-800">{item.title}</p>
                      <p className="text-[11px] text-gray-400 font-medium">QTY: {item.qty} × ₹{item.price.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[15px] md:text-[16px] font-bold font-grandstander text-[#6651A4]">₹{item.total.toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-8 pt-8 border-t border-dashed border-gray-200 space-y-4">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Subtotal</span>
                <span className="font-bold text-gray-800">₹{order.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>Shipping Fee</span>
                <span className="font-bold text-gray-800">₹{order.shipping.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>Expected Delivery</span>
                <span className="font-bold text-gray-800">
                  {order.estimatedDeliveryDate 
                    ? new Date(order.estimatedDeliveryDate).toLocaleDateString('en-IN', { dateStyle: 'medium' }) 
                    : order.deliveryDate || '-'}
                </span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-sm text-[#E84949]">
                  <span>Discount</span>
                  <span className="font-bold">-₹{order.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-xl md:text-2xl font-grandstander font-bold text-gray-800 pt-2">
                <span>Total Amount</span>
                <span className="text-[#F1641E]">₹{order.total.toFixed(2)}</span>
              </div>
            </div>
          </motion.div>

          {/* Logistics Timeline */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white rounded-[32px] p-6 md:p-8 shadow-sm border border-black/[0.03]">
            <div className="flex justify-between items-center mb-8 flex-wrap gap-4">
              <h3 className="text-lg md:text-xl font-grandstander font-bold text-gray-800 flex items-center gap-2">
                <Truck size={20} className="text-[#6651A4]" /> Journey Tracker
              </h3>
              {order.trackingNumber && (
                <span className="px-4 py-1.5 bg-[#6651A4]/10 text-[#6651A4] rounded-full text-[10px] font-bold uppercase tracking-widest">
                  Tracking: {order.trackingNumber}
                </span>
              )}
            </div>
            <div className="space-y-8 relative before:absolute before:left-4 md:before:left-5 before:top-2 before:bottom-2 before:w-[2px] before:bg-gray-100">
              {timeline.map((step, i) => (
                <div key={i} className="relative pl-12 md:pl-16">
                  <div className={`absolute left-0 top-0 w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center border-4 border-white shadow-md z-10 ${step.done ? 'bg-[#6651A4] text-white' : 'bg-gray-100 text-gray-400'}`}>
                    {step.done ? <CheckCircle size={16} /> : <Clock size={16} />}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <h4 className={`text-[14px] md:text-[15px] font-bold ${step.done ? 'text-gray-800' : 'text-gray-400'}`}>{step.status}</h4>
                      <span className="text-[10px] md:text-[11px] font-medium text-gray-400">{step.time}</span>
                    </div>
                    <p className="text-[12px] md:text-[13px] text-gray-500">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-8">
          {/* Customer Hub */}
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="bg-white rounded-[32px] p-6 md:p-8 shadow-sm border border-black/[0.03]">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-grandstander font-bold text-gray-800">Explorer Info</h3>
              {order.user?._id && <button onClick={() => navigate(`/admin/users/${order.user._id}`)} className="text-[#F1641E] hover:scale-110 transition-transform"><ExternalLink size={18} /></button>}
            </div>
            <div className="flex items-center gap-4 mb-6 p-4 bg-[#FDF4E6]/50 rounded-[24px]">
              <div className="w-12 h-12 bg-[#FAEAD3] rounded-full flex items-center justify-center text-xl font-bold font-grandstander text-[#6651A4]">
                {order.customerName.charAt(0)}
              </div>
                      <div>
                        <p className="text-[15px] font-bold text-gray-800">{order.customerName}</p>
                        <p className="text-[11px] text-gray-400 font-medium">
                          {order.user?.createdAt ? `Joined ${formatJoinedDate(order.user.createdAt)}` : 'Guest checkout'}
                        </p>
                      </div>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-[13px] text-gray-600">
                <Mail size={16} className="text-gray-400 shrink-0" />
                <span className="truncate">{order.customerEmail}</span>
              </div>
              <div className="flex items-center gap-3 text-[13px] text-gray-600">
                <Phone size={16} className="text-gray-400 shrink-0" />
                <span>{order.shippingAddress.phone}</span>
              </div>
              <div className="flex items-start gap-3 text-[13px] text-gray-600 border-t border-black/[0.03] pt-4">
                <MapPin size={16} className="text-gray-400 shrink-0 mt-1" />
                <span className="leading-relaxed">{order.shippingAddress.address}, {order.shippingAddress.city === 'Other' ? order.shippingAddress.district : order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}</span>
              </div>
            </div>
          </motion.div>

          {/* Customer Notes / Gift Requests */}
          {order.notes && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 }} className="bg-white rounded-[32px] p-6 md:p-8 shadow-sm border border-[#F1641E]/10 bg-orange-50/30">
               <h3 className="text-lg font-grandstander font-bold text-gray-800 mb-4 flex items-center gap-2 text-[#F1641E]">
                 <Clock size={18} /> Customer Notes
               </h3>
               <div className="p-4 bg-white border border-orange-100 rounded-2xl italic text-gray-600 text-[13px] leading-relaxed">
                 {order.notes}
               </div>
            </motion.div>
          )}

          {/* Payment Hub */}
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="bg-[#6651A4] rounded-[32px] p-6 md:p-8 text-white shadow-xl relative overflow-hidden">
            <div className="absolute right-0 top-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-16 -mt-16" />
            <div className="relative z-10">
              <h3 className="text-lg font-grandstander font-bold mb-6 flex items-center gap-2">
                <CreditCard size={20} /> Transaction Hub
              </h3>
              <div className="space-y-6">
                <div>
                  <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Payment Method</p>
                  <p className="text-[14px] font-bold">{order.paymentMethodLabel}</p>
                </div>
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Status</p>
                    <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-widest ${order.paymentStatus === 'paid' ? 'bg-green-400 text-[#222222]' : 'bg-amber-300 text-gray-900'}`}>
                      {order.paymentStatusLabel}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Paid Amount</p>
                    <p className="text-xl font-bold font-grandstander">₹{order.total.toFixed(2)}</p>
                  </div>
                </div>

                {order.paymentMethod === 'airpay' && order.paymentStatus !== 'paid' && (
                  <button
                    type="button"
                    onClick={() => handleSyncAirpay(false)}
                    disabled={isSyncingPayment}
                    className="w-full py-2.5 px-3 bg-white/20 hover:bg-white/30 active:scale-[0.98] text-white rounded-xl text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={isSyncingPayment ? 'animate-spin' : ''} />
                    {isSyncingPayment ? 'Checking Airpay...' : 'Sync Airpay Payment'}
                  </button>
                )}
                <div className="space-y-3 pt-2">
                  <select value={status} onChange={(event) => setStatus(event.target.value)} className="w-full h-11 px-4 rounded-xl bg-[#FDF4E6] border border-white/10 text-[#333] text-[11px] font-bold uppercase tracking-widest outline-none">
                    {getAllowedStatusOptions(order.status).map((value) => (
                      <option key={value} value={value}>
                        {value.charAt(0).toUpperCase() + value.slice(1)}
                      </option>
                    ))}
                  </select>
                  <input
                    value={trackingNumber}
                    onChange={(event) => setTrackingNumber(event.target.value)}
                    placeholder="Tracking Number"
                    disabled={!['shipped', 'delivered'].includes(status)}
                    className="w-full h-11 px-4 rounded-xl bg-[#FDF4E6] border border-white/10 text-[#333] text-[11px] font-bold uppercase tracking-widest outline-none placeholder:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <input
                    type="date"
                    value={estimatedDeliveryDate}
                    min={order?.createdAt ? new Date(order.createdAt).toISOString().split('T')[0] : ''}
                    onChange={(event) => setEstimatedDeliveryDate(event.target.value)}
                    className="w-full h-11 px-4 rounded-xl bg-[#FDF4E6] border border-white/10 text-[#333] text-[11px] font-bold uppercase tracking-widest outline-none"
                  />
                  <textarea
                    value={deliveryDelayReason}
                    onChange={(event) => setDeliveryDelayReason(event.target.value)}
                    placeholder="Reason for delivery date change"
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl bg-[#FDF4E6] border border-white/10 text-[#333] text-[11px] font-medium outline-none placeholder:text-gray-400 resize-none"
                  />
                  <textarea
                    value={statusNote}
                    onChange={(event) => setStatusNote(event.target.value)}
                    placeholder="Status update note for this order"
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl bg-[#FDF4E6] border border-white/10 text-[#333] text-[11px] font-medium outline-none placeholder:text-gray-400 resize-none"
                  />
                </div>
                {order.trackingNumber && (
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">
                    Tracking Number: {order.trackingNumber}
                  </p>
                )}
                <p className="text-[10px] text-white/70 font-medium leading-relaxed">
                  Tracking number should be added once the order is shipped so the customer can follow courier movement.
                </p>
                <button 
                  onClick={() => printOrderInvoice(order)}
                  className="w-full h-11 bg-white/10 hover:bg-white/20 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all mt-2 flex items-center justify-center gap-2"
                >
                   View Receipt <ExternalLink size={14} />
                </button>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 }} className="bg-white rounded-[32px] p-6 md:p-8 shadow-sm border border-black/[0.03]">
            <h3 className="text-lg font-grandstander font-bold text-gray-800 mb-6">Return / Refund Request</h3>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Current Status</p>
                <p className="text-[14px] font-bold text-gray-800">{order.returnRequest?.statusLabel || 'No Request'}</p>
              </div>
              {order.returnRequest?.reason && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Customer Reason</p>
                  <p className="text-[12px] text-gray-600">{order.returnRequest.reason}</p>
                </div>
              )}
              {order.returnRequest?.status === 'none' && (
                <p className="text-[12px] text-gray-500">No return or refund request has been submitted for this order yet.</p>
              )}
              {order.returnRequest?.status !== 'none' && (
                <>
                  <select value={returnStatus} onChange={(event) => setReturnStatus(event.target.value)} className="w-full h-11 px-4 rounded-xl bg-[#FDF4E6] border border-black/[0.05] text-[#333] text-[11px] font-bold uppercase tracking-widest outline-none">
                    {getReturnStatusOptions(order.returnRequest?.status).map((val) => (
                      <option key={val} value={val}>
                        {val.charAt(0).toUpperCase() + val.slice(1)}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={returnAdminNote}
                    onChange={(event) => setReturnAdminNote(event.target.value)}
                    placeholder="Admin note for this return request"
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl bg-[#FDF4E6] border border-black/[0.05] text-[#333] text-[11px] font-medium outline-none placeholder:text-gray-400 resize-none"
                  />
                  <button onClick={handleReturnRequestUpdate} disabled={saving} className="w-full h-11 bg-[#333] text-white rounded-xl text-[10px] font-bold uppercase tracking-widest disabled:opacity-60">
                    {saving ? 'Saving...' : 'Update Return Request'}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
