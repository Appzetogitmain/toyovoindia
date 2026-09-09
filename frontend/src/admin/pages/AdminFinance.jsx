import { useEffect, useMemo, useState } from 'react'
import { DollarSign, CreditCard, Landmark, Settings as SettingsIcon, Search, Wallet, User, RefreshCcw, Download } from 'lucide-react'
import { getAdminOrders } from '../../services/orderApi'
import { getAdminUsers } from '../../services/adminUserApi'
import { getAdminStorefrontSettings, updateAdminStorefrontSettings } from '../../services/siteApi'
import { useToast } from '../../context/ToastContext'

export function AdminFinance() {
  const { error: showError } = useToast()
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [search, setSearch] = useState('')
  const [ledgerStatus, setLedgerStatus] = useState('All')
  const [orders, setOrders] = useState([])
  const [users, setUsers] = useState([])
  const [gatewaysConfig, setGatewaysConfig] = useState({ phonepeEnabled: true, payuEnabled: true, jiopayEnabled: true, airpayEnabled: true })
  const [savingGateway, setSavingGateway] = useState(false)

  useEffect(() => {
    let isMounted = true

    const loadFinance = async () => {
      setLoading(true)
      try {
        const [{ orders: orderData }, { users: userData }, configData] = await Promise.all([
          getAdminOrders({ limit: 100 }),
          getAdminUsers({ limit: 100 }),
          getAdminStorefrontSettings(),
        ])
        if (!isMounted) return
        setOrders(orderData)
        setUsers(userData)
        if (configData?.paymentGateways) {
          setGatewaysConfig(configData.paymentGateways)
        }
      } catch (error) {
        if (isMounted) showError(error.message || 'Financial data could not be loaded')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadFinance()
    return () => {
      isMounted = false
    }
  }, [showError])

  const tabs = [
    { id: 'overview', label: 'Overview', icon: <DollarSign size={18} /> },
    { id: 'ledger', label: 'Ledger', icon: <CreditCard size={18} /> },
    { id: 'accounts', label: 'Account Hub', icon: <Landmark size={18} /> },
    { id: 'gateway', label: 'Gateway', icon: <SettingsIcon size={18} /> },
  ]

  const paidOrders = useMemo(() => orders.filter((order) => order.paymentStatus === 'paid' && order.status !== 'cancelled'), [orders])
  const refundedOrders = useMemo(() => orders.filter((order) => order.paymentStatus === 'refunded'), [orders])
  const grossRevenue = paidOrders.reduce((sum, order) => sum + order.total, 0)
  const refundedAmount = refundedOrders.reduce((sum, order) => sum + order.total, 0)
  const processingOrders = orders.filter((order) => order.status === 'processing').length
  const ledgerRows = useMemo(() => orders.filter((order) => {
    if (ledgerStatus !== 'All' && order.status !== ledgerStatus.toLowerCase()) return false;
    const query = search.trim().toLowerCase()
    if (!query) return true
    return [
      order.orderNumber,
      order.customerName,
      order.customerEmail,
      order.paymentMethodLabel,
      order.paymentStatusLabel,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query))
  }), [orders, search, ledgerStatus])

  const accountRows = useMemo(() => users.map((user) => {
    const userOrders = orders.filter((order) => order.user?._id === user.id || order.customerEmail === user.email)
    const totalSpend = userOrders
      .filter((order) => order.paymentStatus === 'paid')
      .reduce((sum, order) => sum + order.total, 0)
    return {
      ...user,
      orderCount: userOrders.length,
      totalSpend,
    }
  }).filter((user) => {
    const query = search.trim().toLowerCase()
    if (!query) return true
    return [user.name, user.email].filter(Boolean).some((value) => value.toLowerCase().includes(query))
  }), [orders, search, users])
  const handleExportCSV = () => {
    if (!ledgerRows || ledgerRows.length === 0) {
      showError('No transactions found to export')
      return
    }

    const data = ledgerRows.map(o => ({
      Order: `#${o.orderNumber}`,
      Customer: o.customerName,
      Email: o.customerEmail,
      Method: o.paymentMethodLabel || 'N/A',
      Status: o.paymentStatusLabel || o.paymentStatus,
      Amount: o.total,
      Date: o.createdAt ? new Date(o.createdAt).toISOString().replace('T', ' ').substring(0, 19) + ' UTC' : 'N/A'
    }))

    const header = Object.keys(data[0])
    const csvRows = [
      header.join(','),
      ...data.map(row => 
        header.map(fieldName => {
          const value = row[fieldName] ?? ''
          const stringValue = String(value).replace(/"/g, '""')
          return `"${stringValue}"`
        }).join(',')
      )
    ]

    const csvString = csvRows.join('\n')
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `Financial_Ledger_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleToggleGateway = async (gateway) => {
    try {
      setSavingGateway(true)
      const newConfig = { ...gatewaysConfig, [gateway]: !gatewaysConfig[gateway] }
      await updateAdminStorefrontSettings({ paymentGateways: newConfig })
      setGatewaysConfig(newConfig)
    } catch (error) {
      showError('Failed to update gateway status')
    } finally {
      setSavingGateway(false)
    }
  }

  return (
    <div className="shell space-y-8 pb-10">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div>
          <h1 className="text-2xl md:text-4xl font-grandstander font-bold text-gray-800">Financial Hub</h1>
          <p className="text-gray-500 font-medium text-[12px] md:text-sm mt-1">Live order, payment, and customer payment data.</p>
        </div>
        <div className="flex gap-2 bg-white p-1.5 rounded-2xl shadow-sm border border-black/[0.03] overflow-x-auto custom-scrollbar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] md:text-[11px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${
                activeTab === tab.id ? 'bg-[#6651A4] text-white shadow-md' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="shrink-0">{tab.icon}</span> {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-[40vh] flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 border-4 border-gray-200 border-t-[#E84949] rounded-full animate-spin" />
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest animate-pulse">Syncing finance data...</p>
        </div>
      ) : (
        <>
          {activeTab === 'overview' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-8 rounded-[32px] shadow-sm border border-black/[0.03]">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Gross Revenue</p>
                  <h3 className="text-4xl font-grandstander font-bold text-gray-800">₹{grossRevenue.toFixed(2)}</h3>
                  <div className="mt-4 text-[11px] font-bold text-green-500">{paidOrders.length} paid orders</div>
                </div>
                <div className="bg-[#6651A4] p-8 rounded-[32px] shadow-xl text-white">
                  <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-2">Refunded Amount</p>
                  <h3 className="text-4xl font-grandstander font-bold">₹{refundedAmount.toFixed(2)}</h3>
                  <p className="mt-4 text-white/50 text-[10px] font-medium italic">{refundedOrders.length} refunded orders</p>
                </div>
                <div className="bg-white p-8 rounded-[32px] shadow-sm border border-black/[0.03]">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Pending Fulfillment</p>
                  <h3 className="text-4xl font-grandstander font-bold text-gray-800">{processingOrders}</h3>
                  <div className="mt-4 text-[11px] font-bold text-[#F1641E]">processing orders</div>
                </div>
              </div>
              <div className="bg-white p-8 rounded-[32px] border border-black/[0.03] shadow-sm">
                <h3 className="text-lg font-grandstander font-bold text-gray-800 mb-6 flex items-center gap-2"><Wallet size={18} className="text-[#6651A4]" /> Payment Mix</h3>
                <div className="space-y-4">
                  {Object.entries(paidOrders.reduce((acc, order) => {
                    const key = order.paymentMethodLabel || 'Unknown'
                    acc[key] = (acc[key] || 0) + order.total
                    return acc
                  }, {})).map(([name, amount]) => (
                    <div key={name} className="flex items-center justify-between p-4 bg-[#FDF4E6]/40 rounded-2xl">
                      <span className="text-[12px] font-bold text-gray-700 uppercase tracking-widest">{name}</span>
                      <span className="text-[14px] font-bold text-gray-900">₹{Number(amount).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ledger' && (
            <div className="bg-white rounded-[32px] border border-black/[0.03] shadow-sm overflow-hidden">
              <div className="p-6 border-b border-black/[0.03] flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
                  <div className="relative w-full md:w-96">
                    <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} type="text" placeholder="Search orders, customer, payment..." className="w-full h-11 pl-11 pr-4 bg-[#FDF4E6]/50 rounded-xl outline-none border border-transparent focus:border-[#6651A4]/30 text-[13px] font-medium" />
                  </div>
                  <select 
                    value={ledgerStatus} onChange={(e) => setLedgerStatus(e.target.value)}
                    className="h-11 px-4 bg-[#FDF4E6]/50 rounded-xl outline-none border border-transparent focus:border-[#6651A4]/30 text-[11px] font-bold text-gray-600 uppercase tracking-widest cursor-pointer w-full md:w-auto"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Pending">Pending</option>
                    <option value="Processing">Processing</option>
                    <option value="Shipped">Shipped</option>
                    <option value="Delivered">Delivered</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
                <button 
                  onClick={handleExportCSV}
                  className="flex items-center justify-center gap-2 h-11 px-6 bg-[#6651A4] text-white rounded-xl font-bold uppercase tracking-widest text-[10px] hover:bg-[#5a4892] transition-all shadow-md active:scale-95 whitespace-nowrap"
                >
                  <Download size={14} /> Export CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-[#FAEAD3]/30">
                    <tr>
                      <th className="py-4 px-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Order</th>
                      <th className="py-4 px-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Customer</th>
                      <th className="py-4 px-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Email</th>
                      <th className="py-4 px-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Method</th>
                      <th className="py-4 px-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status</th>
                      <th className="py-4 px-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRows.map((order) => (
                      <tr key={order.id} className="border-b border-gray-50 last:border-0">
                        <td className="py-4 px-6 text-[13px] font-bold text-[#6651A4] font-mono">#{order.orderNumber}</td>
                        <td className="py-4 px-6 text-[13px] font-bold text-gray-700">{order.customerName}</td>
                        <td className="py-4 px-6 text-[13px] text-gray-500">{order.customerEmail}</td>
                        <td className="py-4 px-6 text-[12px] text-gray-500">{order.paymentMethodLabel}</td>
                        <td className="py-4 px-6 text-[12px] font-bold text-gray-700">{order.paymentStatusLabel}</td>
                        <td className="py-4 px-6 text-[14px] font-bold text-gray-800 text-right">₹{order.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'accounts' && (
            <div className="bg-white p-8 rounded-[32px] border border-black/[0.03] shadow-sm">
              <div className="relative w-full md:w-96 mb-6">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} type="text" placeholder="Search users..." className="w-full h-11 pl-11 pr-4 bg-[#FDF4E6]/50 rounded-xl outline-none border border-transparent focus:border-[#6651A4]/30 text-[13px] font-medium" />
              </div>
              <div className="space-y-4">
                {accountRows.map((account) => (
                  <div key={account.id} className="flex items-center justify-between p-5 bg-[#FAEAD3]/30 rounded-3xl border border-white shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-[#6651A4]"><User size={18} /></div>
                      <div>
                        <p className="text-[14px] font-bold text-gray-800">{account.name || account.email}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{account.email}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-bold text-[#6651A4]">{account.orderCount} orders</p>
                      <p className="text-[11px] text-gray-500">₹{account.totalSpend.toFixed(2)} paid</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'gateway' && (
            <div className="max-w-3xl space-y-8">
              <div className="bg-white p-8 rounded-[32px] border border-black/[0.03] shadow-sm space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center"><SettingsIcon size={24} /></div>
                    <div>
                      <h3 className="text-xl font-grandstander font-bold text-gray-800">Gateway Snapshot</h3>
                      <p className="text-[12px] text-gray-500 font-medium">Current live payment activity derived from orders</p>
                    </div>
                  </div>
                  <button className="h-10 px-6 bg-green-50 text-green-600 rounded-xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2">
                    <RefreshCcw size={14} /> Live
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="h-12 px-4 bg-[#FDF4E6] rounded-xl flex items-center text-[13px] font-bold text-gray-700">
                    Paid Orders: {paidOrders.length}
                  </div>
                  <div className="h-12 px-4 bg-[#FDF4E6] rounded-xl flex items-center text-[13px] font-bold text-gray-700">
                    Refunded Orders: {refundedOrders.length}
                  </div>
                </div>

                <div className="pt-6 border-t border-black/[0.03]">
                  <h4 className="text-sm font-bold text-gray-800 uppercase tracking-widest mb-4">Payment Methods Configuration</h4>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-[#F8F9FA] rounded-2xl">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center font-bold">P</div>
                        <div>
                          <p className="text-sm font-bold text-gray-800">PhonePe Checkout V2</p>
                          <p className="text-[10px] text-gray-500 font-medium">UPI, Cards & Netbanking</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleToggleGateway('phonepeEnabled')}
                        disabled={savingGateway}
                        className={`relative w-12 h-6 rounded-full transition-colors ${gatewaysConfig.phonepeEnabled ? 'bg-green-500' : 'bg-gray-300'}`}
                      >
                        <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${gatewaysConfig.phonepeEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-[#F8F9FA] rounded-2xl">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center font-bold">U</div>
                        <div>
                          <p className="text-sm font-bold text-gray-800">PayU Standard</p>
                          <p className="text-[10px] text-gray-500 font-medium">Backup PG for stability</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleToggleGateway('payuEnabled')}
                        disabled={savingGateway}
                        className={`relative w-12 h-6 rounded-full transition-colors ${gatewaysConfig.payuEnabled ? 'bg-green-500' : 'bg-gray-300'}`}
                      >
                        <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${gatewaysConfig.payuEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-[#F8F9FA] rounded-2xl">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center font-bold">J</div>
                        <div>
                          <p className="text-sm font-bold text-gray-800">JioPay Hosted Checkout</p>
                          <p className="text-[10px] text-gray-500 font-medium">UPI, Cards, Netbanking & Wallets</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleToggleGateway('jiopayEnabled')}
                        disabled={savingGateway}
                        className={`relative w-12 h-6 rounded-full transition-colors ${gatewaysConfig.jiopayEnabled ? 'bg-green-500' : 'bg-gray-300'}`}
                      >
                        <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${gatewaysConfig.jiopayEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-[#F8F9FA] rounded-2xl">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center font-bold">A</div>
                        <div>
                          <p className="text-sm font-bold text-gray-800">Airpay Hosted Checkout</p>
                          <p className="text-[10px] text-gray-500 font-medium">UPI, Cards, Netbanking & Wallets (Test Gateway)</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleToggleGateway('airpayEnabled')}
                        disabled={savingGateway}
                        className={`relative w-12 h-6 rounded-full transition-colors ${gatewaysConfig.airpayEnabled ? 'bg-green-500' : 'bg-gray-300'}`}
                      >
                        <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${gatewaysConfig.airpayEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
