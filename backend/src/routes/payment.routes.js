import express from 'express';
import {
  createPayuOrder, handlePayuSuccess, handlePayuFailure,
  createPhonepeOrder, handlePhonepeWebhook, checkPhonepeStatus,
  createJiopayOrder, handleJiopayReturn, handleJiopayWebhook, checkJiopayStatus,
  createAirpayOrder, handleAirpayResponse, handleAirpayWebhook, checkAirpayStatus,
  createDeekpayOrder, handleDeekpayCallback, handleDeekpayReturn, checkDeekpayStatus,
} from '../controllers/payment.controller.js';
import { optionalAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import {
  createPayuOrderSchema,
  createJiopayOrderSchema,
  createAirpayOrderSchema,
  createDeekpayOrderSchema,
} from '../validators/payment.validator.js';

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

router.post('/deekpay/initiate', optionalAuth, validate(createDeekpayOrderSchema), createDeekpayOrder);
router.all('/deekpay/return', handleDeekpayReturn);
router.all('/deekpay/webhook', handleDeekpayCallback);
router.get('/deekpay/status/:txnid', checkDeekpayStatus);

export default router;
