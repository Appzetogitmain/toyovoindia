import { useState, useEffect, useRef, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ShoppingBag, ChevronRight, ShoppingCart, Check, ChevronDown, ChevronUp, Tag, AlertCircle } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { usePayment } from '../context/PaymentContext'
import { useAuth } from '../context/AuthContext'
import { validateCouponCode, getActiveCoupons } from '../services/couponApi'
import { createPayuPaymentOrder, createPhonepePaymentOrder, createJiopayPaymentOrder, createAirpayPaymentOrder, checkAirpayPaymentStatus } from '../services/orderApi'
import { getShippingMethods } from '../services/shippingApi'
import { getStorefrontSettings } from '../services/siteApi'

const countries = ["India"]
import { indianStates, commonCities } from '../utils/indiaData'

const CHECKOUT_COUPON_STORAGE_KEY = 'TOYOVOINDIA_checkout_coupon'
const getCheckoutDraftKey = (user) => `TOYOVOINDIA_checkout_draft_${user?.id || user?._id || user?.email || 'guest'}`



const FloatingInput = ({ label, name, type = 'text', value, onChange, placeholder = ' ', error, prefix }) => (
  <div className="relative group w-full mb-4">
    <div className="relative">
      {prefix && (
        <span className="absolute left-4 top-0 h-14 pt-4 pb-2 flex items-center text-[14px] font-bold text-[#333] pointer-events-none select-none z-10">
          {prefix}
        </span>
      )}
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`peer w-full h-14 ${prefix ? 'pl-10' : 'px-4'} pt-4 pb-2 bg-white border ${error ? 'border-red-500' : 'border-gray-300'} rounded-xl outline-none transition-all focus:border-[#E84949] focus:ring-1 focus:ring-[#E84949] placeholder-transparent text-[14px] font-bold text-[#333]`}
      />
      <label className={`absolute left-4 ${prefix ? 'peer-placeholder-shown:left-10' : ''} top-1 text-[10px] font-bold ${error ? 'text-red-500' : 'text-gray-400'} uppercase tracking-widest transition-all peer-placeholder-shown:text-[13px] ${prefix ? 'peer-placeholder-shown:top-[22px]' : 'peer-placeholder-shown:top-4'} peer-focus:top-1 peer-focus:left-4 peer-focus:text-[10px] peer-focus:text-[#E84949] pointer-events-none truncate max-w-[calc(100%-32px)] block`}>
        {label}
      </label>
    </div>
    {error && <p className="text-[10px] text-red-500 font-bold mt-1 ml-1 uppercase tracking-tight">{error}</p>}
  </div>
)

const FloatingSelect = ({ label, name, value, onChange, options, error }) => (
  <div className="relative group w-full mb-4">
    <div className="relative">
      <select
        name={name}
        value={value}
        onChange={onChange}
        className={`peer w-full h-14 px-4 pt-4 bg-white border ${error ? 'border-red-500' : 'border-gray-300'} rounded-xl outline-none transition-all focus:border-[#E84949] appearance-none`}
      >
        {options.map(opt => {
          let labelText = opt;
          if (opt === "") {
            if (name === "state") labelText = "Select State";
            else if (name === "city") labelText = "Select City";
          }
          return <option key={opt} value={opt}>{labelText}</option>;
        })}
      </select>
      <label className={`absolute left-4 top-1 text-[10px] font-bold ${error ? 'text-red-500' : 'text-gray-400'} uppercase tracking-widest pointer-events-none`}>
        {label}
      </label>
      <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
    </div>
    {error && <p className="text-[10px] text-red-500 font-bold mt-1 ml-1 uppercase tracking-tight">{error}</p>}
  </div>
)

// Function to dynamically build and submit PayU form
const submitPayuForm = (payuData) => {
  const form = document.createElement('form');
  form.setAttribute('method', 'POST');
  form.setAttribute('action', `${payuData.payuBaseUrl}/_payment`);

  const addField = (name, value) => {
    const input = document.createElement('input');
    input.setAttribute('type', 'hidden');
    input.setAttribute('name', name);
    input.setAttribute('value', value);
    form.appendChild(input);
  };

  addField('key', payuData.key);
  addField('txnid', payuData.txnid);
  addField('amount', payuData.amount);
  addField('productinfo', payuData.productinfo);
  addField('firstname', payuData.firstname);
  addField('email', payuData.email);
  addField('phone', payuData.phone);
  addField('surl', payuData.surl);
  addField('furl', payuData.furl);
  addField('hash', payuData.hash);

  document.body.appendChild(form);
  form.submit();
}

// JioPay's hosted checkout is reached with a plain GET redirect:
// <redirectURI>?tranCtx=<tranCtx>
const redirectToJiopay = (jiopayData) => {
  window.location.href = `${jiopayData.redirectURI}?tranCtx=${encodeURIComponent(jiopayData.tranCtx)}`;
}

const submitAirpayForm = (airpayData) => {
  const form = document.createElement('form');
  form.setAttribute('method', 'POST');
  form.setAttribute('action', airpayData.airpayBaseUrl || 'https://payments.airpay.co.in/pay/index.php');
  form.style.display = 'none';

  const addedFields = new Set();
  const addField = (name, value) => {
    if (value === undefined || value === null || addedFields.has(name)) return;
    addedFields.add(name);
    const input = document.createElement('input');
    input.setAttribute('type', 'hidden');
    input.setAttribute('name', name);
    input.setAttribute('value', String(value));
    form.appendChild(input);
  };

  const returnTarget = airpayData.return_url || airpayData.returnUrl || airpayData.returnurl || 'https://www.toyovoindia.com/api/payments/airpay/response';

  Object.entries(airpayData).forEach(([field, value]) => {
    if (field !== 'airpayBaseUrl' && field !== 'orderNumber' && value !== undefined && value !== null) {
      addField(field, value);
    }
  });

  addField('return_url', returnTarget);
  addField('returnurl', returnTarget);
  addField('returnUrl', returnTarget);
  addField('success_url', returnTarget);

  document.body.appendChild(form);
  form.submit();
};

const isMongoObjectId = (value) => {
  if (!value || typeof value !== 'string') return false;
  return /^[0-9a-fA-F]{24}$/.test(value);
};

const toOptionalString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value);
};

const toSlugString = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  return String(value).trim()
};


const cleanPhoneForForm = (phone) => {
  if (!phone) return ''
  let cleaned = String(phone).trim()
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.slice(3).trim()
  } else if (cleaned.startsWith('91') && cleaned.length > 10) {
    cleaned = cleaned.slice(2).trim()
  }
  return cleaned.replace(/\D/g, '').slice(0, 10)
}

const cleanPostalCode = (zip) => {
  if (!zip) return ''
  return String(zip).replace(/\D/g, '').slice(0, 6)
}
// Stable component outside to prevent focus loss on re-renders
const CouponSection = ({ 
  discountCode, 
  setDiscountCode, 
  applyDiscount, 
  isApplyingCoupon, 
  couponError, 
  isDiscountApplied, 
  couponState,
  compact = false,
  activeCoupons = []
}) => (
  <div className={compact ? 'mt-5 pt-5 border-t border-gray-100' : 'mt-10'}>
    <div className="flex gap-3">
      <div className="relative grow">
        <input
          type="text"
          placeholder="Discount code"
          value={discountCode}
          onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
          className="w-full h-12 px-4 pr-10 bg-white border border-gray-300 rounded-xl outline-none focus:border-[#E84949] font-bold text-[13px] shadow-sm transition-all"
        />
        <Tag size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" />
      </div>
      <button 
        onClick={applyDiscount} 
        disabled={isApplyingCoupon || !discountCode.trim()} 
        className="h-12 px-6 bg-[#333] text-white font-bold rounded-xl text-[12px] uppercase tracking-widest hover:bg-[#E84949] transition-all disabled:opacity-50 whitespace-nowrap shadow-sm"
      >
        {isApplyingCoupon ? '...' : 'Apply'}
      </button>
    </div>
    {couponError && <p className="mt-3 text-[11px] font-bold text-[#E84949] flex items-center gap-1"><AlertCircle size={12}/> {couponError}</p>}
    {isDiscountApplied && <p className="mt-3 text-[11px] font-bold text-green-600 flex items-center gap-1"><Check size={12}/> {couponState?.coupon?.code} applied successfully.</p>}

    {activeCoupons.length > 0 && (
      <div className="mt-3">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Available Coupons (Click to apply):</p>
        <div className="flex flex-wrap gap-1.5">
          {activeCoupons.map((c) => (
            <button
              key={c.id || c.code}
              type="button"
              onClick={() => setDiscountCode(c.code)}
              className={`px-2.5 py-1 rounded-full border text-[10px] font-black transition-all ${
                discountCode === c.code
                  ? 'bg-[#E84949] border-[#E84949] text-white shadow-sm'
                  : 'bg-white border-gray-200 text-[#333] hover:border-[#E84949] hover:text-[#E84949]'
              }`}
              title={c.title}
            >
              {c.code}
            </button>
          ))}
        </div>
      </div>
    )}
  </div>
)

export function CheckoutPage() {
  const { cartItems: originalCartItems, subtotal: originalSubtotal, clearCart } = useCart()
  const [buyNowItem] = useState(() => {
    try {
      const item = sessionStorage.getItem('TOYOVOINDIA_buyNowItem')
      return item ? JSON.parse(item) : null
    } catch {
      return null
    }
  })
  const cartItems = useMemo(() => {
    return buyNowItem ? [buyNowItem] : originalCartItems
  }, [buyNowItem, originalCartItems])

  const subtotal = useMemo(() => {
    return buyNowItem
      ? Number(buyNowItem.price || 0) * Number(buyNowItem.qty || 1)
      : originalSubtotal
  }, [buyNowItem, originalSubtotal])

  const { addPaymentLog } = usePayment()
  const { user, addresses, authLoading } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  
  const [showSummary, setShowSummary] = useState(false)
  const [isLaunchingPayment, setIsLaunchingPayment] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [discountCode, setDiscountCode] = useState(() => localStorage.getItem(CHECKOUT_COUPON_STORAGE_KEY) || '')
  const [isDiscountApplied, setIsDiscountApplied] = useState(false)
  const [couponState, setCouponState] = useState(null)
  const [couponError, setCouponError] = useState('')
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false)
  const [couponHydrated, setCouponHydrated] = useState(false)
  const [shippingMethod, setShippingMethod] = useState('standard')
  const [paymentGateway, setPaymentGateway] = useState('airpay') // Default to Airpay for user testing
  const [shippingMethods, setShippingMethods] = useState([])
  const [checkoutNotes, setCheckoutNotes] = useState({ orderMessage: '', giftWrap: false, giftMessage: '' })
  const [isHydrated, setIsHydrated] = useState(false)
  const [freeShippingThreshold, setFreeShippingThreshold] = useState(999)
  const [activeCoupons, setActiveCoupons] = useState([])
  const [availableGateways, setAvailableGateways] = useState({ phonepeEnabled: true, payuEnabled: true, jiopayEnabled: true, airpayEnabled: true })

  useEffect(() => {
    getStorefrontSettings()
      .then((data) => {
        if (data && typeof data.freeShippingThreshold === 'number') {
          setFreeShippingThreshold(data.freeShippingThreshold)
        }
        if (data?.paymentGateways) {
          setAvailableGateways(data.paymentGateways)
          if (data.paymentGateways.airpayEnabled) {
            setPaymentGateway('airpay')
          } else if (data.paymentGateways.jiopayEnabled) {
            setPaymentGateway('jiopay')
          } else if (data.paymentGateways.phonepeEnabled) {
            setPaymentGateway('phonepe')
          } else if (data.paymentGateways.payuEnabled) {
            setPaymentGateway('payu')
          }
        }
      })
      .catch(console.error)
    
    getActiveCoupons()
      .then(setActiveCoupons)
      .catch(console.error)
  }, [])

  // Auto-recovery: If user lands on checkout after an initiated Airpay order (e.g. Airpay internal crash or back button)
  useEffect(() => {
    const checkRecoverPendingAirpay = async () => {
      try {
        const stored = sessionStorage.getItem('pendingOrder') || sessionStorage.getItem('TOYOVOINDIA_last_order');
        if (!stored) return;
        const parsed = JSON.parse(stored);
        const lookup = parsed?.orderNumber || parsed?.txnid;
        if (!lookup) return;

        const res = await checkAirpayPaymentStatus(lookup);
        const isSuccess = res?.status === 'success' || res?.paymentStatus === 'paid' || res?.data?.status === 'success' || res?.data?.paymentStatus === 'paid';
        if (isSuccess) {
          const email = res?.email || res?.data?.email || parsed?.email || '';
          const token = res?.token || res?.data?.token || parsed?.orderToken || parsed?.token || '';
          const emailParam = email ? `&email=${encodeURIComponent(email)}` : '';
          const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
          sessionStorage.removeItem('pendingOrder');
          sessionStorage.removeItem('TOYOVOINDIA_last_order');
          clearCart();
          const targetNum = res?.orderNumber || res?.data?.orderNumber || parsed?.orderNumber || lookup;
          navigate(`/order-success?orderNumber=${targetNum}${emailParam}${tokenParam}`, { replace: true });
        }
      } catch (e) {
        // Silently ignore if not paid yet
      }
    };
    checkRecoverPendingAirpay();
  }, [navigate, clearCart])

  // Ref to skip the coupon-reset effect on the very first render
  const couponResetSkipRef = useRef(false)
  
  // Address Management
  const defaultAddress = addresses?.find(a => a.isDefault) || (addresses?.length > 0 ? addresses[0] : null);
  const [useSavedAddress, setUseSavedAddress] = useState(addresses?.length > 0)
  const [selectedAddressId, setSelectedAddressId] = useState(defaultAddress?.id || null)

  const [formData, setFormData] = useState({
    email: user?.email || '',
    firstName: defaultAddress?.firstName || user?.firstName || '',
    lastName: defaultAddress?.lastName || user?.lastName || '',
    address: defaultAddress?.address || '',
    apartment: defaultAddress?.apartment || '',
    city: defaultAddress?.city || '',
    country: 'India',
    state: defaultAddress?.state || '',
    postalCode: cleanPostalCode(defaultAddress?.postalCode || ''),
    phone: cleanPhoneForForm(defaultAddress?.phone || user?.phone || ''),
    upiId: '',
    district: defaultAddress?.district || ''
  })
  const [formErrors, setFormErrors] = useState({})
  const checkoutDraftKey = getCheckoutDraftKey(user)

  useEffect(() => {
    try {
      const savedDraft = localStorage.getItem(checkoutDraftKey)
      if (!savedDraft) return
      const parsed = JSON.parse(savedDraft)
      if (parsed?.formData) {
        setFormData((prev) => ({ ...prev, ...parsed.formData }))
      }
      if (parsed?.shippingMethod) setShippingMethod(parsed.shippingMethod)
      if (parsed?.discountCode) setDiscountCode(parsed.discountCode)
      if (typeof parsed?.useSavedAddress === 'boolean') setUseSavedAddress(parsed.useSavedAddress)
      if (parsed?.selectedAddressId !== undefined) setSelectedAddressId(parsed.selectedAddressId)
      if (parsed?.checkoutNotes) setCheckoutNotes(parsed.checkoutNotes)
      // Restore validated coupon state optimistically — rehydration effect will re-validate
      if (parsed?.couponState) {
        setCouponState(parsed.couponState)
        setIsDiscountApplied(true)
        // NOTE: intentionally NOT setting couponHydrated=true here
        // so the rehydration effect can re-validate with the correct shipping charge
      }
      setIsHydrated(true)
    } catch {
      setIsHydrated(true)
    }
  }, [checkoutDraftKey])

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login?next=%2Fcheckout', { replace: true })
    }
  }, [authLoading, user, navigate])

  useEffect(() => {
    const errorParam = searchParams.get('error')
    if (errorParam) {
      const msg = errorParam === 'PaymentCancelled' 
        ? 'Payment was cancelled. Your order was not completed. You can try again.' 
        : `Payment failed: ${errorParam}`;
      setFormErrors(prev => ({ ...prev, general: msg }))
      setSearchParams(new URLSearchParams(), { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      email: user?.email || prev.email,
      firstName: prev.firstName || defaultAddress?.firstName || user?.firstName || '',
      lastName: prev.lastName || defaultAddress?.lastName || user?.lastName || '',
      address: prev.address || defaultAddress?.address || '',
      apartment: prev.apartment || defaultAddress?.apartment || '',
      city: prev.city || defaultAddress?.city || '',
      state: prev.state || defaultAddress?.state || '',
      postalCode: prev.postalCode ? cleanPostalCode(prev.postalCode) : cleanPostalCode(defaultAddress?.postalCode || ''),
      phone: prev.phone ? cleanPhoneForForm(prev.phone) : cleanPhoneForForm(defaultAddress?.phone || user?.phone || ''),
      district: prev.district || defaultAddress?.district || '',
    }))
  }, [user, defaultAddress])

  useEffect(() => {
    localStorage.setItem(CHECKOUT_COUPON_STORAGE_KEY, discountCode)
  }, [discountCode])

  useEffect(() => {
    if (!isHydrated) return
    const draft = {
      formData,
      shippingMethod,
      paymentGateway,
      discountCode,
      // persist coupon state so it survives navigating back to this page
      couponState: couponState || null,
      useSavedAddress,
      selectedAddressId,
      checkoutNotes,
    }
    localStorage.setItem(checkoutDraftKey, JSON.stringify(draft))
  }, [checkoutDraftKey, formData, shippingMethod, paymentGateway, discountCode, couponState, useSavedAddress, selectedAddressId, checkoutNotes, isHydrated])

  const selectedShippingMethod = shippingMethods.find((method) => method.code === shippingMethod) || null
  const shippingCharge = Number(selectedShippingMethod?.charge || 0)
  const discountAmount = couponState?.discountAmount || 0
  const total = subtotal + shippingCharge - discountAmount

  useEffect(() => {
    setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }, 10);
  }, [])

  useEffect(() => {
    let isMounted = true

    const loadShippingMethods = async () => {
      try {
        const methods = await getShippingMethods(subtotal)
        if (!isMounted) return
        setShippingMethods(methods)
        if (methods.length > 0) {
          setShippingMethod((prev) => methods.some((method) => method.code === prev) ? prev : methods[0].code)
        }
      } catch {
        if (!isMounted) return
        const fallbackMethods = [
          { id: 'standard', code: 'standard', name: 'Standard Shipping', minDays: 3, maxDays: 5, charge: subtotal >= freeShippingThreshold ? 0 : 15 },
          { id: 'express', code: 'express', name: 'Express Delivery', minDays: 1, maxDays: 2, charge: 45 },
        ]
        setShippingMethods(fallbackMethods)
        setShippingMethod((prev) => fallbackMethods.some((method) => method.code === prev) ? prev : fallbackMethods[0].code)
      }
    }

    loadShippingMethods()
    return () => {
      isMounted = false
    }
  }, [subtotal])

  useEffect(() => {
    if (!isLaunchingPayment && !isProcessing) {
      return undefined
    }

    const originalHtmlOverflow = document.documentElement.style.overflow
    const originalBodyOverflow = document.body.style.overflow
    const originalHtmlPosition = document.documentElement.style.position
    const originalBodyPosition = document.body.style.position
    const originalBodyWidth = document.body.style.width
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    document.documentElement.style.position = 'relative'
    document.body.style.position = 'relative'
    document.body.style.width = '100%'

    return () => {
      document.documentElement.style.overflow = originalHtmlOverflow
      document.body.style.overflow = originalBodyOverflow
      document.documentElement.style.position = originalHtmlPosition
      document.body.style.position = originalBodyPosition
    }
  }, [isLaunchingPayment, isProcessing])

  const handleInputChange = (e) => {
    let { name, value } = e.target
    if (name === 'postalCode') {
      value = value.replace(/\D/g, '').slice(0, 6)
    } else if (name === 'phone') {
      value = value.replace(/\D/g, '').slice(0, 10)
    } else if (name === 'firstName' || name === 'lastName') {
      value = value.replace(/[^a-zA-Z\s]/g, '')
    }
    setFormData(prev => ({ ...prev, [name]: value }))
    // Clear error for this field
    if (formErrors[name]) {
      setFormErrors(prev => {
        const next = { ...prev }
        delete next[name]
        return next
      })
    }
  }

  const validateForm = () => {
    const errors = {}

    // Email Validation: required, RFC 5322 standard
    const emailVal = toOptionalString(formData.email).trim()
    if (!emailVal) {
      errors.email = 'Email is required'
    } else if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(emailVal)) {
      errors.email = 'Please enter a valid email address'
    }

    // First Name Validation: required, alphabets only
    const firstNameVal = toOptionalString(formData.firstName).trim()
    if (!firstNameVal) {
      errors.firstName = 'First name is required'
    } else if (!/^[a-zA-Z\s]+$/.test(firstNameVal)) {
      errors.firstName = 'First name must contain only alphabets'
    }

    // Last Name Validation: required, alphabets only
    const lastNameVal = toOptionalString(formData.lastName).trim()
    if (!lastNameVal) {
      errors.lastName = 'Last name is required'
    } else if (!/^[a-zA-Z\s]+$/.test(lastNameVal)) {
      errors.lastName = 'Last name must contain only alphabets'
    }

    if (!toOptionalString(formData.address).trim()) {
      errors.address = 'Street address is required'
    } else if (toOptionalString(formData.address).trim().length < 3) {
      errors.address = 'Street address must be at least 3 characters'
    }

    if (toOptionalString(formData.apartment).trim() && toOptionalString(formData.apartment).trim().length < 3) {
      errors.apartment = 'Apartment must be at least 3 characters'
    }

    if (!formData.country) {
      errors.country = 'Country is required'
    }

    if (!formData.state) {
      errors.state = 'State is required'
    }

    if (useSavedAddress && (!selectedAddressId || !addresses?.find(a => a.id === selectedAddressId))) {
      errors.general = 'Please select a valid saved address for delivery, or enter a new address.'
    }

    if (!formData.city) {
      errors.city = 'City is required'
    }


    if (formData.city === 'Other' && !toOptionalString(formData.district).trim()) {
      errors.district = 'City/District name is required'
    }

    // Postal Code Validation: required, 6 digits standard for India
    const postalVal = toOptionalString(formData.postalCode).trim()
    if (!postalVal) {
      errors.postalCode = 'ZIP code is required'
    } else if (!/^[1-9][0-9]{5}$/.test(postalVal)) {
      errors.postalCode = 'ZIP code must be exactly 6 digits'
    }

    // Phone Validation: required, 10 digits starting with 6-9
    const phoneVal = toOptionalString(formData.phone).trim()
    if (!phoneVal) {
      errors.phone = 'Mobile number is required'
    } else if (!/^[6-9][0-9]{9}$/.test(phoneVal)) {
      errors.phone = 'Mobile number must be 10 digits starting with 6-9'
    }


    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  useEffect(() => {
    // Skip the very first run (initial mount) to avoid wiping coupon restored from draft
    if (!couponResetSkipRef.current) {
      couponResetSkipRef.current = true
      return
    }
    // User changed shipping or cart after load — reset and re-validate
    setIsDiscountApplied(false)
    setCouponState(null)
    setCouponError('')
    setCouponHydrated(false) // allow rehydration effect to re-validate
  }, [shippingMethod, subtotal, cartItems])

  useEffect(() => {
    // Wait for shipping methods to load (so shippingCharge is correct) before auto-applying coupon
    if (couponHydrated) return
    if (!discountCode.trim() || !cartItems.length) {
      setCouponHydrated(true)
      return
    }
    // Don't attempt rehydration until shippingMethods have loaded
    if (shippingMethods.length === 0) return

    let isMounted = true
    const rehydrateCoupon = async () => {
      try {
        const result = await validateCouponCode({
          code: discountCode.trim(),
          subtotal,
          shippingAmount: shippingCharge,
          categorySlugs: [...new Set(cartItems.map((item) => item.category).filter(Boolean))],
        })
        if (!isMounted) return
        setCouponState(result)
        setIsDiscountApplied(true)
      } catch (error) {
        if (!isMounted) return
        setCouponState(null)
        setIsDiscountApplied(false)
        const msg = error.message && error.message !== 'Request failed'
          ? error.message
          : 'Invalid or unrecognized coupon code. Please check and try again.'
        setCouponError(msg)
      } finally {
        if (isMounted) setCouponHydrated(true)
      }
    }

    rehydrateCoupon()
    return () => {
      isMounted = false
    }
  }, [couponHydrated, discountCode, subtotal, shippingCharge, cartItems, shippingMethods])

  const applyDiscount = async () => {
    if (!discountCode.trim()) return
    setCouponError('')
    setIsApplyingCoupon(true)
    try {
      const result = await validateCouponCode({
        code: discountCode.trim(),
        subtotal,
        shippingAmount: shippingCharge,
        categorySlugs: [...new Set(cartItems.map((item) => item.category).filter(Boolean))],
      })
      setCouponState(result)
      setIsDiscountApplied(true)
    } catch (error) {
      setCouponState(null)
      setIsDiscountApplied(false)
      const msg = error.message && error.message !== 'Request failed'
        ? error.message
        : 'Invalid or unrecognized coupon code. Please check and try again.'
      setCouponError(msg)
    } finally {
      setIsApplyingCoupon(false)
    }
  }

  const checkoutData = {

    customer: {
      firstName: toOptionalString(formData.firstName).trim(),
      lastName: toOptionalString(formData.lastName).trim(),
      email: toOptionalString(formData.email).trim(),
      phone: '+91' + cleanPhoneForForm(formData.phone),
    },
    shippingAddress: {
      firstName: toOptionalString(formData.firstName).trim(),
      lastName: toOptionalString(formData.lastName).trim(),
      address: toOptionalString(formData.address).trim(),
      apartment: toOptionalString(formData.apartment).trim(),
      city: toOptionalString(formData.city).trim(),
      district: toOptionalString(formData.district).trim(),
      state: toOptionalString(formData.state).trim(),
      country: toOptionalString(formData.country).trim(),
      postalCode: toOptionalString(formData.postalCode).trim(),
      phone: '+91' + cleanPhoneForForm(formData.phone),
    },

    items: cartItems.map((item) => ({
      productId: isMongoObjectId(item._id) ? item._id : (isMongoObjectId(item.id) ? item.id : undefined),
      slug: toSlugString(item.slug || (!isMongoObjectId(item._id) && !isMongoObjectId(item.id) ? (item._id || item.id) : undefined)),
      quantity: Math.max(1, parseInt(item.qty || item.quantity || 1, 10)),
    })),
    shippingMethod,
    paymentMethod: paymentGateway, // 'payu' or 'phonepe'
    couponCode: couponState?.coupon?.code || '',
    notes: [checkoutNotes.orderMessage, checkoutNotes.giftWrap ? `Gift wrap requested.${checkoutNotes.giftMessage ? ` Gift message: ${checkoutNotes.giftMessage}` : ''}` : '']
      .filter(Boolean)
      .join(' | '),
  }

  const getPaymentMethodLabel = () => 'PayU'

  const startPayment = async () => {
    if (!validateForm()) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    setIsLaunchingPayment(true)
    setFormErrors({})
    
    if (!availableGateways.phonepeEnabled && !availableGateways.payuEnabled && !availableGateways.jiopayEnabled && !availableGateways.airpayEnabled) {
      setIsLaunchingPayment(false)
      setFormErrors({ general: 'Online payments are currently disabled. Please try again later.' })
      return
    }

    try {
      if (paymentGateway === 'payu') {
        const payuOrderData = await createPayuPaymentOrder(checkoutData)
        sessionStorage.setItem('TOYOVOINDIA_last_order', JSON.stringify({
          orderNumber: payuOrderData.orderNumber,
          email: checkoutData.customer.email,
        }))
        submitPayuForm(payuOrderData)
      } else if (paymentGateway === 'jiopay') {
        const jiopayOrderData = await createJiopayPaymentOrder(checkoutData)
        sessionStorage.setItem('TOYOVOINDIA_last_order', JSON.stringify({
          orderNumber: jiopayOrderData.orderNumber,
          email: checkoutData.customer.email,
        }))
        redirectToJiopay(jiopayOrderData)
      } else if (paymentGateway === 'airpay') {
        const airpayOrderData = await createAirpayPaymentOrder(checkoutData)
        sessionStorage.setItem('TOYOVOINDIA_last_order', JSON.stringify({
          orderNumber: airpayOrderData.orderNumber,
          txnid: airpayOrderData.orderid || airpayOrderData.txnid,
          email: checkoutData.customer.email,
          token: airpayOrderData.orderToken || '',
        }))
        sessionStorage.setItem('pendingOrder', JSON.stringify({
          orderNumber: airpayOrderData.orderNumber,
          txnid: airpayOrderData.orderid || airpayOrderData.txnid,
          email: checkoutData.customer.email,
          token: airpayOrderData.orderToken || '',
        }))
        submitAirpayForm(airpayOrderData)
      } else {
        const phonepeOrderData = await createPhonepePaymentOrder(checkoutData)
        sessionStorage.setItem('TOYOVOINDIA_last_order', JSON.stringify({
          orderNumber: phonepeOrderData.orderNumber,
          email: checkoutData.customer.email,
        }))
        // Redirect directly to PhonePe secure page
        window.location.href = phonepeOrderData.redirectUrl
      }
    } catch (error) {
      setIsLaunchingPayment(false)
      setIsProcessing(false)
      const validationMessage = error.details?.map((issue) => `${issue.path}: ${issue.message}`).join(', ')
      setFormErrors({ general: validationMessage || error.message || 'Unable to start payment' })
    }
  }

  if (authLoading || !user) {
    return null
  }

  if (cartItems.length === 0) {
    return (
      <div className="min-h-screen bg-[#FDF4E6] flex flex-col items-center justify-center p-4 font-roboto">
        <ShoppingCart size={64} className="text-[#E84949] mb-6 opacity-20" />
        <h2 className="text-3xl font-bold text-[#333] font-grandstander mb-4">Your cart is empty</h2>
        <Link to="/" className="px-10 py-4 bg-[#E84949] text-white font-bold rounded-full tracking-widest uppercase hover:bg-[#333] transition-all shadow-lg">Start Shopping</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white font-roboto flex flex-col lg:flex-row">
      {/* Loading Overlay */}
      {isProcessing && (
        <div className="fixed inset-0 z-[2000] bg-white/90 backdrop-blur-md flex flex-col items-center justify-center text-center p-10">
           <div className="relative mb-10">
              <div className="w-24 h-24 border-8 border-gray-100 border-t-[#E84949] rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center"><ShoppingBag className="text-[#E84949] animate-bounce" size={32}/></div>
           </div>
           <h2 className="text-3xl font-grandstander font-bold text-[#333] mb-4">Confirming Order...</h2>
           <p className="text-gray-500 max-w-sm font-medium">Please do not refresh or close this window. We are finalizing your toy adventure!</p>
        </div>
      )}

      {isLaunchingPayment && (
        <div className="fixed inset-0 z-[1900] bg-white/70 backdrop-blur-sm flex flex-col items-center justify-center text-center p-10">
           <div className="relative mb-8">
              <div className="w-20 h-20 border-8 border-gray-100 border-t-[#6651A4] rounded-full animate-spin" />
           </div>
           <h2 className="text-2xl font-grandstander font-bold text-[#333] mb-3">Opening Secure Payment...</h2>
           <p className="text-gray-500 max-w-sm font-medium">We are connecting with {paymentGateway === 'phonepe' ? 'PhonePe' : paymentGateway === 'jiopay' ? 'JioPay' : paymentGateway === 'airpay' ? 'Airpay' : 'PayU'} securely. Please wait a moment.</p>
        </div>
      )}
      
      {/* Mobile/Tablet Header */}
      <div className="lg:hidden w-full bg-white border-b border-gray-100 sticky top-0 z-[100] px-4 py-4 flex items-center justify-between">
         <Link to="/" className="text-2xl font-grandstander font-bold text-[#333] tracking-tighter">TOYOVOINDIA</Link>
         <Link to="/cart" className="w-10 h-10 bg-[#FDF4E6] rounded-xl flex items-center justify-center text-[#E84949]">
            <ShoppingCart size={20} />
         </Link>
      </div>

      {/* Left Side: Delivery/Payment Forms */}
      <div className="w-full lg:w-[60%] px-4 md:px-10 lg:px-20 py-10 lg:py-16">
        <header className="hidden lg:block mb-12">
           <Link to="/" className="text-4xl font-grandstander font-bold text-[#333] tracking-tighter">TOYOVOINDIA</Link>
        </header>

        <nav className="flex items-center gap-2 text-[10px] md:text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-8">
           <Link to="/cart" className="text-[#E84949]">Cart</Link>
           <ChevronRight size={14} className="text-gray-300" />
           <span className="text-[#333]">Information</span>
           <ChevronRight size={14} className="text-gray-300" />
           <span className="text-[#333]">Payment</span>
        </nav>

         <motion.div initial={{opacity:0}} animate={{opacity:1}} className="space-y-10">
            <section className="space-y-6">
               <div className="flex justify-between items-center">
                 <h2 className="text-xl font-bold text-[#333] font-grandstander">Contact Information</h2>
                 {!user ? (
                   <Link to="/login" className="text-[13px] text-[#E84949] underline font-bold">Log in</Link>
                 ) : (
                   <p className="text-[13px] text-green-600 font-bold">Logged in as {user.firstName}</p>
                 )}
               </div>
               <FloatingInput label="Email Address" name="email" value={formData.email} onChange={handleInputChange} error={formErrors.email} />
               <div className="grid grid-cols-2 gap-4">
                  <FloatingInput label="First name" name="firstName" value={formData.firstName} onChange={handleInputChange} error={formErrors.firstName} />
                  <FloatingInput label="Last name" name="lastName" value={formData.lastName} onChange={handleInputChange} error={formErrors.lastName} />
               </div>
               <FloatingInput label="Phone number" name="phone" value={formData.phone} onChange={handleInputChange} error={formErrors.phone} prefix="+91" />
            </section>

            <section className="space-y-6">
               <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold text-[#333] font-grandstander">Delivery Address</h2>
                  {addresses?.length > 0 && (
                     <button onClick={() => setUseSavedAddress(!useSavedAddress)} className="text-[11px] font-bold text-[#005BD1] uppercase underline">
                        {useSavedAddress ? 'Enter New Address' : 'Use Saved Address'}
                     </button>
                  )}
               </div>

               {useSavedAddress && addresses?.length > 0 ? (
                  <div className="space-y-4">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {addresses.map(addr => (
                           <div 
                              key={addr.id} 
                              onClick={() => {
                                 setSelectedAddressId(addr.id);
                                 setFormData(prev => ({
                                    ...prev,
                                    firstName: addr.firstName,
                                    lastName: addr.lastName,
                                    address: addr.address,
                                    apartment: addr.apartment,
                                    city: addr.city,
                                    state: addr.state,
                                    postalCode: addr.postalCode,
                                    phone: cleanPhoneForForm(addr.phone),
                                    district: addr.district
                                 }));
                              }}
                              className={`p-5 rounded-2xl border-2 transition-all cursor-pointer relative ${selectedAddressId === addr.id ? 'border-[#005BD1] bg-[#F4F4F4]' : 'border-gray-100 bg-[#F4F4F4] hover:border-gray-200'}`}
                           >
                              <div className="flex justify-between items-start mb-2">
                                 <span className="text-[10px] font-bold uppercase tracking-widest text-[#005BD1] bg-blue-50 px-2 py-0.5 rounded">{addr.type}</span>
                                 {selectedAddressId === addr.id && <Check size={16} className="text-[#005BD1]"/>}
                              </div>
                              <p className="text-[13px] font-bold text-[#333] font-grandstander">{addr.firstName} {addr.lastName}</p>
                              <p className="text-[11px] font-bold text-gray-400 mt-1">Phone: {addr.phone}</p>
                              <div className="text-[12px] text-gray-500 mt-2 space-y-0.5">
                                 <p>{addr.country || 'India'}</p>
                                 <p>{addr.state}</p>
                                 <p>{addr.city === 'Other' ? addr.district : addr.city}{addr.district && addr.city !== 'Other' ? ` (${addr.district})` : ''}</p>
                                 <p>{addr.address}</p>
                                 {addr.apartment && <p>{addr.apartment}</p>}
                                 <p>{addr.postalCode}</p>
                              </div>
                           </div>
                        ))}
                     </div>
                  </div>
               ) : (
                  <div className="space-y-4">
                     <FloatingSelect label="Country/Region" name="country" value={formData.country} onChange={handleInputChange} options={countries} error={formErrors.country} />
                     <div className="grid grid-cols-2 gap-4">
                        <FloatingSelect label="State / Province" name="state" value={formData.state} onChange={handleInputChange} options={["", ...indianStates]} error={formErrors.state} />
                        <FloatingSelect label="City" name="city" value={formData.city} onChange={handleInputChange} options={["", ...(commonCities[formData.state] || []), "Other"]} error={formErrors.city} />
                     </div>
                     {formData.city === 'Other' && (
                        <FloatingInput label="Area / District" name="district" value={formData.district} onChange={handleInputChange} error={formErrors.district} />
                     )}
                     <FloatingInput label="Street Address / Address Line 1" name="address" value={formData.address} onChange={handleInputChange} error={formErrors.address} />
                     <FloatingInput label="Apartment, suite, unit, etc. (optional)" name="apartment" value={formData.apartment} onChange={handleInputChange} error={formErrors.apartment} />
                     <FloatingInput label="Postal Code / ZIP Code" name="postalCode" value={formData.postalCode} onChange={handleInputChange} error={formErrors.postalCode} />
                  </div>
               )}
            </section>

            <section className="space-y-6">
               <h2 className="text-xl font-bold text-[#333] font-grandstander">Shipping method</h2>
               <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                  {shippingMethods.map((method) => (
                    <label key={method.id} className={`p-4 flex items-center justify-between cursor-pointer transition-all ${shippingMethod === method.code ? 'bg-[#F4F4F4]' : 'bg-white'}`}>
                      <div className="flex items-center gap-4">
                        <input type="radio" checked={shippingMethod === method.code} onChange={() => setShippingMethod(method.code)} className="w-4 h-4 accent-[#005BD1]" />
                        <span className="text-[14px] font-medium text-[#333]">{method.name} ({method.minDays}-{method.maxDays} days)</span>
                      </div>
                      <span className="font-bold text-[14px]">₹{Number(method.charge || 0).toFixed(2)}</span>
                    </label>
                  ))}
               </div>
            </section>

            <section className="space-y-6">
               <div className="flex justify-between items-end">
                 <h2 className="text-xl font-bold text-[#333] font-grandstander">Payment Method</h2>
                 <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest flex items-center gap-1">
                   <Check size={12} className="text-green-500"/> Secured End-to-End
                 </p>
               </div>
               <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                  {availableGateways.phonepeEnabled && (
                    <label className={`p-4 flex items-center justify-between cursor-pointer transition-all ${paymentGateway === 'phonepe' ? 'bg-[#F4F4F4]' : 'bg-white'}`}>
                      <div className="flex items-center gap-4">
                        <input type="radio" checked={paymentGateway === 'phonepe'} onChange={() => setPaymentGateway('phonepe')} className="w-4 h-4 accent-[#005BD1]" />
                        <div className="flex flex-col">
                          <span className="text-[14px] font-bold text-[#333]">PhonePe (Fastest)</span>
                          <span className="text-[11px] font-medium text-gray-500">UPI, Credit/Debit Cards, Wallets</span>
                        </div>
                      </div>
                    </label>
                  )}
                  {availableGateways.payuEnabled && (
                    <label className={`p-4 flex items-center justify-between cursor-pointer transition-all ${paymentGateway === 'payu' ? 'bg-[#F4F4F4]' : 'bg-white'}`}>
                      <div className="flex items-center gap-4">
                        <input type="radio" checked={paymentGateway === 'payu'} onChange={() => setPaymentGateway('payu')} className="w-4 h-4 accent-[#005BD1]" />
                        <div className="flex flex-col">
                          <span className="text-[14px] font-bold text-[#333]">PayU Gateway</span>
                          <span className="text-[11px] font-medium text-gray-500">Alternative Gateway for Cards & Netbanking</span>
                        </div>
                      </div>
                    </label>
                  )}
                  {availableGateways.jiopayEnabled && (
                    <label className={`p-4 flex items-center justify-between cursor-pointer transition-all ${paymentGateway === 'jiopay' ? 'bg-[#F4F4F4]' : 'bg-white'}`}>
                      <div className="flex items-center gap-4">
                        <input type="radio" checked={paymentGateway === 'jiopay'} onChange={() => setPaymentGateway('jiopay')} className="w-4 h-4 accent-[#005BD1]" />
                        <div className="flex flex-col">
                          <span className="text-[14px] font-bold text-[#333]">JioPay</span>
                          <span className="text-[11px] font-medium text-gray-500">UPI, Cards, Netbanking & Wallets</span>
                        </div>
                      </div>
                    </label>
                  )}
                  {availableGateways.airpayEnabled && (
                    <label className={`p-4 flex items-center justify-between cursor-pointer transition-all ${paymentGateway === 'airpay' ? 'bg-[#F4F4F4]' : 'bg-white'}`}>
                      <div className="flex items-center gap-4">
                        <input type="radio" checked={paymentGateway === 'airpay'} onChange={() => setPaymentGateway('airpay')} className="w-4 h-4 accent-[#005BD1]" />
                        <div className="flex flex-col">
                          <span className="text-[14px] font-bold text-[#333]">Airpay </span>
                          <span className="text-[11px] font-medium text-gray-500">UPI, Cards, Netbanking & Wallets</span>
                        </div>
                      </div>
                    </label>
                  )}
                  {!availableGateways.phonepeEnabled && !availableGateways.payuEnabled && !availableGateways.jiopayEnabled && !availableGateways.airpayEnabled && (
                    <div className="p-4 text-center">
                      <p className="text-[13px] font-bold text-red-500">Online payments are currently paused for maintenance. Please try again later.</p>
                    </div>
                  )}
               </div>
            </section>

             {/* Mobile/Tablet Reimagined Summary (Screenshot 1 & 2) */}
             <div className="lg:hidden space-y-6">
                <button 
                  onClick={() => setShowSummary(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-xl text-[12px] font-bold text-[#333] hover:bg-gray-50 transition-all shadow-sm"
                >
                   <Tag size={14} className="text-gray-400" /> Add discount
                </button>

                <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                   <AnimatePresence mode="wait">
                      {!showSummary ? (
                         <motion.button
                            key="collapsed"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={() => setShowSummary(true)}
                            className="w-full flex items-center justify-between p-4 bg-white hover:bg-gray-50 transition-all"
                         >
                            <div className="flex items-center gap-4">
                               <div className="w-12 h-12 rounded-lg border border-gray-100 bg-white shadow-sm overflow-hidden p-1">
                                  <img src={cartItems[0]?.thumbnail?.url || cartItems[0]?.images?.[0]?.url || cartItems[0]?.img} className="w-full h-full object-contain" />
                               </div>
                               <div className="text-left">
                                  <span className="block text-[14px] font-bold text-[#333]">Total</span>
                                  <span className="block text-[11px] text-gray-400 font-medium">{cartItems.reduce((acc, i) => acc + i.qty, 0)} items</span>
                               </div>
                            </div>
                            <div className="flex items-center gap-2">
                               <div className="flex items-baseline gap-1">
                                  <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">INR</span>
                                  <span className="text-[16px] font-bold text-[#333]">₹{total.toFixed(2)}</span>
                               </div>
                               <ChevronDown size={16} className="text-gray-400" />
                            </div>
                         </motion.button>
                      ) : (
                         <motion.div
                            key="expanded"
                            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                            className="bg-[#F9F9F9]"
                         >
                            <button 
                               onClick={() => setShowSummary(false)}
                               className="w-full flex items-center justify-between p-5 border-b border-gray-100 bg-white"
                            >
                               <span className="text-[15px] font-bold text-[#005BD1]">Order summary</span>
                               <ChevronUp size={18} className="text-[#005BD1]" />
                            </button>
                            
                            <div className="p-6 space-y-6">
                               <div className="space-y-5 max-h-[40vh] overflow-y-auto px-2 pt-2 custom-scrollbar">
                                  {cartItems.map(item => (
                                     <div key={item.id} className="flex items-center gap-4 pt-1 pr-1">
                                        <div className="w-16 h-16 rounded-2xl border border-gray-200 relative bg-white shadow-sm shrink-0">
                                           <img src={item.thumbnail?.url || item.images?.[0]?.url || item.img} className="w-full h-full object-cover rounded-2xl" />
                                           <span className="absolute -top-2 -right-2 w-6 h-6 bg-[#333] text-white text-[10px] rounded-full flex items-center justify-center font-bold border-2 border-white shadow-sm z-10">{item.qty}</span>
                                        </div>
                                        <div className="grow min-w-0">
                                           <h4 className="text-[13px] font-bold text-[#333] truncate leading-tight">{item.title}</h4>
                                           <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">SKU: {item.sku || 'TOY-001'}</p>
                                        </div>
                                        <span className="text-[15px] font-bold text-[#333] shrink-0">₹{(item.price * item.qty).toFixed(2)}</span>
                                     </div>
                                  ))}
                               </div>

                               <CouponSection 
                                  discountCode={discountCode}
                                  setDiscountCode={setDiscountCode}
                                  applyDiscount={applyDiscount}
                                  isApplyingCoupon={isApplyingCoupon}
                                  couponError={couponError}
                                  isDiscountApplied={isDiscountApplied}
                                  couponState={couponState}
                                  compact
                                  activeCoupons={activeCoupons}
                               />

                               <div className="pt-6 border-t border-gray-200 space-y-3 text-[14px]">
                                  <div className="flex justify-between items-center"><span className="text-gray-500 font-medium">Subtotal</span><span className="font-bold text-[#333]">₹{subtotal.toFixed(2)}</span></div>
                                  <div className="flex justify-between items-center"><span className="text-gray-500 font-medium">Shipping</span><span className="font-bold text-[#333]">₹{shippingCharge.toFixed(2)}</span></div>
                                  {isDiscountApplied && <div className="flex justify-between items-center text-green-600 font-bold"><span>Discount</span><span>-₹{discountAmount.toFixed(2)}</span></div>}
                                  <div className="flex justify-between items-center pt-5 mt-2 border-t border-gray-200">
                                     <span className="text-[18px] font-bold text-[#333]">Total</span>
                                     <div className="flex items-baseline gap-1.5">
                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">INR</span>
                                        <span className="text-[26px] font-bold text-[#333]">₹{total.toFixed(2)}</span>
                                     </div>
                                  </div>
                               </div>
                            </div>
                         </motion.div>
                      )}
                   </AnimatePresence>
                </div>
             </div>

             <div className="flex flex-col gap-4">
                {formErrors.general && (
                  <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-[13px] font-bold">
                    <AlertCircle size={18} />
                    {formErrors.general}
                  </div>
                )}
                <button 
                  onClick={startPayment} 
                  disabled={isProcessing || isLaunchingPayment || (!availableGateways.phonepeEnabled && !availableGateways.payuEnabled)} 
                  className="w-full h-16 bg-[#005BD1] px-4 text-white font-bold rounded-xl tracking-widest uppercase hover:bg-[#00459E] transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:bg-gray-400 disabled:shadow-none shadow-xl text-center"
                >
                   {isProcessing || isLaunchingPayment ? 'Processing...' : (!availableGateways.phonepeEnabled && !availableGateways.payuEnabled ? 'Payments Disabled' : `Pay Now - ₹${total.toFixed(2)}`)}
                </button>
             </div>
          </motion.div>
      </div>

      {/* Right Side: Order Summary */}
      <div className="hidden lg:block w-full lg:w-[40%] bg-[#F5F5F5] border-l border-gray-200 min-h-screen px-4 md:px-10 py-16 sticky top-0">
        <div className="max-w-[420px]">
          <div className="space-y-6 max-h-[50vh] overflow-y-auto px-2 py-4 custom-scrollbar">
            {cartItems.map(item => (
              <div key={item.id} className="flex items-center gap-4 group pt-2 pr-2">
                <div className="w-16 h-16 rounded-xl border border-gray-200 relative bg-white shadow-sm group-hover:shadow-md transition-all">
                  <img src={item.thumbnail?.url || item.images?.[0]?.url || item.img} className="w-full h-full object-cover rounded-xl" />
                  <span className="absolute -top-2 -right-2 w-6 h-6 bg-[#333] text-white text-[10px] rounded-full flex items-center justify-center font-bold border-2 border-white shadow-sm z-10">{item.qty}</span>
                </div>
                <div className="grow"><h4 className="text-[13px] font-bold text-[#333] font-grandstander">{item.title}</h4><p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">SKU: {item.sku || 'TOY-001'}</p></div>
                <span className="text-[15px] font-bold text-[#333] tracking-tighter">₹{(item.price * item.qty).toFixed(2)}</span>
              </div>
            ))}
          </div>

          <CouponSection 
            discountCode={discountCode}
            setDiscountCode={setDiscountCode}
            applyDiscount={applyDiscount}
            isApplyingCoupon={isApplyingCoupon}
            couponError={couponError}
            isDiscountApplied={isDiscountApplied}
            couponState={couponState}
            activeCoupons={activeCoupons}
          />

          <div className="mt-10 pt-10 border-t border-gray-200 space-y-4 text-[14px]">
             <div className="flex justify-between"><span className="text-gray-500 font-medium">Subtotal</span><span className="font-bold tracking-tighter text-[#333]">₹{subtotal.toFixed(2)}</span></div>
             <div className="flex justify-between"><span className="text-gray-500 font-medium">Shipping</span><span className="font-bold tracking-tighter text-[#333]">₹{shippingCharge.toFixed(2)}</span></div>
             {isDiscountApplied && <div className="flex justify-between text-green-600 font-bold"><span>Discount ({couponState?.coupon?.code})</span><span className="tracking-tighter">-₹{discountAmount.toFixed(2)}</span></div>}
             <div className="flex justify-between items-center pt-6 mt-6 border-t border-gray-200">
               <span className="text-[20px] font-bold font-grandstander text-[#333]">Total</span>
               <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-bold text-gray-400 uppercase tracking-widest">INR</span>
                  <span className="text-4xl font-bold font-grandstander text-[#333] tracking-tighter">₹{total.toFixed(2)}</span>
               </div>
             </div>
          </div>
          
        </div>
      </div>
    </div>
  )
}
