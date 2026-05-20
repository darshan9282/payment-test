import { Router } from 'express';
import * as controller from '../controllers/payment.controller';
import { idempotencyMiddleware } from '../middleware/idempotency.middleware';
import { paymentCreateLimiter } from '../middleware/rate-limiter';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Payments
 *   description: Payment lifecycle management
 */

/**
 * @swagger
 * /api/payments:
 *   post:
 *     summary: Initiate a new payment
 *     tags: [Payments]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique key to prevent duplicate payment creation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, currency, customerId]
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 99.99
 *               currency:
 *                 type: string
 *                 example: USD
 *               customerId:
 *                 type: string
 *                 example: cust_123
 *               description:
 *                 type: string
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: Payment created and queued for processing
 *       400:
 *         description: Validation error or missing Idempotency-Key
 *       429:
 *         description: Rate limit exceeded
 */
router.post('/', paymentCreateLimiter, idempotencyMiddleware, controller.createPayment);

/**
 * @swagger
 * /api/payments:
 *   get:
 *     summary: List payments with optional filtering
 *     tags: [Payments]
 *     parameters:
 *       - in: query
 *         name: customerId
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PROCESSING, SUCCESS, FAILED]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Paginated list of payments
 */
router.get('/', controller.listPayments);

/**
 * @swagger
 * /api/payments/{id}:
 *   get:
 *     summary: Get payment by ID
 *     tags: [Payments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment details
 *       404:
 *         description: Payment not found
 */
router.get('/:id', controller.getPayment);

/**
 * @swagger
 * /api/payments/{id}/retry:
 *   post:
 *     summary: Manually retry a failed payment
 *     tags: [Payments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment reset to PENDING and re-queued
 *       409:
 *         description: Payment is not in FAILED state
 */
router.post('/:id/retry', controller.retryPayment);

/**
 * @swagger
 * /api/payments/{id}/webhook:
 *   post:
 *     summary: Receive asynchronous payment status update from gateway
 *     tags: [Payments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [SUCCESS, FAILED]
 *               transactionId:
 *                 type: string
 *               timestamp:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Webhook received
 *       400:
 *         description: Invalid payload
 *       404:
 *         description: Payment not found
 */
router.post('/:id/webhook', controller.handleWebhook);

export default router;
