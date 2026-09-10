import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';

import env from './config/env.js';
import { requestId } from './middlewares/requestId.js';
import { apiLimiter } from './middlewares/rateLimiter.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFound } from './middlewares/notFound.js';
import apiRoutes from './routes/index.js';
import logger from './utils/logger.js';

const app = express();
app.set('trust proxy', 1);

// Global Middlewares
app.use(requestId);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin or 'null' origin (like direct browser visits, mobile apps, or PayU form POST redirects)
    if (!origin || origin === 'null') {
      return callback(null, true);
    }
    
    const normalizedOrigin = origin?.replace(/\/+$/, '');
    if (env.ALLOWED_ORIGINS.includes(normalizedOrigin)) {
      return callback(null, true);
    }
    if (env.ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(normalizedOrigin))) {
      return callback(null, true);
    }

    logger.warn('CORS blocked request', {
      origin,
      normalizedOrigin,
      allowedOrigins: env.ALLOWED_ORIGINS,
      allowedOriginPatterns: env.ALLOWED_ORIGIN_PATTERNS.map((pattern) => pattern.toString()),
      method: 'cors-origin-check'
    });
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Data sanitization against NoSQL query injection.
// express-mongo-sanitize assigns req.query, which is read-only in Express 5.
app.use((req, res, next) => {
  ['body', 'params', 'query'].forEach((key) => {
    if (req[key] && typeof req[key] === 'object') {
      mongoSanitize.sanitize(req[key]);
    }
  });
  next();
});

// Logging
if (env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// API Routes with Rate Limiting
app.use('/api', apiLimiter, apiRoutes);

// Root route for API metadata
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Toyovo India API',
    requestId: req.id,
    meta: {
      version: '1.0.0',
      status: 'active',
      apiBase: '/api',
      health: '/api/health'
    }
  });
});

// Error Handling
app.use(notFound);
app.use(errorHandler);

export default app;
