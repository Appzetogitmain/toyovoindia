import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { getCurrentUser, loginUser, logoutUser, registerUser, verifyOtpUser, resendOtpUser } from '../services/authApi'
import { getMyAccountData, updateMyAccountData } from '../services/userAccountApi'
import { requestForToken } from '../config/firebase'
import { removeFcmToken } from '../services/notificationApi'

const AuthContext = createContext()
const AUTH_USER_STORAGE_KEY = 'TOYOVOINDIA_auth_user'
const readStoredUser = () => {
  try {
    const savedUser = localStorage.getItem(AUTH_USER_STORAGE_KEY)
    return savedUser ? JSON.parse(savedUser) : null
  } catch {
    return null
  }
}

const persistAuthUser = (value) => {
  if (value) {
    localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(value))
  } else {
    localStorage.removeItem(AUTH_USER_STORAGE_KEY)
  }
}

const mergeWithStoredAccessToken = (value) => {
  if (!value) return value
  const storedUser = readStoredUser()
  if (!value.accessToken && storedUser?.accessToken) {
    return {
      ...value,
      accessToken: storedUser.accessToken,
    }
  }
  return value
}

const getScopedStorageKey = (baseKey, user) => {
  const scope = user?.id || user?._id || user?.email || 'guest'
  return `${baseKey}_${scope}`
}

const isLegacyMockAddress = (address) => {
  if (!address) return false
  const firstName = String(address.firstName || '').trim().toLowerCase()
  const lastName = String(address.lastName || '').trim().toLowerCase()
  const street = String(address.address || '').trim().toLowerCase()
  const city = String(address.city || '').trim().toLowerCase()
  return firstName === 'john' && lastName === 'doe' && street.includes('toy street') && city === 'mumbai'
}

const sanitizeAddresses = (value) => {
  if (!Array.isArray(value)) return []
  return value.filter((address) => !isLegacyMockAddress(address))
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser)
  const [authLoading, setAuthLoading] = useState(true)
  const [addresses, setAddresses] = useState([])

  const refreshUser = async () => {
    try {
      const currentUser = mergeWithStoredAccessToken(await getCurrentUser())
      setUser(currentUser)
      persistAuthUser(currentUser)
      return currentUser
    } catch {
      const fallbackUser = readStoredUser()
      setUser(fallbackUser)
      return fallbackUser
    }
  }

  useEffect(() => {
    let isMounted = true

    const bootstrapAuth = async () => {
      setAuthLoading(true)
      try {
        const currentUser = mergeWithStoredAccessToken(await getCurrentUser())
        if (isMounted) {
          setUser(currentUser)
          persistAuthUser(currentUser)
        }
      } catch {
        if (isMounted) setUser((previousUser) => previousUser || readStoredUser())
      } finally {
        if (isMounted) setAuthLoading(false)
      }
    }

    bootstrapAuth()
    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    persistAuthUser(user)
  }, [user])

  // Hydrate only addresses from DB. PaymentVault is strictly managed by PaymentContext.
  useEffect(() => {
    let isMounted = true

    const hydrate = async () => {
      if (user) {
        try {
          const data = await getMyAccountData()
          if (!isMounted) return
          
          setAddresses(data.addresses || [])
          return
        } catch {
          // Keep empty array on error, but don't overwrite DB
          if (isMounted) setAddresses([])
        }
      } else {
        // Read guest local storage
        const guestAddressesRaw = localStorage.getItem('TOYOVOINDIA_addresses_guest')
        const guestAddresses = guestAddressesRaw ? sanitizeAddresses(JSON.parse(guestAddressesRaw)) : []
        if (isMounted) setAddresses(guestAddresses)
      }
    }

    hydrate()
    return () => {
      isMounted = false
    }
  }, [user?.id, user?._id, user?.email])

  const login = async (email, password, portal = 'user') => {
    try {
      const result = await loginUser({ email, password, portal })
      if (result.requireOtp) {
        return { success: true, requireOtp: true, phone: result.phone, purpose: result.purpose }
      }
      setUser(result)
      return { success: true, user: result }
    } catch (error) {
      return { success: false, message: error.message || 'Invalid credentials' }
    }
  }

  const register = async (userData) => {
    try {
      const result = await registerUser(userData)
      if (result.requireOtp) {
        return { success: true, requireOtp: true, phone: result.phone, purpose: result.purpose }
      }
      // If no OTP required (legacy mode), we might not be logged in directly
      return { success: true, user: result }
    } catch (error) {
      return { success: false, message: error.message || 'Registration failed' }
    }
  }

  const verifyOtp = async (data) => {
    try {
      const loggedInUser = await verifyOtpUser(data)
      setUser(loggedInUser)
      return { success: true, user: loggedInUser }
    } catch (error) {
      return { success: false, message: error.message || 'Verification failed' }
    }
  }

  const resendOtp = async (phone, purpose) => {
    try {
      const result = await resendOtpUser({ phone, purpose })
      return { success: true, message: result.message || 'OTP resent successfully' }
    } catch (error) {
      return { success: false, message: error.message || 'Failed to resend OTP' }
    }
  }

  const logout = async () => {
    try {
      try {
        const token = await requestForToken();
        if (token) await removeFcmToken(token);
      } catch (fcmErr) {
        console.warn('Failed to remove FCM token on logout', fcmErr);
      }
      await logoutUser()
    } catch {
    } finally {
      setUser(null)
      // We clear addresses to prevent data leaking between users
      setAddresses([])
    }
  }

  const updateUser = (newData) => {
    setUser((prev) => ({ ...prev, ...newData }))
  }

  // Database Sync Helpers
  const persistAddresses = async (newAddresses) => {
    setAddresses(newAddresses)
    if (user) {
      try {
        await updateMyAccountData({ addresses: newAddresses })
      } catch (err) {
        console.error('Failed to sync addresses to DB', err)
      }
    } else {
      localStorage.setItem('TOYOVOINDIA_addresses_guest', JSON.stringify(newAddresses))
    }
  }

  const addAddress = (address) => {
    const newAddress = { ...address, id: Date.now().toString(), isDefault: addresses.length === 0 }
    persistAddresses([...addresses, newAddress])
  }

  const deleteAddress = (id) => {
    persistAddresses(addresses.filter((address) => address.id !== id))
  }

  const updateAddress = (id, updatedAddress) => {
    persistAddresses(addresses.map((address) => (
      address.id === id ? { ...updatedAddress, id } : address
    )))
  }

  const setAsDefaultAddress = (id) => {
    persistAddresses(addresses.map((address) => ({ ...address, isDefault: address.id === id })))
  }

  const isAdmin = ['admin', 'super_admin'].includes(user?.role)

  return (
    <AuthContext.Provider value={{
      user,
      authLoading,
      isAdmin,
      refreshUser,
      login,
      verifyOtp,
      resendOtp,
      register,
      logout,
      updateUser,
      addresses,
      addAddress,
      deleteAddress,
      updateAddress,
      setAsDefaultAddress,
    }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
