# Testing Setup with x402test

## Overview

x402test is a testing infrastructure for x402 payment flows that allows:
- **Server Testing**: Test x402 endpoints with a fluent testing library
- **Client Testing**: Test AI agents/bots against a mock x402 server
- **Local Development**: Test payment flows without real transactions

## Why x402test is Perfect for SolAI PayHub

Your app has **3 x402 payment endpoints** that need testing:
1. `/api/marketplace/buy-agent` - Agent marketplace purchases (0.005 USDC)
2. `/api/agent/insight` - AI dashboard insights (0.0001 SOL)
3. `/api/marketplace/buy` - Regular marketplace purchases (0.005 USDC)

## Benefits

1. **No Real Payments**: Test payment flows locally without spending real SOL/USDC
2. **Agent Testing**: Test AI agent integrations without real wallet connections
3. **CI/CD Integration**: Automate payment flow testing in your pipeline
4. **Faster Development**: Iterate on payment logic without waiting for blockchain confirmations
5. **Edge Case Testing**: Test error scenarios, timeouts, and edge cases easily

## Implementation Options

### Option 1: Use x402test Mock Server (Recommended for Agent Testing)

Test your AI agent clients against a mock x402 server:

```bash
# Install x402test
npm install --save-dev @x402test/mock-server

# Run mock server
npx x402test-mock-server
```

Then point your agent clients to `http://localhost:4020` instead of production.

### Option 2: Use x402test Fluent Library (Recommended for Server Testing)

Test your x402 endpoints with a fluent testing library:

```bash
npm install --save-dev @x402test/testing
```

Create test files:
- `tests/marketplace-buy-agent.test.ts`
- `tests/agent-insight.test.ts`
- `tests/marketplace-buy.test.ts`

### Option 3: Hybrid Approach (Best for Full Coverage)

- Use mock server for agent client testing
- Use fluent library for server endpoint testing
- Use both in CI/CD pipeline

## Recommended Setup

### 1. Install Dependencies

```bash
npm install --save-dev @x402test/mock-server @x402test/testing
```

### 2. Create Test Configuration

Create `tests/x402test.config.ts`:

```typescript
export const x402testConfig = {
  baseUrl: process.env.X402TEST_BASE_URL || 'http://localhost:4020',
  endpoints: {
    marketplaceBuyAgent: '/api/marketplace/buy-agent',
    agentInsight: '/api/agent/insight',
    marketplaceBuy: '/api/marketplace/buy',
  },
  testWallet: process.env.TEST_WALLET || 'TestWallet123',
};
```

### 3. Example Test: Agent Marketplace Purchase

Create `tests/marketplace-buy-agent.test.ts`:

```typescript
import { x402test } from '@x402test/testing';
import { x402testConfig } from './x402test.config';

describe('Marketplace Buy Agent', () => {
  it('should return 402 with payment URL', async () => {
    const response = await x402test
      .post(x402testConfig.endpoints.marketplaceBuyAgent)
      .withBody({
        listingId: 'test-listing-id',
        buyerWallet: x402testConfig.testWallet,
        agentId: 'test-agent',
      })
      .expectStatus(402)
      .expectPaymentUrl()
      .expectReference();

    expect(response.body.paymentUrl).toContain('solana:');
    expect(response.body.reference).toBeDefined();
  });

  it('should confirm payment and deliver content', async () => {
    // First, get payment URL
    const paymentResponse = await x402test
      .post(x402testConfig.endpoints.marketplaceBuyAgent)
      .withBody({
        listingId: 'test-listing-id',
        buyerWallet: x402testConfig.testWallet,
        agentId: 'test-agent',
      })
      .expectStatus(402);

    // Simulate payment (x402test handles this)
    const confirmResponse = await x402test
      .post(x402testConfig.endpoints.marketplaceBuyAgent)
      .withBody({
        listingId: 'test-listing-id',
        reference: paymentResponse.body.reference,
        buyerWallet: x402testConfig.testWallet,
        agentId: 'test-agent',
      })
      .simulatePayment()
      .expectStatus(200)
      .expectContent();

    expect(confirmResponse.body.content).toBeDefined();
    expect(confirmResponse.body.status).toBe('delivered');
  });
});
```

### 4. Example Test: AI Dashboard Insight

Create `tests/agent-insight.test.ts`:

```typescript
import { x402test } from '@x402test/testing';
import { x402testConfig } from './x402test.config';

describe('Agent Insight', () => {
  it('should return 402 with payment URL for insight', async () => {
    const response = await x402test
      .post(x402testConfig.endpoints.agentInsight)
      .withBody({
        agentId: 'test-agent',
      })
      .expectStatus(402)
      .expectPaymentUrl();

    expect(response.body.paymentUrl).toContain('solana:');
    expect(response.body.amount).toBe('0.0001');
  });

  it('should deliver insight after payment', async () => {
    const paymentResponse = await x402test
      .post(x402testConfig.endpoints.agentInsight)
      .withBody({ agentId: 'test-agent' })
      .expectStatus(402);

    const confirmResponse = await x402test
      .post('/api/agent/callback')
      .withBody({
        reference: paymentResponse.body.reference,
      })
      .simulatePayment()
      .expectStatus(200);

    expect(confirmResponse.body.insight).toBeDefined();
    expect(confirmResponse.body.insight.meme).toBeDefined();
    expect(confirmResponse.body.insight.score).toBeGreaterThan(0);
  });
});
```

### 5. Add Test Scripts to package.json

```json
{
  "scripts": {
    "test": "jest",
    "test:x402": "jest tests/*.test.ts",
    "test:x402:watch": "jest --watch tests/*.test.ts",
    "x402test:server": "x402test-mock-server"
  }
}
```

## Integration with Your Current Setup

### Environment Variables

Add to `.env.local`:

```env
# x402test Configuration
X402TEST_BASE_URL=http://localhost:4020
TEST_WALLET=TestWallet123
NODE_ENV=test
```

### CI/CD Integration

Add to `.github/workflows/test.yml`:

```yaml
name: x402 Payment Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run x402test:server &
      - run: npm run test:x402
```

## Next Steps

1. **Visit**: https://x402test.testship.xyz/ to learn more
2. **Review**: The pitch deck for detailed features
3. **Install**: Start with the mock server for agent testing
4. **Test**: Create tests for your 3 payment endpoints
5. **Integrate**: Add to CI/CD pipeline

## Questions to Consider

1. Do you want to test locally first, or jump straight to CI/CD?
2. Should we create a test suite for all 3 endpoints?
3. Do you want to test agent integrations or just server endpoints?

Let me know and I can help set it up!

