import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronLeft, ArrowUpRight, ArrowDownRight, CreditCard, User, Clock, FileText, CheckCircle, AlertCircle, RefreshCcw } from 'lucide-react'
import { getAdminOrder } from '../../services/orderApi'
import { useToast } from '../../context/ToastContext'

export function AdminTransactionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { error: showError } = useToast()
  const [loading, setLoading] = useState(true)
  const [txn, setTxn] = useState(null)

  useEffect(() => {
    let isMounted = true
    const loadTransaction = async () => {
      setLoading(true)
      try {
        const order = await getAdminOrder(id)
        if (!isMounted) return

        const isRefund = order.paymentStatus === 'refunded'
        setTxn({
          id: order.id,
          orderNumber: order.orderNumber,
          type: isRefund ? 'Credit' : 'Debit',
          category: isRefund ? 'Refund' : 'Order Payment',
          amount: order.total,
          method: order.paymentMethodLabel,
          status: order.paymentStatusLabel,
          date: new Intl.DateTimeFormat('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(order.createdAt || Date.now())),
          user: {
            name: order.customerName,
            email: order.customerEmail,
            id: order.user?._id || order.user?.id || 'guest',
          },
          reference: order.paymentGateway?.airpayPaymentId || order.paymentGateway?.airpayTxnId || order.paymentGateway?.phonepeTxnId || order.paymentGateway?.jiopayPaymentId || order.paymentGateway?.payuMihpayid || order.paymentGateway?.payuTxnId || order.orderNumber,
          timeline: (order.statusHistory || []).map((event) => ({
            time: new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(event.createdAt)),
            desc: event.note || `Status changed to ${event.status}`,
            status: event.status === 'cancelled' ? 'failed' : event.status === 'delivered' ? 'success' : 'processing',
          })),
        })
      } catch (error) {
        if (isMounted) {
          setTxn(null)
          showError(error.message || 'Transaction detail could not be loaded')
        }
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadTransaction()
    return () => {
      isMounted = false
    }
  }, [id, showError])

  if (loading) {
    return (
      <div className="shell flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-gray-200 border-t-[#6651A4] rounded-full animate-spin" />
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest animate-pulse">Loading Ledger Entry...</p>
        </div>
      </div>
    )
  }

  if (!txn) {
    return (
      <div className="shell flex items-center justify-center h-[60vh]">
        <div className="bg-white rounded-[32px] p-10 text-center border border-black/[0.03] shadow-sm">
          <p className="text-[#E8312A] font-bold text-sm">Transaction not found</p>
          <button onClick={() => navigate('/admin/transactions')} className="mt-5 h-10 px-6 bg-[#6651A4] text-white rounded-xl text-[10px] font-bold uppercase tracking-widest">
            Back to Ledger
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="shell space-y-6 pb-10">
      <div className="flex items-center justify-between border-b border-black/[0.05] pb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-gray-400 hover:text-[#6651A4] hover:bg-[#FAEAD3] shadow-sm transition-all">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl md:text-3xl font-grandstander font-bold text-gray-800 flex items-center gap-3">
              Ledger Entry
              <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${txn.status === 'Paid' ? 'bg-green-50 text-green-600' : txn.status === 'Failed' ? 'bg-red-50 text-red-600' : txn.status === 'Refunded' ? 'bg-blue-50 text-blue-600' : 'bg-yellow-50 text-yellow-600'}`}>
                {txn.status}
              </span>
            </h1>
            <p className="text-gray-500 font-medium text-sm font-mono mt-1">#{txn.orderNumber}</p>
          </div>
        </div>
        <button className="h-10 px-4 bg-white border border-gray-200 text-gray-600 rounded-xl font-bold uppercase tracking-widest text-[10px] shadow-sm hover:bg-gray-50 flex items-center gap-2">
          <RefreshCcw size={14} /> Live Sync
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[32px] p-8 shadow-sm border border-black/[0.03] flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-md ${txn.type === 'Credit' ? 'bg-green-400' : 'bg-[#E8312A]'}`}>
                {txn.type === 'Credit' ? <ArrowDownRight size={32}/> : <ArrowUpRight size={32}/>}
              </div>
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1">{txn.category}</p>
                <h2 className={`text-5xl font-grandstander font-bold ${txn.type === 'Credit' ? 'text-green-500' : 'text-gray-800'}`}>
                  {txn.type === 'Credit' ? '+' : '-'}₹{txn.amount.toFixed(2)}
                </h2>
              </div>
            </div>
            <div className="text-right hidden md:block">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1">Date & Time</p>
              <p className="text-[15px] font-bold text-gray-700">{txn.date}</p>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white rounded-[32px] p-8 shadow-sm border border-black/[0.03] space-y-8">
            <h3 className="text-xl font-grandstander font-bold text-gray-800">Transaction Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div>
                  <p className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2"><CreditCard size={14}/> Payment Method</p>
                  <p className="text-[14px] font-bold text-gray-700">{txn.method}</p>
                </div>
                <div>
                  <p className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2"><FileText size={14}/> Reference No.</p>
                  <p className="text-[14px] font-mono font-bold text-gray-700 break-all">{txn.reference}</p>
                </div>
              </div>
              <div className="space-y-6 p-5 bg-[#FDF4E6]/50 rounded-2xl border border-black/[0.02]">
                <p className="flex items-center gap-2 text-[10px] font-bold text-[#6651A4] uppercase tracking-widest mb-2"><User size={14}/> Explorer Info</p>
                <div>
                  <p className="text-[15px] font-bold text-gray-800">{txn.user.name}</p>
                  <p className="text-[12px] text-gray-500 mt-1">{txn.user.email}</p>
                  <p className="text-[10px] font-mono text-gray-400 mt-2">ID: {txn.user.id}</p>
                </div>
                <button onClick={() => txn.user.id !== 'guest' && navigate(`/admin/users/${txn.user.id}`)} className="text-[10px] font-bold uppercase tracking-widest text-[#F1641E] hover:underline">View Full Profile</button>
              </div>
            </div>
          </motion.div>
        </div>

        <div className="space-y-8">
          <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="bg-white rounded-[32px] p-6 shadow-sm border border-black/[0.03]">
            <h3 className="text-lg font-grandstander font-bold text-gray-800 mb-6 flex items-center gap-2"><Clock size={18}/> Processing Timeline</h3>
            <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gray-100 pl-10">
              {txn.timeline.map((event, i) => (
                <div key={i} className="relative flex items-center justify-between">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-full border-4 border-white shrink-0 absolute left-[-40px] ${event.status === 'success' ? 'bg-green-500 text-white' : event.status === 'failed' ? 'bg-red-500 text-white' : 'bg-[#6651A4] text-white'}`}>
                    {event.status === 'success' ? <CheckCircle size={14}/> : event.status === 'failed' ? <AlertCircle size={14}/> : <Clock size={14}/>}
                  </div>
                  <div className="w-full bg-[#FDF4E6]/50 p-4 rounded-xl border border-black/[0.02] shadow-sm">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{event.time}</p>
                    <p className="text-[12px] font-medium text-gray-700">{event.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
