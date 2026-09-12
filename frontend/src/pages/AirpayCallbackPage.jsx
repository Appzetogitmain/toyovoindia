import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { checkAirpayPaymentStatus } from '../services/orderApi';
import { useCart } from '../context/CartContext';

export function AirpayCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { clearCart } = useCart();
  const [status, setStatus] = useState('verifying');
  const [errorMsg, setErrorMsg] = useState('');
  const [orderNumber, setOrderNumber] = useState('');

  const txnid = searchParams.get('txnid') || searchParams.get('orderNumber') || searchParams.get('TRANSACTIONID') || searchParams.get('orderid') || searchParams.get('CUSTOMVAR') || searchParams.get('customvar');
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    // If no transaction ID in URL, check sessionStorage for recently placed order
    let targetTxnId = txnid;
    if (!targetTxnId) {
      try {
        const stored = sessionStorage.getItem('pendingOrder');
        if (stored) {
          const parsed = JSON.parse(stored);
          targetTxnId = parsed.orderNumber;
        }
      } catch (e) {}
    }

    if (!targetTxnId) {
      navigate('/checkout?error=MissingTransactionId', { replace: true });
      return;
    }

    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    const verifyPayment = async () => {
      // Poll up to 4 times with progressive backoff
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          const response = await checkAirpayPaymentStatus(targetTxnId);
          const orderNum = response?.orderNumber || response?.data?.orderNumber || targetTxnId;
          const email = response?.email || response?.data?.email || '';
          const token = response?.token || response?.data?.token || '';
          if (orderNum) {
            setOrderNumber(orderNum);
          }

          const isSuccess = response?.status === 'success' || response?.paymentStatus === 'paid' || response?.data?.status === 'success' || response?.data?.paymentStatus === 'paid';
          if (isSuccess) {
            setStatus('success');
            clearCart();
            const emailParam = email ? `&email=${encodeURIComponent(email)}` : '';
            const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
            try {
              sessionStorage.removeItem('pendingOrder');
              sessionStorage.removeItem('TOYOVOINDIA_last_order');
            } catch (e) {}
            setTimeout(() => {
              navigate(`/order-success?orderNumber=${orderNum}${emailParam}${tokenParam}`, { replace: true });
            }, 1200);
            return;
          }

          if (attempt < 4) {
            await new Promise((res) => setTimeout(res, 2500));
          }
        } catch (error) {
          if (attempt === 4) {
            setStatus('pending');
            setErrorMsg('Payment verification is taking longer than usual.');
          } else {
            await new Promise((res) => setTimeout(res, 2000));
          }
        }
      }

      // If still pending after retries, allow user to check orders
      setStatus('pending');
      setErrorMsg('Payment confirmation is in progress. Your bank is confirming the transaction.');
    };

    verifyPayment();
  }, [txnid, navigate, clearCart]);

  return (
    <div className="min-h-screen bg-[#FDF4E6] flex flex-col items-center justify-center p-4 font-roboto">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white p-8 md:p-10 rounded-3xl shadow-xl flex flex-col items-center text-center max-w-md w-full"
      >
        {status === 'verifying' && (
          <>
            <div className="relative mb-6">
              <div className="w-20 h-20 border-8 border-gray-100 border-t-[#005BD1] rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <RefreshCw className="text-[#005BD1] animate-pulse" size={24} />
              </div>
            </div>
            <h2 className="text-2xl font-grandstander font-bold text-[#333] mb-2">Verifying Payment...</h2>
            <p className="text-gray-500 font-medium text-[14px]">
              Please do not close or refresh this page. We are securely syncing your transaction with Airpay.
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mb-6">
              <CheckCircle size={80} className="text-green-500" />
            </motion.div>
            <h2 className="text-2xl font-grandstander font-bold text-[#333] mb-2">Payment Confirmed!</h2>
            <p className="text-gray-500 font-medium text-[14px]">
              Your order has been placed successfully. Redirecting to your invoice receipt...
            </p>
          </>
        )}

        {status === 'pending' && (
          <>
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mb-6">
              <AlertCircle size={80} className="text-amber-500" />
            </motion.div>
            <h2 className="text-2xl font-grandstander font-bold text-[#333] mb-2">Payment In Progress</h2>
            <p className="text-gray-600 font-medium text-[14px] mb-6">
              {errorMsg} If amount was deducted from your account, your order will automatically be confirmed.
            </p>
            <div className="flex gap-3 w-full">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 py-3 bg-[#005BD1] text-white rounded-xl font-bold text-[13px] uppercase tracking-wider hover:bg-blue-700 transition-colors"
              >
                Retry Check
              </button>
              <button
                onClick={() => navigate(orderNumber ? `/order-success?orderNumber=${orderNumber}` : '/orders', { replace: true })}
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold text-[13px] uppercase tracking-wider hover:bg-gray-200 transition-colors"
              >
                View Orders
              </button>
            </div>
          </>
        )}

        {status === 'failed' && (
          <>
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mb-6">
              <AlertCircle size={80} className="text-[#E84949]" />
            </motion.div>
            <h2 className="text-2xl font-grandstander font-bold text-[#333] mb-2">Payment Failed</h2>
            <p className="text-gray-500 font-medium text-[14px] mb-6">
              {errorMsg || 'We could not confirm your payment. If money was deducted, it will be refunded by your bank.'}
            </p>
            <button
              onClick={() => navigate('/checkout', { replace: true })}
              className="w-full py-3 bg-[#005BD1] text-white rounded-xl font-bold text-[13px] uppercase tracking-wider hover:bg-blue-700 transition-colors"
            >
              Back to Checkout
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}

export default AirpayCallbackPage;
