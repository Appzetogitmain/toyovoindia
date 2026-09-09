import { z } from 'zod';
import { createOrderSchema } from './order.validator.js';

// Re-use order validation for PayU order creation
export const createPayuOrderSchema = createOrderSchema;

// Re-use order validation for JioPay order creation
export const createJiopayOrderSchema = createOrderSchema;

// Re-use order validation for Airpay order creation
export const createAirpayOrderSchema = createOrderSchema;
