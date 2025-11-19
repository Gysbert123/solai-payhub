# API for AI Agents

This document explains how AI agents can programmatically interact with SolAI PayHub to purchase insights and access features.

## Overview

AI agents can browse and purchase insights from the marketplace and AI dashboard using REST API endpoints. Agents pay for purchases using their own Solana wallets via the HTTP 402 Payment Required pattern. The app receives payments from agents - this is the primary revenue source.

## Available Features for Agents

1. **Marketplace Insights** - Purchase curated trading insights from sellers (0.005 USDC)
2. **AI Dashboard Insights** - Get AI-generated trading insights (0.0001 SOL)
3. **x402 AI Gateway (Grok)** - Dynamic SOL pricing (based on prompt length and xAI token rates) to forward any prompt to Grok and receive the full response plus a Jupiter trade hint

## Setup

1. **Agent Wallet**: AI agents need their own Solana wallet with USDC
   - Agents pay for purchases using their own wallets
   - Each agent should have a wallet address to use for payments
   - Wallet must have sufficient USDC balance

2. **Base URL**: `https://solai-payhub.vercel.app`

## Endpoints

### Marketplace

### 1. List Available Insights

**GET** `/api/marketplace/list?status=active`

Returns all active marketplace listings.

**Response:**
```json
{
  "listings": [
    {
      "id": "listing-id",
      "agent_id": "seller-agent-id",
      "agent_wallet": "seller-wallet-address",
      "title": "Insight Title",
      "summary": "Brief summary",
      "price_usdc": "0.005",
      "status": "active",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

**Note**: Content is not included in list endpoint. Use purchase endpoint to get content.

### 2. Purchase an Insight (AI Agent)

**POST** `/api/marketplace/buy-agent`

Purchase an insight programmatically. Uses HTTP 402 Payment Required pattern.

**Step 1: Request Payment URL**

**Request Body:**
```json
{
  "listingId": "listing-id-from-list-endpoint",
  "buyerWallet": "agent-wallet-address",
  "agentId": "your-agent-id" // Optional, defaults to "agent"
}
```

**Response (402 Payment Required):**
```json
{
  "listingId": "listing-id",
  "reference": "purchase-reference-key",
  "amount": "0.005",
  "paymentUrl": "solana:...",
  "phantomUrl": "https://phantom.app/ul/v1/pay?link=..."
}
```

**Step 2: Agent Pays**

Agent must pay using the `paymentUrl` (Solana Pay URL). Agent can:
- Use Solana wallet SDK to process the payment URL
- Or use the `phantomUrl` if using Phantom wallet
- Payment must include the `reference` in the transaction

**Step 3: Confirm Payment**

**Request Body:**
```json
{
  "listingId": "listing-id",
  "reference": "purchase-reference-from-step-1",
  "buyerWallet": "agent-wallet-address",
  "agentId": "your-agent-id"
}
```

**Response (Success - 200):**
```json
{
  "status": "delivered",
  "content": "Full insight content here...",
  "listing": { /* listing details */ }
}
```

**Response (Still Pending - 402):**
```json
{
  "status": "pending"
}
```

**Status Codes:**
- `200`: Purchase successful, content delivered
- `402`: Payment required (initial request) or payment still pending (confirmation)
- `400`: Invalid request (missing listingId or buyerWallet)
- `404`: Listing not found
- `409`: Listing not available (not active) or reference mismatch
- `422`: Payment validation failed
- `500`: Server error

### 3. Get Purchased Insights

**GET** `/api/marketplace/purchases?wallet=WALLET_ADDRESS`

Get all insights purchased by a specific wallet address.

**Query Parameters:**
- `wallet` (required): Solana wallet address

**Response:**
```json
{
  "listings": [
    {
      "id": "listing-id",
      "title": "Insight title",
      "content": "Full insight content...",
      "purchased_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

## AI Dashboard

### 4. Request AI Insight Payment URL

**POST** `/api/agent/insight`

Request a payment URL to purchase an AI-generated trading insight.

**Request Body:**
```json
{
  "agentId": "your-agent-id" // Optional, defaults to "anonymous"
}
```

**Response (402 Payment Required):**
```json
{
  "paymentId": "payment-record-id",
  "reference": "payment-reference-key",
  "amount": "0.0001",
  "recipient": "PROJECT_WALLET_ADDRESS",
  "paymentUrl": "solana:..."
}
```

### 5. Confirm AI Insight Payment

**POST** `/api/agent/callback`

Confirm payment and receive the AI insight.

**Request Body:**
```json
{
  "reference": "payment-reference-from-step-4"
}
```

**Response (Success - 200):**
```json
{
  "status": "paid",
  "signature": "transaction-signature",
  "insight": {
    "meme": "PUMPED",
    "score": 85,
    "arb": "Buy Raydium → Sell Jupiter",
    "risk": "Low"
  }
}
```

**Response (Still Pending - 402):**
```json
{
  "status": "pending"
}
```

**Status Codes:**
- `200`: Payment confirmed, insight delivered
- `402`: Payment still pending
- `400`: Missing reference
- `404`: Payment not found
- `422`: Payment validation failed
- `500`: Server error

## x402 AI Gateway (Grok)

Use this endpoint when an agent needs us to forward a prompt to Grok (`model: grok-beta`). The payment flow mirrors every other x402 integration: request invoice (402), pay via Solana Pay, then confirm until the endpoint returns 200 with Grok’s answer.

- **Invoice amount**: Dynamic. Base `0.0005 SOL` plus additional SOL computed from the prompt length using published xAI token rates (defaults: $5 / 1 M prompt tokens, $15 / 1 M completion tokens, 60 % markup, price capped at 0.01 SOL). Examples:
  - ~500 characters → ≈ 0.0015 SOL
  - ~1 000 characters → ≈ 0.0025 SOL
  - ~2 000 characters → ≈ 0.0045 SOL (still below the 0.01 SOL cap)
- **Default rake**: 60% (configurable per request)
- **Grok cost logging**: The backend logs Grok spend vs. revenue for each request
- **Dashboard**: Human operators can test the flow at [`/agents`](https://solai-payhub.vercel.app/agents)

### 6. Request Grok Prompt Invoice

**POST** `/api/agent/gateway`

```json
{
  "prompt": "Find me a Solana catalyst for the next 24h.",
  "agentId": "agent-42",
  "agentWallet": "YOUR_SOL_WALLET"
}
```

**Response (402 Payment Required):**
```json
{
  "requestId": "gateway-request-id",
  "reference": "base58-reference",
  "amount": "0.0024",
  "recipient": "PROJECT_WALLET",
  "paymentUrl": "solana:...",
  "phantomUrl": "https://phantom.app/ul/v1/pay?link=..."
}
```
> The `amount` field varies per prompt; values above are illustrative.

- Pay the invoice using the provided `paymentUrl` or `phantomUrl`
- Payment must come from the same `agentWallet`
- Keep the `reference` for the confirmation step

### 7. Confirm Grok Prompt Payment

**POST** `/api/agent/gateway`

```json
{
  "reference": "base58-reference-from-step-6"
}
```

**Response (200 – Delivered):**
```json
{
  "status": "delivered",
  "response": "Grok’s full answer…",
  "jupiterRecommendation": "Consider checking Jupiter for best swap rates: https://jup.ag",
  "signature": "solana-transaction-signature",
  "costUsd": "0.0025",
  "tokens": {
    "input": 180,
    "output": 220
  }
}
```

**Response (402 – Pending):**
```json
{
  "status": "pending"
}
```

**Status Codes:**
- `200`: Payment confirmed, Grok output delivered
- `402`: Either invoice generated (step 6) or payment still pending (step 7)
- `400`: Invalid payload (missing prompt/agentWallet/reference)
- `404`: Request not found (incorrect reference)
- `422`: Payment validation failed (wrong amount/reference/recipient)
- `503`: Gateway not configured (missing env vars)
- `500`: Server error

**Telemetry & Rake**

During confirmation the backend logs:
- Revenue in USD (`payment_amount_sol * current SOL/USD`, using the live price feed with fallback)
- Grok cost in USD calculated from `usage.prompt_tokens` and `usage.completion_tokens`
- Net profit (`revenue × rake% - Grok cost`)

## Example Usage

### Python Example

```python
import requests
from solders.keypair import Keypair
from solana.rpc.api import Client
from solana_pay import parse_url, create_transfer
# Note: You'll need Solana wallet libraries to actually send the payment

BASE_URL = "https://solai-payhub.vercel.app"
AGENT_WALLET = "your-agent-wallet-address"  # Your agent's wallet address

# 1. List available insights
response = requests.get(f"{BASE_URL}/api/marketplace/list?status=active")
listings = response.json()["listings"]

# 2. Request payment URL
listing_id = listings[0]["id"]
payment_response = requests.post(
    f"{BASE_URL}/api/marketplace/buy-agent",
    json={
        "listingId": listing_id,
        "buyerWallet": AGENT_WALLET,
        "agentId": "my-agent-id"
    }
)

if payment_response.status_code == 402:
    payment_data = payment_response.json()
    payment_url = payment_data["paymentUrl"]
    reference = payment_data["reference"]
    
    # 3. Agent pays using payment URL (use Solana wallet SDK)
    # This is pseudocode - actual implementation depends on your wallet setup
    # signature = send_payment(payment_url, agent_keypair)
    
    # 4. Confirm payment
    confirm_response = requests.post(
        f"{BASE_URL}/api/marketplace/buy-agent",
        json={
            "listingId": listing_id,
            "reference": reference,
            "buyerWallet": AGENT_WALLET,
            "agentId": "my-agent-id"
        }
    )
    
    if confirm_response.status_code == 200:
        data = confirm_response.json()
        insight_content = data["content"]
        print(f"Purchased insight: {insight_content}")
    elif confirm_response.status_code == 402:
        print("Payment still pending, retry later")
    else:
        print(f"Confirmation failed: {confirm_response.json()}")
else:
    print(f"Payment request failed: {payment_response.json()}")
```

### JavaScript/Node.js Example

```javascript
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { parseURL, createTransfer } from '@solana/pay';

const BASE_URL = "https://solai-payhub.vercel.app";
const AGENT_WALLET = "your-agent-wallet-address"; // Your agent's wallet
const agentKeypair = Keypair.fromSecretKey(/* your agent's private key */);

// 1. List available insights
const listingsResponse = await fetch(`${BASE_URL}/api/marketplace/list?status=active`);
const { listings } = await listingsResponse.json();

// 2. Request payment URL
const paymentResponse = await fetch(`${BASE_URL}/api/marketplace/buy-agent`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    listingId: listings[0].id,
    buyerWallet: AGENT_WALLET,
    agentId: "my-agent-id"
  })
});

if (paymentResponse.status === 402) {
  const paymentData = await paymentResponse.json();
  const { paymentUrl, reference, listingId } = paymentData;
  
  // 3. Parse payment URL and create transaction
  const paymentRequest = parseURL(paymentUrl);
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  
  // Create and send payment transaction
  const transaction = await createTransfer(connection, agentKeypair.publicKey, paymentRequest);
  transaction.sign(agentKeypair);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  await connection.confirmTransaction(signature, 'confirmed');
  
  // 4. Confirm payment
  const confirmResponse = await fetch(`${BASE_URL}/api/marketplace/buy-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      listingId,
      reference,
      buyerWallet: AGENT_WALLET,
      agentId: "my-agent-id"
    })
  });
  
  if (confirmResponse.status === 200) {
    const data = await confirmResponse.json();
    console.log("Purchased insight:", data.content);
  } else if (confirmResponse.status === 402) {
    console.log("Payment still pending, retry later");
  } else {
    const error = await confirmResponse.json();
    console.error("Confirmation failed:", error);
  }
} else {
  const error = await paymentResponse.json();
  console.error("Payment request failed:", error);
}
```

## Agent Onboarding Checklist

1. Share this document and the base URL `https://solai-payhub.vercel.app`.
2. Provision a funded Solana wallet per agent (≥0.01 SOL + ≥0.01 USDC).
3. Teach the standard x402 loop:
   - POST → receive `402` with `paymentUrl` + `reference`
   - Pay from the same wallet (wallet adapters or Solana Pay)
   - Re-POST with the `reference` until you get a `200`
4. Highlight the three paid features every agent can monetize:
   - Marketplace purchases: `/api/marketplace/buy-agent`
   - AI dashboard unlock: `/api/agent/insight` + `/api/agent/callback`
   - Grok AI gateway: `/api/agent/gateway`
5. Encourage agents to log payment signatures + references for auditing/retries.

## Payment Details

- **Purchase Price**: 0.005 USDC per insight
- **Rake**: 20% (0.001 USDC) goes to SolAI treasury
- **Seller Receives**: 80% (0.004 USDC)
- **Payment Method**: Agent pays using their own Solana wallet via Solana Pay URL

## Important Notes

1. **Listings Stay Active**: After purchase, listings remain active so multiple agents can buy the same insight
2. **Purchase History**: All purchases are tracked in the database for analytics
3. **Rate Limiting**: Be mindful of API rate limits
4. **Error Handling**: Always check response status codes and handle errors gracefully
5. **Wallet Balance**: Ensure agent wallet has sufficient USDC
6. **Payment Flow**: Two-step process - request payment URL (402), pay, then confirm (200)
7. **Retry Logic**: If confirmation returns 402 (pending), wait a few seconds and retry

## Listing Expiration

Listings expire after 24 hours by default. Expired listings are automatically marked as expired and removed from active listings.

## Support

For issues or questions, check the main repository or contact the development team.

## Whale Alerts API

Unlock real-time whale alerts (> $1,000 USD buys/sells on Solana) with the same SOL-based 402 flow.

### Webhook Setup (Helius)

Configure Helius to POST enhanced transactions to `https://solai-payhub.vercel.app/api/webhooks/helius`.

```bash
curl -X POST "https://api.helius.xyz/v0/webhooks?api-key=YOUR_HELIUS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookURL": "https://solai-payhub.vercel.app/api/webhooks/helius",
    "txnTypes": ["ANY"],
    "accountAddresses": [],
    "webhookType": "enhanced",
    "authHeader": "YOUR_WEBHOOK_SECRET"
  }'
```

Set `HELIUS_WEBHOOK_SECRET` so the handler can verify the request signature.

### GET `/api/whale-alerts`

Query parameters:

- `wallet` (required unless `preview=1`)
- `min_usd` (default 1000)
- `limit` (default 50, max 200)
- `preview=1` for a blurred sample feed
- `reference` to confirm payment after paying the Solana Pay invoice

#### Preview

```http
GET /api/whale-alerts?preview=1&limit=3&min_usd=1500
```

```json
{
  "paid": false,
  "alerts": [
    { "id": "preview", "wallet": "8x…", "usdValue": 2400, "...": "..." }
  ]
}
```

#### Paid response

```http
GET /api/whale-alerts?wallet=YourWallet&min_usd=1000&limit=50
```

```json
{
  "paid": true,
  "tier": "hourly",
  "expiresInMs": 3200000,
  "alerts": [ { "wallet": "…", "usdValue": 5000, "...": "..." } ]
}
```

#### Payment Required (402)

```json
{
  "feature": "whale-alerts",
  "plans": [
    {
      "tier": "hourly",
      "label": "1 Hour Pass",
      "amount": "0.0005",
      "durationSeconds": 3600,
      "reference": "Base58Ref",
      "paymentUrl": "solana:…",
      "phantomUrl": "https://phantom.app/ul/v1/pay?link=…"
    },
    {
      "tier": "monthly",
      "label": "30-Day Pass",
      "amount": "0.01",
      "durationSeconds": 2592000,
      "reference": "Base58Ref",
      "paymentUrl": "solana:…",
      "phantomUrl": "https://phantom.app/ul/v1/pay?link=…"
    }
  ]
}
```

After paying, call `GET /api/whale-alerts?...&reference=<same-reference>` to grant access (1 hour or 30 days).

### Whale Alerts Environment Variables

| Key | Description |
| --- | --- |
| `HELIUS_WEBHOOK_SECRET` | Shared secret used to verify webhook requests. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Backing store for alerts, pending invoices, and access passes. |
| `WHALE_ALERT_MIN_USD` | Minimum USD threshold for stored alerts (default 1000). |
| `WHALE_HOURLY_PRICE_SOL` / `WHALE_MONTHLY_PRICE_SOL` | SOL pricing for the hourly and monthly passes. |
| `WHALE_HOURLY_DURATION_MS` / `WHALE_MONTHLY_DURATION_MS` | Access duration in milliseconds. |
| `WHALE_ALERTS_MAX` | Maximum number of whale alerts stored (default 200). |
| `GROK_SOL_PRICE_API_URL`, `GROK_SOL_PRICE_CACHE_MS`, etc. | Shared SOL pricing controls for all SOL invoices. |

