import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyD5vHgsmPBJ9-elOMgzEcRvhEd2ctiXMWk',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'toyovoindia-95fde.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'toyovoindia-95fde',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'toyovoindia-95fde.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '614606970846',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:614606970846:web:0816f8864e7a0063d2874f',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);
let messaging = null;

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  try {
    messaging = getMessaging(app);
  } catch (error) {
    console.warn('[FCM] Messaging is unavailable:', error);
  }
}

// Explicitly register service worker for robust FCM support
const registerServiceWorker = async () => {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      console.log('[FCM] Service Worker registered with scope:', registration.scope);
      return registration;
    } catch (err) {
      console.error('[FCM] Service Worker registration failed:', err);
    }
  }
  return null;
};

export const requestForToken = async () => {
  if (!messaging || typeof Notification === 'undefined') return null;

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      // Ensure SW is registered before getting token
      const registration = await registerServiceWorker();

      const currentToken = await getToken(messaging, {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
        serviceWorkerRegistration: registration,
      });
      return currentToken;
    }
  } catch (error) {
    console.error('FCM Token Error:', error);
  }
  return null;
};

export const onForegroundMessage = (callback) => {
  if (!messaging) return () => { };

  return onMessage(messaging, (payload) => {
    callback(payload);
  });
};

export default app;
