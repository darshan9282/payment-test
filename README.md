# Payment Gateway

A production-grade payment processing system built with **Node.js · TypeScript · MongoDB**.

Covers the full payment lifecycle with retry logic, idempotency, concurrency control, circuit breaker, webhook handling, rate limiting, and Swagger API docs.

---

## Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Payment States](#payment-states)
- [Design Decisions](#design-decisions)
- [Running Tests](#running-tests)
- [Project Structure](#project-structure)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        REST Client                          │
└──────────────────────────┬──────────────────────────────────┘
                           │  POST /api/payments
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Rate Limiter                                               │
│  • Global:   100 req / 15 min per IP                        │
│  • Create:   10 req / 1 min per customer                    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Idempotency Middleware                                      │
│  • Requires Idempotency-Key header                          │
│  • Returns cached response if key already seen (24h TTL)    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Payment Service                                            │
│  • Creates Payment document in PENDING state                │
│  • Enqueues payment ID for async processing                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Retry Queue (in-memory, 500ms poll)                        │
│  • Atomic PENDING → PROCESSING (findOneAndUpdate)           │
│    └─ Concurrent workers get null back — safe by design     │
│  • Calls Gateway Service                                    │
│  • On success → SUCCESS                                     │
│  • On failure → exponential backoff → re-enqueue           │
│  • After max retries → FAILED                               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Gateway Service                                            │
│  • Wraps call in Circuit Breaker                            │
│  • Simulates: success 70% / failure 20% / timeout 10%       │
│  • Random network delay 100ms–2s                            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Circuit Breaker (FSM)                                      │
│  CLOSED ──[5 failures]──► OPEN ──[30s]──► HALF_OPEN        │
│     ▲                                          │            │
│     └────────────[success]────────────────────┘            │
└─────────────────────────────────────────────────────────────┘

Async path:
POST /api/payments/:id/webhook
  └─► Webhook Service
        • Validates transition matrix
        • Rejects terminal→terminal overwrites
        • Deduplicates same-status callbacks
        • Optimistic lock on current status
```

---

## Features

| Requirement | Implementation |
|---|---|
| Payment lifecycle | `PENDING → PROCESSING → SUCCESS / FAILED` with full audit timestamps |
| Retry + backoff | Exponential: 1s → 2s → 4s, configurable max attempts and delays |
| Idempotency | `Idempotency-Key` header, MongoDB TTL record, 24h window |
| Concurrency control | Atomic `findOneAndUpdate` — only one worker claims a payment |
| External gateway sim | Configurable success/failure/timeout rates with random delays |
| Circuit breaker | 3-state FSM; auto-recovery; visible at `GET /health` |
| Webhook handling | State transition guard + optimistic locking; duplicates silently accepted |
| Rate limiting | Global IP limiter + per-customer create limiter |
| Observability | Structured JSON logs (Winston) with payment lifecycle events |
| API documentation | Swagger UI auto-generated from JSDoc — `GET /api/docs` |
| Testing | 35 tests across service, circuit breaker, webhook, gateway, concurrency |

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)

### Install & run

```bash
cd payment-gateway
npm install
cp .env.example .env      # edit MONGO_URI if not on localhost
npm run dev
```

| Endpoint | URL |
|---|---|
| API base | `http://localhost:3000/api/payments` |
| Swagger UI | `http://localhost:3000/api/docs` |
| OpenAPI JSON | `http://localhost:3000/api/docs.json` |
| Health check | `http://localhost:3000/health` |

### Build for production

```bash
npm run build
npm start
```

---

## Configuration

All values are read from environment variables. Copy `.env.example` to `.env` to get started.

### Core

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MONGO_URI` | `mongodb://localhost:27017/payment-gateway` | MongoDB connection string |
| `NODE_ENV` | `development` | `development` / `production` / `test` |

### Retry

| Variable | Default | Description |
|---|---|---|
| `RETRY_MAX_ATTEMPTS` | `3` | Max processing attempts before marking FAILED |
| `RETRY_BASE_DELAY_MS` | `1000` | Base backoff delay in ms |
| `RETRY_MAX_DELAY_MS` | `30000` | Max backoff cap in ms |

Backoff formula: `min(baseDelay × 2^(attempt−1), maxDelay)`

| Attempt | Delay |
|---|---|
| 1 | 1 s |
| 2 | 2 s |
| 3 | 4 s |

### Circuit Breaker

| Variable | Default | Description |
|---|---|---|
| `CB_FAILURE_THRESHOLD` | `5` | Consecutive failures before OPEN |
| `CB_RECOVERY_TIMEOUT_MS` | `30000` | Wait before probing in HALF_OPEN |
| `CB_HALF_OPEN_MAX_CALLS` | `2` | Max probe calls while HALF_OPEN |

### Rate Limiting

| Variable | Default | Description |
|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | `900000` | Window size (15 min) |
| `RATE_LIMIT_MAX` | `100` | Max requests per IP per window |

### Gateway Simulation

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_SUCCESS_RATE` | `0.7` | Probability of success (0–1) |
| `GATEWAY_TIMEOUT_RATE` | `0.1` | Probability of timeout (0–1) |
| `GATEWAY_MIN_DELAY_MS` | `100` | Minimum simulated latency |
| `GATEWAY_MAX_DELAY_MS` | `2000` | Maximum simulated latency |
| `GATEWAY_TIMEOUT_MS` | `5000` | Timeout threshold |

### Idempotency

| Variable | Default | Description |
|---|---|---|
| `IDEMPOTENCY_TTL_SECONDS` | `86400` | How long to cache responses (24h) |

---

## API Reference

### Create Payment

```
POST /api/payments
Idempotency-Key: <unique-string>   (required)
Content-Type: application/json
```

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | number | Yes | Positive decimal amount |
| `currency` | string | Yes | 3-letter ISO 4217 code (e.g. `USD`) |
| `customerId` | string | Yes | Your internal customer identifier |
| `description` | string | No | Human-readable description |
| `metadata` | object | No | Arbitrary key-value pairs |

**Example**

```json
{
  "amount": 99.99,
  "currency": "USD",
  "customerId": "cust_abc123",
  "description": "Premium subscription",
  "metadata": { "orderId": "ord_789" }
}
```

**Response** `201 Created`

```json
{
  "data": {
    "_id": "6650a1b2c3d4e5f6a7b8c9d0",
    "customerId": "cust_abc123",
    "amount": 99.99,
    "currency": "USD",
    "status": "PENDING",
    "retryCount": 0,
    "maxRetries": 3,
    "webhookReceived": false,
    "createdAt": "2026-05-20T10:00:00.000Z",
    "updatedAt": "2026-05-20T10:00:00.000Z"
  }
}
```

**Error responses**

| Code | Reason |
|---|---|
| `400` | Missing `Idempotency-Key`, invalid amount/currency/customerId |
| `429` | Rate limit exceeded |

---

### Get Payment

```
GET /api/payments/:id
```

**Response** `200 OK`

```json
{
  "data": {
    "_id": "6650a1b2c3d4e5f6a7b8c9d0",
    "status": "SUCCESS",
    "transactionId": "txn_4f3e2d1c0b9a",
    "processedAt": "2026-05-20T10:00:02.341Z",
    ...
  }
}
```

| Code | Reason |
|---|---|
| `404` | Payment not found |
| `400` | Invalid MongoDB ObjectId format |

---

### List Payments

```
GET /api/payments?customerId=&status=&page=1&limit=20
```

| Query param | Type | Description |
|---|---|---|
| `customerId` | string | Filter by customer |
| `status` | string | `PENDING`, `PROCESSING`, `SUCCESS`, `FAILED` |
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Page size, max 100 (default: 20) |

**Response** `200 OK`

```json
{
  "data": [ ... ],
  "meta": { "total": 47, "page": 1, "limit": 20 }
}
```

---

### Retry Failed Payment

```
POST /api/payments/:id/retry
```

Resets a `FAILED` payment back to `PENDING` and re-queues it for processing with a fresh retry counter.

**Response** `200 OK` — updated payment object

| Code | Reason |
|---|---|
| `409` | Payment is not in `FAILED` state |
| `400` | Invalid ID |

---

### Receive Webhook Callback

```
POST /api/payments/:id/webhook
Content-Type: application/json
```

Used by the external gateway to push asynchronous status updates.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string | Yes | `SUCCESS` or `FAILED` |
| `transactionId` | string | Conditional | Required when `status` is `SUCCESS` |
| `timestamp` | string | No | ISO 8601 datetime (defaults to now) |

**Example**

```json
{
  "status": "SUCCESS",
  "transactionId": "txn_4f3e2d1c0b9a",
  "timestamp": "2026-05-20T10:00:02.000Z"
}
```

**Response** `200 OK`

```json
{
  "received": true,
  "accepted": true
}
```

When a callback is rejected (e.g. invalid transition), `accepted` is `false` and a `reason` is included — the HTTP status is still `200` so the gateway does not retry.

| Code | Reason |
|---|---|
| `400` | Missing `status` field or invalid status value |
| `404` | Payment not found |

---

### Health Check

```
GET /health
```

```json
{
  "status": "ok",
  "circuitBreaker": {
    "state": "CLOSED",
    "failureCount": 0,
    "lastFailureTime": 0
  },
  "queue": { "size": 2 },
  "timestamp": "2026-05-20T10:00:00.000Z"
}
```

---

## Payment States

```
                  ┌─────────┐
   POST /payments │ PENDING │ ──────────────────────┐
                  └────┬────┘                       │
                       │ Queue picks up              │ Webhook: FAILED
                       ▼                            │
                ┌────────────┐                      │
                │ PROCESSING │                      │
                └─────┬──────┘                      │
                      │                             │
           ┌──────────┴──────────┐                  │
    success│               fail  │                  │
           ▼                     ▼                  │
       ┌─────────┐         ┌────────┐               │
       │ SUCCESS │         │ FAILED │ ◄─────────────┘
       └─────────┘         └───┬────┘
          (terminal)           │ POST /:id/retry
                               ▼
                          ┌─────────┐
                          │ PENDING │  (retryCount reset to 0)
                          └─────────┘
```

**Terminal states** (`SUCCESS`, `FAILED`) cannot be overwritten by further webhooks or queue processing.

---

## Design Decisions

### Idempotency

The `Idempotency-Key` header is mandatory on `POST /api/payments`. The first response is serialised into a MongoDB document with a 24-hour TTL index. Any repeated request with the same key returns the original HTTP status and body without touching the payment or queue.

### Concurrency control

The retry queue uses a MongoDB atomic `findOneAndUpdate({ status: 'PENDING' } → { status: 'PROCESSING' })`. Two workers racing on the same payment ID can only produce one winner — the loser receives `null` and exits. This removes the need for distributed locks.

### Circuit breaker

The gateway circuit breaker is a three-state FSM:

- **CLOSED** — normal operation; failures increment a counter
- **OPEN** — fast-fail after `CB_FAILURE_THRESHOLD` failures; no gateway calls made
- **HALF_OPEN** — after `CB_RECOVERY_TIMEOUT_MS`, allows up to `CB_HALF_OPEN_MAX_CALLS` probe calls; success closes the circuit, failure re-opens it

The breaker state is visible in the health endpoint and resets correctly across restarts because it is application-state (not persisted).

### Webhook conflict resolution

Incoming webhooks are validated against a transition matrix:

| Current state | Allowed webhook targets |
|---|---|
| `PENDING` | `SUCCESS`, `FAILED` |
| `PROCESSING` | `SUCCESS`, `FAILED` |
| `SUCCESS` | *(none — ignored)* |
| `FAILED` | *(none — ignored)* |

Duplicate same-state webhooks are accepted idempotently. Conflicting webhooks (e.g. `SUCCESS → FAILED`) are silently dropped and `accepted: false` is returned — the gateway receives a `200` so it does not retry.

### Retry queue

The in-memory queue polls every 500ms with `.unref()` on the timer so it does not block process exit. For production scale, this would be replaced by Redis + Bull (or a managed queue), but the processing logic in `retry.queue.ts` is intentionally queue-agnostic — the `processJob` function only reads from MongoDB, so swapping transports requires no changes to business logic.

---

## Running Tests

```bash
npm test                    # run all tests + coverage report
npm run test:watch          # interactive watch mode
```

### Test coverage

```
All files  |  97.98% stmts  |  68.91% branches  |  95% funcs  |  97.94% lines
```

### What is tested

| Test file | Covers |
|---|---|
| `payment.service.test.ts` | Create, get, list, retry — full CRUD lifecycle |
| `circuit-breaker.test.ts` | All state transitions (CLOSED/OPEN/HALF_OPEN), fast-fail, recovery |
| `webhook.service.test.ts` | Valid transitions, duplicates, conflicts, optimistic lock, timestamp storage |
| `gateway.service.test.ts` | Success path, failure path, timeout path, circuit breaker integration |
| `retry.queue.test.ts` | Exponential backoff maths, atomic concurrency guard |

---

## Project Structure

```
payment-gateway/
├── src/
│   ├── config/
│   │   └── index.ts               # All env-var config in one place
│   ├── models/
│   │   ├── payment.model.ts       # Payment schema + indexes
│   │   └── idempotency.model.ts   # Idempotency key store with TTL
│   ├── services/
│   │   ├── payment.service.ts     # Core CRUD + orchestration
│   │   ├── gateway.service.ts     # External gateway simulation
│   │   ├── circuit-breaker.service.ts  # FSM circuit breaker
│   │   └── webhook.service.ts     # Async callback handler
│   ├── queues/
│   │   └── retry.queue.ts         # In-memory queue + exponential backoff
│   ├── middleware/
│   │   ├── idempotency.middleware.ts   # Request deduplication
│   │   └── rate-limiter.ts            # express-rate-limit config
│   ├── controllers/
│   │   └── payment.controller.ts  # HTTP request/response layer
│   ├── routes/
│   │   └── payment.routes.ts      # Route definitions + Swagger JSDoc
│   ├── types/
│   │   └── index.ts               # Shared enums and interfaces
│   ├── utils/
│   │   └── logger.ts              # Winston structured logger
│   └── app.ts                     # Express app + server bootstrap
├── tests/
│   ├── setup.ts                   # MongoDB Memory Server helpers
│   ├── payment.service.test.ts
│   ├── circuit-breaker.test.ts
│   ├── webhook.service.test.ts
│   ├── gateway.service.test.ts
│   └── retry.queue.test.ts
├── .env.example
├── jest.config.ts
├── tsconfig.json
└── package.json
```
