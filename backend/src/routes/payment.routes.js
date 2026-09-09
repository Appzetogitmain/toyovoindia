import express from 'express';
import {
  createPayuOrder, handlePayuSuccess, handlePayuFailure,
  createPhonepeOrder, handlePhonepeWebhook, checkPhonepeStatus,
  createJiopayOrder, handleJiopayReturn, handleJiopayWebhook, checkJiopayStatus,
  createAirpayOrder, handleAirpayResponse, handleAirpayWebhook, checkAirpayStatus,
} from '../controllers/payment.controller.js';
import { optionalAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { createPayuOrderSchema, createJiopayOrderSchema, createAirpayOrderSchema } from '../validators/payment.validator.js';

const router = express.Router();

router.post('/payu/order', optionalAuth, validate(createPayuOrderSchema), createPayuOrder);
router.post('/payu/success', handlePayuSuccess);
router.post('/payu/failure', handlePayuFailure);

router.post('/phonepe/initiate', optionalAuth, validate(createPayuOrderSchema), createPhonepeOrder);
router.post('/phonepe/webhook', handlePhonepeWebhook);
router.get('/phonepe/status/:txnid', checkPhonepeStatus);

router.post('/jiopay/initiate', optionalAuth, validate(createJiopayOrderSchema), createJiopayOrder);
router.all('/jiopay/return', handleJiopayReturn);
router.post('/jiopay/webhook', handleJiopayWebhook);
router.get('/jiopay/status/:txnid', checkJiopayStatus);

router.post('/airpay/initiate', optionalAuth, validate(createAirpayOrderSchema), createAirpayOrder);
router.all('/airpay/response', handleAirpayResponse);
router.post('/airpay/webhook', handleAirpayWebhook);
router.get('/airpay/status/:txnid', checkAirpayStatus);

export default router;
