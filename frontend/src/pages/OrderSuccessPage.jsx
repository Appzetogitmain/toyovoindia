import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CheckCircle2, Package, Truck, ShoppingBag, ArrowRight, ChevronRight, MapPin, ExternalLink, Calendar, Heart, Phone } from 'lucide-react'
import { getOrderSummary } from '../services/orderApi'
import { getStorefrontSettings } from '../services/siteApi'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/AuthContext'

const TrackingStep = ({ icon: Icon, label, status, active }) => (
  <div className="flex flex-col items-center gap-2 relative z-10">
    <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-500 border-2 ${active ? 'bg-[#333] text-white border-[#333] shadow-md' : 'bg-[#FAEAD3] text-[#333]/20 border-[#333]/5'}`}>
       <Icon size={20} />
    </div>
    <div className="text-center">
       <p className={`text-[9px] font-bold uppercase tracking-widest ${active ? 'text-[#333]' : 'text-[#333]/20'}`}>{label}</p>
       <p className="text-[8px] text-[#333]/40 font-bold uppercase mt-0.5">{status}</p>
    </div>
  </div>
)

export function OrderSuccessPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { clearCart } = useCart()
  const { user } = useAuth()
  const [order, setOrder] = useState(location.state?.order || null)
  const [loading, setLoading] = useState(!location.state?.order)
  const [settings, setSettings] = useState(null)

  const getExpectedArrivalDate = () => {
    if (order?.deliveryDate) return order.deliveryDate
    const baseDate = order?.createdAt ? new Date(order.createdAt) : new Date()
    
    const minDate = new Date(baseDate)
    minDate.setDate(minDate.getDate() + 5)
    
    const maxDate = new Date(baseDate)
    maxDate.setDate(maxDate.getDate() + 7)
    
    const formatDate = (date) => {
      const day = date.getDate()
      const month = date.toLocaleString('en-IN', { month: 'short' })
      const getSuffix = (d) => {
        if (d > 3 && d < 21) return 'th'
        switch (d % 10) {
          case 1:  return "st"
          case 2:  return "nd"
          case 3:  return "rd"
          default: return "th"
        }
      }
      return `${day}${getSuffix(day)} ${month}`
    }
    
    return `${formatDate(minDate)} - ${formatDate(maxDate)}`
  }

  const getProgressWidth = (status) => {
    switch (status) {
      case 'pending': return '0%'
      case 'processing': return '25%'
      case 'shipped': return '50%'
      case 'delivered': return '75%'
      default: return '0%'
    }
  }

  const getStepStatus = (step, currentStatus) => {
    if (currentStatus === 'cancelled') return 'Cancelled'
    
    if (step === 'ordered') {
      return 'Success'
    }
    if (step === 'packing') {
      if (currentStatus === 'pending') return 'Upcoming'
      if (currentStatus === 'processing') return 'Processing'
      return 'Success'
    }
    if (step === 'transit') {
      if (currentStatus === 'pending' || currentStatus === 'processing') return 'Upcoming'
      if (currentStatus === 'shipped') return 'In Transit'
      return 'Success'
    }
    if (step === 'arrival') {
      if (currentStatus === 'delivered') return 'Success'
      return 'Upcoming'
    }
    return 'Upcoming'
  }

  const isStepActive = (step, currentStatus) => {
    if (currentStatus === 'cancelled') return false
    
    if (step === 'ordered') return true
    if (step === 'packing') return ['processing', 'shipped', 'delivered'].includes(currentStatus)
    if (step === 'transit') return ['shipped', 'delivered'].includes(currentStatus)
    if (step === 'arrival') return currentStatus === 'delivered'
    return false
  }

  useEffect(() => {
    window.scrollTo(0, 0)

    const searchParams = new URLSearchParams(location.search);
    const orderNumberFromUrl = searchParams.get('orderNumber');

    const orderObj = location.state?.order
    if (orderObj) {
      const orderNum = orderObj.orderNumber
      if (sessionStorage.getItem(`TOYOVOINDIA_order_visited_${orderNum}`) === 'true') {
        navigate('/', { replace: true })
        return
      }
      
      clearCart()
      localStorage.removeItem(`TOYOVOINDIA_checkout_coupon`)
      localStorage.removeItem(`TOYOVOINDIA_checkout_draft_${user?.id || user?._id || user?.email || 'guest'}`)
      sessionStorage.removeItem('TOYOVOINDIA_buyNowItem')

      sessionStorage.setItem('TOYOVOINDIA_last_order', JSON.stringify({
        orderNumber: orderNum,
        email: orderObj.customerEmail,
      }))
      return
    }

    const lastOrder = sessionStorage.getItem('TOYOVOINDIA_last_order')
    let parsedLastOrder = null;
    try {
      if (lastOrder) parsedLastOrder = JSON.parse(lastOrder);
    } catch {}

    const targetOrderNumber = orderNumberFromUrl || parsedLastOrder?.orderNumber;
    const targetEmail = searchParams.get('email') || parsedLastOrder?.email;
    const targetToken = searchParams.get('token') || parsedLastOrder?.token;

    if (!targetOrderNumber) {
      navigate('/', { replace: true })
      return
    }

    let isMounted = true
    const restoreOrder = async () => {
      setLoading(true)
      try {
        const data = await getOrderSummary(targetOrderNumber, targetEmail, targetToken)
        if (isMounted) {
          setOrder(data)
          clearCart()
          localStorage.removeItem(`TOYOVOINDIA_checkout_coupon`)
          localStorage.removeItem(`TOYOVOINDIA_checkout_draft_${user?.id || user?._id || user?.email || 'guest'}`)
          sessionStorage.removeItem('TOYOVOINDIA_buyNowItem')
        }
      } catch {
        if (isMounted) navigate('/', { replace: true })
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    restoreOrder()
    return () => {
      isMounted = false
      if (orderObj) {
        sessionStorage.setItem(`TOYOVOINDIA_order_visited_${orderObj.orderNumber}`, 'true')
      } else if (targetOrderNumber) {
        sessionStorage.setItem(`TOYOVOINDIA_order_visited_${targetOrderNumber}`, 'true')
      }
      sessionStorage.removeItem('TOYOVOINDIA_last_order')
    }
  }, [location.state, location.search, navigate])

  useEffect(() => {
    let isMounted = true
    getStorefrontSettings().then(data => {
      if (isMounted) setSettings(data)
    }).catch(console.error)
    return () => { isMounted = false }
  }, [])

  if (loading) return null
  if (!order) return null

  return (
    <div className="bg-[#FDF4E6] min-h-screen font-roboto pb-20">
      {/* Decorative Background Elements */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-5 z-0">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="absolute" style={{ top: `${Math.random()*100}%`, left: `${Math.random()*100}%` }}>
               <ShoppingBag size={200 + i * 50} className="text-[#333]" />
            </div>
          ))}
      </div>
      
      <div className="max-w-[1300px] mx-auto px-4 lg:px-8 py-8 lg:py-12 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
          
          {/* Left Column: Confirmation & Tracking */}
          <div className="lg:col-span-8 space-y-6">
             <motion.div 
               initial={{opacity:0, y:20}} 
               animate={{opacity:1, y:0}}
               className="bg-[#FAEAD3] p-6 md:p-10 rounded-2xl border border-[#333]/5 shadow-sm relative overflow-hidden"
             >
                <div className="relative z-10 flex flex-col md:flex-row items-center md:items-start gap-8">
                   <motion.div 
                     initial={{scale:0}} animate={{scale:1}} transition={{type:'spring', damping:12}}
                     className="w-20 h-20 bg-[#E84949] rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-[#E84949]/20"
                   >
                      <CheckCircle2 size={40} className="text-white" />
                   </motion.div>
                   
                   <div className="text-center md:text-left space-y-3">
                      <h1 className="text-4xl md:text-5xl font-grandstander font-bold text-[#333] tracking-tight">Order Confirmed!</h1>
                      <p className="text-[14px] text-[#333]/60 font-medium leading-relaxed max-w-lg">
                        Success! Your toy voyage has officially set sail. Your order is estimated to arrive by <span className="text-[#333] font-bold">{getExpectedArrivalDate()}</span>.
                        <br />
                        For any help, please reach out to our helpline: <a href={`tel:${settings?.contactInfo?.phone || '+91'}`} className="text-[#E84949] font-bold underline decoration-dotted">{settings?.contactInfo?.phone || 'Customer Support'}</a>.
                      </p>
                   </div>
                </div>

                {/* Tracking Progress */}
                <div className="mt-12 mb-8 relative">
                   <div className="absolute top-6 left-[12.5%] right-[12.5%] h-[1.5px] bg-[#333]/5" />
                   <div className="absolute top-6 left-[12.5%] h-[1.5px] bg-[#E84949] transition-all duration-500" style={{ width: getProgressWidth(order.status) }} />
                   <div className="grid grid-cols-4 gap-2">
                      <TrackingStep icon={ShoppingBag} label="Ordered" status={getStepStatus('ordered', order.status)} active={isStepActive('ordered', order.status)} />
                      <TrackingStep icon={Package} label="Packing" status={getStepStatus('packing', order.status)} active={isStepActive('packing', order.status)} />
                      <TrackingStep icon={Truck} label="Transit" status={getStepStatus('transit', order.status)} active={isStepActive('transit', order.status)} />
                      <TrackingStep icon={CheckCircle2} label="Arrival" status={getStepStatus('arrival', order.status)} active={isStepActive('arrival', order.status)} />
                   </div>
                </div>

                {/* Info Grid */}
                <div className="mt-12 pt-10 border-t border-[#333]/10 flex flex-col md:grid md:grid-cols-2 gap-10 md:gap-6">
                   <div className="space-y-4">
                      <h4 className="text-[11px] font-bold text-[#333]/40 uppercase tracking-[0.2em] flex items-center gap-2">
                        <MapPin size={14} className="text-[#E84949]"/> Shipping Destination
                      </h4>
                      <div className="p-6 bg-white/50 rounded-xl border border-[#333]/5">
                         <p className="text-[14px] font-bold text-[#333] mb-1">{order.shippingAddress.firstName} {order.shippingAddress.lastName}</p>
                         <p className="text-[13px] text-[#333]/60 leading-relaxed font-medium">
                            {order.shippingAddress.address}, {order.shippingAddress.city === 'Other' ? order.shippingAddress.district : order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}
                         </p>
                         <p className="text-[12px] text-[#333]/60 mt-3 font-bold flex items-center gap-1.5 uppercase tracking-widest">
                            <Phone size={12} className="text-[#E84949]" />
                            {order.shippingAddress.phone}
                         </p>
                      </div>
                   </div>
                   
                   <div className="space-y-4">
                      <h4 className="text-[11px] font-bold text-[#333]/40 uppercase tracking-[0.2em] flex items-center gap-2">
                        <Calendar size={14} className="text-[#E84949]"/> Expected Arrival
                      </h4>
                      <div className="p-6 bg-white/50 rounded-xl border border-[#333]/5 flex flex-col justify-center min-h-[120px]">
                         <p className="text-3xl font-bold font-grandstander text-[#333] tracking-tighter">{getExpectedArrivalDate()}</p>
                         <p className="text-[10px] text-[#E84949] font-bold uppercase tracking-widest mt-2">Standard Delivery Method</p>
                         {order.deliveryDelayReason && <p className="text-[11px] text-[#333]/60 mt-3 font-medium">{order.deliveryDelayReason}</p>}
                      </div>
                   </div>
                </div>
             </motion.div>

             {/* Action Buttons */}
             <div className="flex flex-col md:flex-row gap-4 pt-2">
                <Link to="/account/orders" className="flex-1 py-5 bg-[#333] text-white rounded-xl flex items-center justify-center gap-3 font-bold uppercase tracking-widest text-[12px] hover:bg-[#E84949] transition-all shadow-lg active:scale-[0.98]">
                   View My Orders <ExternalLink size={18}/>
                </Link>
                <Link to="/" className="flex-1 py-5 bg-white border-2 border-[#333] text-[#333] rounded-xl flex items-center justify-center gap-3 font-bold uppercase tracking-widest text-[12px] hover:bg-[#333] hover:text-white transition-all active:scale-[0.98]">
                   Continue Shopping <ArrowRight size={18}/>
                </Link>
             </div>
          </div>

          {/* Right Column: Order Summary */}
          <div className="lg:col-span-4">
             <motion.div 
               initial={{opacity:0, x:20}} animate={{opacity:1, x:0}} transition={{delay:0.3}}
               className="bg-[#FAEAD3] p-8 rounded-2xl border-2 border-dashed border-[#333]/10 sticky top-10"
             >
                <div className="flex items-center justify-between border-b border-[#333]/10 pb-6 mb-8">
                   <h3 className="text-xl font-bold text-[#333] font-grandstander">Order Bill</h3>
                   <span className="px-3 py-1.5 bg-white text-[#333] text-[9px] font-bold rounded-lg uppercase tracking-widest border border-[#333]/5 shadow-sm">ID: #{order.orderNumber}</span>
                </div>

                <div className="space-y-6 max-h-[340px] overflow-y-auto px-2 py-4 custom-scrollbar">
                   {order.items.map((item, idx) => (
                     <div key={idx} className="flex items-center gap-4 group">
                        <div className="w-14 h-14 bg-white rounded-xl shrink-0 border border-[#333]/5 relative shadow-sm overflow-hidden">
                           <img src={item.img} className="w-full h-full object-contain p-1 rounded-xl" />
                        </div>
                        <div className="grow">
                           <h4 className="text-[13px] font-bold text-[#333] font-grandstander line-clamp-1">{item.title}</h4>
                           <p className="text-[10px] text-[#333]/40 font-bold uppercase tracking-widest">Qty: {item.qty} · ₹{item.price.toFixed(2)}</p>
                        </div>
                        <span className="text-[14px] font-bold text-[#333] tracking-tighter">₹{(item.price * item.qty).toFixed(2)}</span>
                     </div>
                   ))}
                </div>

                <div className="mt-10 pt-8 border-t border-[#333]/10 space-y-4">
                   <div className="flex justify-between text-[13px] font-bold text-[#333]/60 uppercase tracking-widest">
                      <span>Subtotal</span>
                      <span className="text-[#333]">₹{order.subtotal.toFixed(2)}</span>
                   </div>
                   <div className="flex justify-between text-[13px] font-bold text-[#333]/60 uppercase tracking-widest">
                      <span>Shipping</span>
                      <span className="text-[#333]">₹{order.shipping.toFixed(2)}</span>
                   </div>
                   {order.discount > 0 && (
                     <div className="flex justify-between text-[13px] font-bold text-[#E84949] uppercase tracking-widest">
                        <span>Discount Applied</span>
                        <span className="tracking-tighter">-₹{order.discount.toFixed(2)}</span>
                     </div>
                   )}
                   <div className="flex justify-between items-center pt-8 mt-6 border-t border-[#333]/10">
                      <span className="text-[20px] font-bold font-grandstander text-[#333]">Total Paid</span>
                      <div className="text-right">
                         <span className="text-[9px] font-bold text-[#333]/30 uppercase tracking-[0.2em] block mb-2">{order.paymentMethodLabel}</span>
                         <span className="text-4xl font-bold font-grandstander text-[#E84949] tracking-tighter leading-tight">₹{order.total.toFixed(2)}</span>
                      </div>
                   </div>
                </div>

                <div className="mt-8 p-5 bg-white/30 rounded-xl border border-[#333]/5 flex items-center gap-4">
                   <div className="w-10 h-10 rounded-full bg-[#E84949]/10 flex items-center justify-center shrink-0">
                      <Heart size={18} className="text-[#E84949]"/>
                   </div>
                   <p className="text-[10px] text-[#333]/60 font-bold uppercase tracking-[0.15em] leading-relaxed">
                      Your choice fuels our joy!
                   </p>
                </div>
             </motion.div>
          </div>

        </div>
      </div>
    </div>
  )
}
