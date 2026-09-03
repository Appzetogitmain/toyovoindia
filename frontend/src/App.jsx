import { BrowserRouter as Router, Routes, Route, useLocation, Navigate, Link, useNavigationType } from 'react-router-dom'
import React, { useEffect, useLayoutEffect, Suspense } from 'react'
import { VisionHeader } from './components/layout/VisionHeader'
import { Footer }       from './components/layout/Footer'
import { HomePage }     from './pages/HomePage'
import { AboutPage }    from './pages/AboutPage'
import { ContactPage }  from './pages/ContactPage'
import { ProductDetailPage } from './pages/ProductDetailPage'
import { ReturnPolicy } from './pages/ReturnPolicy'
import { ShippingPolicy } from './pages/ShippingPolicy'
import { TermsConditions } from './pages/TermsConditions'
import { PrivacyPolicy } from './pages/PrivacyPolicy'
import { FAQPage } from './pages/FAQPage'
import { CancellationPolicy } from './pages/CancellationPolicy'
import { WishlistPage } from './pages/WishlistPage'
import { SearchPage } from './pages/SearchPage'
import { CollectionPage } from './pages/CollectionPage'
import { LoginPage } from './pages/LoginPage'
import { AdminLoginPage } from './pages/AdminLoginPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { RegisterPage } from './pages/RegisterPage'
import { AccountPage } from './pages/AccountPage'
import { CartPage } from './pages/CartPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { PhonepeCallbackPage } from './pages/PhonepeCallbackPage'
import { JiopayCallbackPage } from './pages/JiopayCallbackPage'
import { OrderSuccessPage } from './pages/OrderSuccessPage'
import { ComparePage } from './pages/ComparePage'
import { AllCategoriesPage } from './pages/AllCategoriesPage'
import { AuthProvider } from './context/AuthContext'
import { MobileBottomBar } from './components/layout/MobileBottomBar'
import { AsideSidebar } from './components/layout/AsideSidebar'
import { useAuth } from './context/AuthContext'
import { FirebaseTokenManager } from './components/FirebaseTokenManager'
import { getStorefrontSettings } from './services/siteApi'

// Advanced Scroll Restoration Manager for React Router
function ScrollManager() {
  const location = useLocation()
  const navigationType = useNavigationType()

  // 1. Record scroll position as the user scrolls
  useEffect(() => {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual'
    }

    let timeoutId = null
    const handleScroll = () => {
      if (timeoutId) return
      timeoutId = setTimeout(() => {
        if (document.body.style.position !== 'fixed') {
          sessionStorage.setItem(`scroll-pos-${location.key}`, window.scrollY)
        }
        timeoutId = null
      }, 150)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [location.key])

  // 2. Apply scroll position on route change
  useLayoutEffect(() => {
    if (navigationType === 'POP') {
      const savedPos = sessionStorage.getItem(`scroll-pos-${location.key}`)
      if (savedPos !== null) {
        const pos = parseInt(savedPos, 10)
        
        let frameId;
        const start = Date.now();
        
        // Aggressively hold the scroll position during the first 500ms
        // while cached data populates the DOM to prevent any visual jump.
        const forceScroll = () => {
           if (window.scrollY !== pos) {
              window.scrollTo({ top: pos, left: 0, behavior: 'instant' });
           }
           if (Date.now() - start < 500) {
              frameId = requestAnimationFrame(forceScroll);
           }
        };
        forceScroll();

        return () => cancelAnimationFrame(frameId);
      }
    } else {
      // PUSH or REPLACE: New navigation, always scroll to top instantly
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    }
  }, [location.pathname, location.key, navigationType])

  return null
}

import { CartProvider } from './context/CartContext'
import { PaymentProvider } from './context/PaymentContext'
import { ToastProvider } from './context/ToastContext'

// Lazy load admin module
const AdminLayout = React.lazy(() => import('./admin/AdminLayout').then(m => ({ default: m.AdminLayout })))
const AdminDashboard = React.lazy(() => import('./admin/pages/AdminDashboard').then(m => ({ default: m.AdminDashboard })))
const AdminUsers = React.lazy(() => import('./admin/pages/AdminUsers').then(m => ({ default: m.AdminUsers })))
const AdminUserDetail = React.lazy(() => import('./admin/pages/AdminUserDetail').then(m => ({ default: m.AdminUserDetail })))
const AdminProducts = React.lazy(() => import('./admin/pages/AdminProducts').then(m => ({ default: m.AdminProducts })))
const AdminProductDetail = React.lazy(() => import('./admin/pages/AdminProductDetail').then(m => ({ default: m.AdminProductDetail })))
const AdminCategories = React.lazy(() => import('./admin/pages/AdminCategories').then(m => ({ default: m.AdminCategories })))
const AdminCoupons = React.lazy(() => import('./admin/pages/AdminCoupons').then(m => ({ default: m.AdminCoupons })))
const AdminContent = React.lazy(() => import('./admin/pages/AdminContent').then(m => ({ default: m.AdminContent })))
const AdminOrders = React.lazy(() => import('./admin/pages/AdminOrders').then(m => ({ default: m.AdminOrders })))
const AdminOrderDetail = React.lazy(() => import('./admin/pages/AdminOrderDetail').then(m => ({ default: m.AdminOrderDetail })))
const AdminTransactions = React.lazy(() => import('./admin/pages/AdminTransactions').then(m => ({ default: m.AdminTransactions })))
const AdminFinance = React.lazy(() => import('./admin/pages/AdminFinance').then(m => ({ default: m.AdminFinance })))
const AdminSettings = React.lazy(() => import('./admin/pages/AdminSettings').then(m => ({ default: m.AdminSettings })))
const AdminNotifications = React.lazy(() => import('./admin/pages/AdminNotifications').then(m => ({ default: m.AdminNotifications })))
const AdminPublicActivity = React.lazy(() => import('./admin/pages/AdminPublicActivity').then(m => ({ default: m.AdminPublicActivity })))
const AdminMessages = React.lazy(() => import('./admin/pages/AdminMessages').then(m => ({ default: m.AdminMessages })))
const AdminShipping = React.lazy(() => import('./admin/pages/AdminShipping').then(m => ({ default: m.AdminShipping })))
const AdminTransactionDetail = React.lazy(() => import('./admin/pages/AdminTransactionDetail').then(m => ({ default: m.AdminTransactionDetail })))
const AdminReports = React.lazy(() => import('./admin/pages/AdminReports').then(m => ({ default: m.AdminReports })))
const AdminSystemLogs = React.lazy(() => import('./admin/pages/AdminSystemLogs').then(m => ({ default: m.AdminSystemLogs })))
const AdminPages = React.lazy(() => import('./admin/pages/AdminPages').then(m => ({ default: m.AdminPages })))
const AdminReviews = React.lazy(() => import('./admin/pages/AdminReviews').then(m => ({ default: m.AdminReviews })))
const AdminSubscribers = React.lazy(() => import('./admin/pages/AdminSubscribers').then(m => ({ default: m.AdminSubscribers })))
const NotFoundPage = React.lazy(() => import('./pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })))

const AdminFallback = () => (
  <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#FDF4E6]">
    <div className="w-12 h-12 border-4 border-white border-t-[#6651A4] rounded-full animate-spin shadow-md mb-4"></div>
    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest animate-pulse">Loading Workspace...</p>
  </div>
)

const AdminAccessDenied = () => (
  <div className="min-h-screen bg-[#FDF4E6] flex items-center justify-center px-6">
    <div className="max-w-lg w-full bg-white rounded-[32px] p-10 shadow-sm border border-black/[0.03] text-center">
      <h1 className="text-3xl font-grandstander font-bold text-gray-800">Admin access required</h1>
      <p className="mt-3 text-sm font-medium text-gray-500">This workspace is reserved for admin and super admin accounts.</p>
      <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
        <Link to="/" className="h-12 px-6 rounded-xl bg-[#333] text-white text-[11px] font-bold uppercase tracking-widest flex items-center justify-center">
          Back to Store
        </Link>
        <Link to="/account" className="h-12 px-6 rounded-xl bg-[#6651A4] text-white text-[11px] font-bold uppercase tracking-widest flex items-center justify-center">
          Go to Account
        </Link>
      </div>
    </div>
  </div>
)

function AdminRouteGate({ children }) {
  const location = useLocation()
  const { user, authLoading, isAdmin } = useAuth()

  if (authLoading) {
    return <AdminFallback />
  }

  if (!user) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/admin/login?next=${encodeURIComponent(next)}`} replace />
  }

  if (!isAdmin) {
    return <AdminAccessDenied />
  }

  return children
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <PaymentProvider>
            <Router>
              <AppContent />
            </Router>
          </PaymentProvider>
        </CartProvider>
      </AuthProvider>
    </ToastProvider>
  )
}

function AppContent() {
  const location = useLocation()
  const isCheckout = location.pathname === '/checkout'
  const isAdmin = location.pathname.startsWith('/admin') && location.pathname !== '/admin/login'
  const isAuthPage = ['/login', '/register', '/forgot-password', '/admin/login'].includes(location.pathname)
  const hideLayouts = isCheckout || location.pathname.startsWith('/admin') || isAuthPage

  const { user } = useAuth()
  const isSiteAdmin = ['admin', 'super_admin'].includes(user?.role)
  const [maintenanceMode, setMaintenanceMode] = React.useState(false)

  React.useEffect(() => {
    getStorefrontSettings()
      .then((data) => {
        setMaintenanceMode(Boolean(data.maintenanceMode))
      })
      .catch(console.error)
  }, [location.pathname]) // re-check occasionally on navigation

  // If we are entirely inside admin, we don't need the flex-col bg-[#FDF4E6] wrapper of the user site,
  // but it's okay because AdminLayout fills the screen anyway. Let's just conditionally render components.

  if (maintenanceMode && !isSiteAdmin && !isAdmin && !isAuthPage) {
    return (
      <div className="min-h-screen bg-[#FDF4E6] flex flex-col items-center justify-center p-6 text-center overflow-hidden relative">
        {/* Floating background toys */}
        <div className="absolute inset-0 pointer-events-none opacity-20 select-none overflow-hidden">
          <div className="absolute top-[10%] left-[10%] text-5xl animate-bounce" style={{ animationDelay: '0.2s', animationDuration: '4s' }}>🧸</div>
          <div className="absolute top-[20%] right-[15%] text-5xl animate-pulse" style={{ animationDelay: '0.5s', animationDuration: '3s' }}>🚀</div>
          <div className="absolute bottom-[20%] left-[15%] text-5xl animate-bounce" style={{ animationDelay: '0.8s', animationDuration: '5s' }}>🚂</div>
          <div className="absolute bottom-[15%] right-[10%] text-5xl animate-pulse" style={{ animationDelay: '1.2s', animationDuration: '4s' }}>🧩</div>
          <div className="absolute top-[50%] left-[5%] text-5xl animate-bounce" style={{ animationDelay: '1.5s', animationDuration: '6s' }}>🎈</div>
          <div className="absolute top-[45%] right-[5%] text-5xl animate-bounce" style={{ animationDelay: '1.8s', animationDuration: '3.5s' }}>🎨</div>
        </div>

        {/* Central Card with animation */}
        <div className="relative z-10 max-w-lg w-full bg-white/70 backdrop-blur-md border border-white/40 p-8 md:p-12 rounded-[40px] shadow-xl shadow-orange-500/5">
          <div className="w-28 h-28 bg-[#FAEAD3] rounded-[36px] flex items-center justify-center mx-auto mb-8 relative shadow-lg shadow-orange-900/5">
            <span className="text-6xl animate-bounce" style={{ animationDuration: '2s' }}>🧸</span>
            <span className="absolute -bottom-1 -right-1 text-3xl animate-pulse">🔧</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-grandstander font-bold text-gray-800 mb-4 tracking-tight">Store Under Maintenance</h1>
          <p className="text-gray-500 font-medium text-sm md:text-base leading-relaxed mb-6">
            We are polishing up the toy shelves and adding exciting new products to improve your shopping experience. We'll be right back with more joy!
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#F1641E]/10 rounded-full text-[#F1641E] text-xs font-bold uppercase tracking-wider">
            <span>Checking Back Shortly</span>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F1641E] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#F1641E]"></span>
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (isAdmin) {
    return (
      <>
        <ScrollManager />
        <FirebaseTokenManager />
        <Suspense fallback={<AdminFallback />}>
          <AdminRouteGate>
            <Routes>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="users/:id" element={<AdminUserDetail />} />
                <Route path="products" element={<AdminProducts />} />
                <Route path="products/:id" element={<AdminProductDetail />} />
                <Route path="categories" element={<AdminCategories />} />
                <Route path="coupons" element={<AdminCoupons />} />
                <Route path="content" element={<AdminContent />} />
                <Route path="orders" element={<AdminOrders />} />
                <Route path="orders/:id" element={<AdminOrderDetail />} />
                <Route path="finance" element={<AdminFinance />} />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="settings/:tab" element={<AdminSettings />} />
                <Route path="notifications" element={<AdminNotifications />} />
                <Route path="public-activity" element={<AdminPublicActivity />} />
                <Route path="messages" element={<AdminMessages />} />
                <Route path="shipping" element={<AdminShipping />} />
                <Route path="transactions" element={<AdminTransactions />} />
                <Route path="transactions/:id" element={<AdminTransactionDetail />} />
                <Route path="reports" element={<AdminReports />} />
                <Route path="system-logs" element={<AdminSystemLogs />} />
                <Route path="legal-pages" element={<AdminPages />} />
                <Route path="reviews" element={<AdminReviews />} />
                <Route path="subscribers" element={<AdminSubscribers />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </AdminRouteGate>
        </Suspense>
      </>
    )
  }

  return (
    <>
      <ScrollManager />
      <FirebaseTokenManager />
      <div className="min-h-screen flex flex-col bg-[#FDF4E6] relative" style={{ overflowX: 'clip' }}>
        {!hideLayouts && <VisionHeader />}
        <main className="flex-grow">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/product/:title" element={<ProductDetailPage />} />
            
            {/* Legal & Informational Pages */}
            <Route path="/pages/return-exchange" element={<ReturnPolicy />} />
            <Route path="/pages/shipping-policy" element={<ShippingPolicy />} />
            <Route path="/pages/terms-conditions" element={<TermsConditions />} />
            <Route path="/pages/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/pages/faq" element={<FAQPage />} />
            <Route path="/pages/cancellation-policy" element={<CancellationPolicy />} />
            
            {/* Utility Pages */}
            <Route path="/wishlist" element={<WishlistPage />} />
            <Route path="/search" element={<SearchPage />} />
            
            {/* Collection / Category Pages */}
            <Route path="/shop" element={<CollectionPage />} />
            <Route path="/collections/:category/:subcategory?" element={<CollectionPage />} />

            {/* Auth Pages */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/admin/login" element={<AdminLoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/account/:tab" element={<AccountPage />} />
            <Route path="/account/orders/:orderId" element={<AccountPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/payment/phonepe/callback" element={<PhonepeCallbackPage />} />
            <Route path="/payment/jiopay/callback" element={<JiopayCallbackPage />} />
            <Route path="/order-success" element={<OrderSuccessPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/all-categories" element={<AllCategoriesPage />} />

            {/* Fallback to 404 */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
        {!hideLayouts && <Footer />}
        {!hideLayouts && <MobileBottomBar />}
        {!hideLayouts && <AsideSidebar />}
      </div>
    </>
  )
}
