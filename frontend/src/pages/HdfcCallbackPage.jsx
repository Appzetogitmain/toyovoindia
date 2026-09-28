import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { checkHdfcPaymentStatus } from '../services/orderApi';
import { useCart } from '../context/CartContext';

export function HdfcCallbackPage() {
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
      // Poll up to 4 times with progressive backoff — the S2S webhook is the
      // primary source of truth, this just gives the UI something to react to.
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          const response = await checkHdfcPaymentStatus(txnid);

          if (response.status === 'success') {
            setStatus('success');
            clearCart();
            setTimeout(() => {
              navigate(`/order-success?orderNumber=${response.orderNumber}`, { replace: true });
            }, 1500);
            return;
          }

          if (response.status === 'failed') {
            setStatus('failed');
            setTimeout(() => {
              navigate('/checkout?error=PaymentFailed', { replace: true });
            }, 2000);
            return;
          }

          if (attempt < 4) {
            await new Promise((res) => setTimeout(res, 2500));
          }
        } catch (error) {
          if (attempt === 4) {
            setStatus('failed');
            setErrorMsg('Server unreachable while verifying payment.');
            setTimeout(() => {
              navigate('/checkout?error=VerificationTimeout', { replace: true });
            }, 3000);
            return;
          }
          await new Promise((res) => setTimeout(res, 2000));
        }
      }

      setStatus('pending');
      setTimeout(() => {
        navigate('/checkout?error=PaymentPendingCheckHistory', { replace: true });
      }, 3000);
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
            <p className="text-gray-500 font-medium text-[14px]">Please do not close this window. We are confirming your transaction securely with HDFC SmartGateway.</p>
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

export default HdfcCallbackPage;
