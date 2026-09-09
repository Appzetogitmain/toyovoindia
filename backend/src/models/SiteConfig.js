import mongoose from 'mongoose';

const siteConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    default: 'default',
  },
  // --- General Settings ---
  siteName: { type: String, default: 'Toyove India' },
  siteLogo: {
    url: { type: String, default: 'https://www.toyovoindia.com/favicon.webp' },
    publicId: { type: String, default: 'https://www.toyovoindia.com/favicon.webp' }
  },
  favicon: { type: String, default: 'https://www.toyovoindia.com/favicon.webp' },
  maintenanceMode: { type: Boolean, default: false },

  // --- Announcement Bar ---
  announcementMessages: {
    type: [String],
    default: [
      'Free Shipping On Orders Over ₹999!',
      '10% off your next order, use code : TOYOVOINDIA001',
      'New arrivals every week - shop now',
    ],
  },
  announcementBg: { type: String, default: '#6651A4' },
  announcementTextColor: { type: String, default: '#FFFFFF' },

  // --- Financial & Shipping ---
  currencySymbol: { type: String, default: '₹' },
  freeShippingThreshold: { type: Number, default: 999 },
  defaultShippingFee: { type: Number, default: 99 },
  taxPercentage: { type: Number, default: 0 },
  codEnabled: { type: Boolean, default: true },
  paymentGateways: {
    phonepeEnabled: { type: Boolean, default: true },
    payuEnabled: { type: Boolean, default: true },
    jiopayEnabled: { type: Boolean, default: true },
    airpayEnabled: { type: Boolean, default: true },
  },

  // --- Contact & Social ---
  contactEmail: { type: String, default: 'toyovoindia@gmail.com' },
  contactPhone: { type: String, default: '+91 7901931534' },
  contactAddress: { type: String, default: 'UNIT 703, 7th FLOOR, BLOCK 1 MAYAGARDEN, Zirakpur, Rajpura, Mohali- 140603, Punjab' },
  socialLinks: {
    instagram: { type: String, default: 'https://instagram.com/' },
    facebook: { type: String, default: 'https://facebook.com/' },
    twitter: { type: String, default: 'https://twitter.com/' },
    linkedin: { type: String, default: 'https://linkedin.com/' },
    youtube: { type: String, default: 'https://www.youtube.com/' }
  },

  // --- Storefront Media (Hero Slider) ---
  storefrontMedia: {
    showDefaultHero: { type: Boolean, default: true },
    heroBanners: {
      type: [{
        url: { type: String, default: '' },
        publicId: { type: String, default: '' },
        alt: { type: String, default: '' },
      }],
      default: [],
    },
  },

  // --- Existing Popup Settings ---
  purchasePopup: {
    enabled: { type: Boolean, default: true },
    initialDelaySeconds: { type: Number, default: 60 },
    repeatDelaySeconds: { type: Number, default: 120 },
    visibleDurationSeconds: { type: Number, default: 10 },
    maskNames: { type: Boolean, default: true },
  },
}, { timestamps: true });

const SiteConfig = mongoose.model('SiteConfig', siteConfigSchema);
export default SiteConfig;
