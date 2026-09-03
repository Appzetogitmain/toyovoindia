import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { checkJiopayPaymentStatus } from '../services/orderApi';
import { useCart } from '../context/CartContext';

export function JiopayCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { clearCart } = useCart();
  const [status, setStatus] = useState('verifying');
  const [errorMsg, setErrorMsg] = useState('');

  const txnid = searchParams.get('txnid');
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    if (!txnid) {
      navigate('/checkout?error=MissingTransactionId', { replace: true });
      return;
    }

    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    const verifyPayment = async () => {
      try {
        // Give the S2S webhook a couple of seconds to arrive first — it's the primary source of truth.
        await new Promise((res) => setTimeout(res, 2000));

        const response = await checkJiopayPaymentStatus(txnid);

        if (response.status === 'success') {
          setStatus('success');
          clearCart();
          setTimeout(() => {
            navigate(`/order-success?orderNumber=${response.orderNumber}`, { replace: true });
          }, 1500);
        } else if (response.status === 'pending') {
          setStatus('pending');
          setTimeout(() => {
            navigate('/checkout?error=PaymentPendingCheckHistory', { replace: true });
          }, 3000);
        } else {
          setStatus('failed');
          setTimeout(() => {
            navigate('/checkout?error=PaymentFailed', { replace: true });
          }, 2000);
        }
      } catch (error) {
        setStatus('failed');
        setErrorMsg('Server unreachable while verifying payment.');
        setTimeout(() => {
          navigate('/checkout?error=VerificationTimeout', { replace: true });
        }, 3000);
      }
    };

    verifyPayment();
  }, [txnid, navigate]);

  return (
    <div className="min-h-screen bg-[#FDF4E6] flex flex-col items-center justify-center p-4 font-roboto">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white p-10 rounded-3xl shadow-xl flex flex-col items-center text-center max-w-sm w-full"
      >
        {status === 'verifying' && (
          <>
            <div className="relative mb-6">
              <div className="w-20 h-20 border-8 border-gray-100 border-t-[#6651A4] rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center"><RefreshCw className="text-[#6651A4] animate-pulse" size={24} /></div>
            </div>
            <h2 className="text-2xl font-grandstander font-bold text-[#333] mb-2">Verifying Payment...</h2>
            <p className="text-gray-500 font-medium text-[14px]">Please do not close this window. We are confirming your transaction securely with JioPay.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mb-6">
              <CheckCircle size={80} className="text-green-500" />
            </motion.div>
            <h2 className="text-2xl font-grandstander font-bold text-[#333] mb-2">Payment Successful!</h2>
            <p className="text-gray-500 font-medium text-[14px]">Redirecting to your order confirmation...</p>
          </>
        )}

        {(status === 'failed' || status === 'pending') && (
          <>
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mb-6">
              <AlertCircle size={80} className="text-[#E84949]" />
            </motion.div>
            <h2 className="text-2xl font-grandstander font-bold text-[#333] mb-2">
              {status === 'pending' ? 'Payment Delayed' : 'Payment Failed'}
            </h2>
            <p className="text-gray-500 font-medium text-[14px]">
              {errorMsg || 'We could not confirm your payment. Redirecting back...'}
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
