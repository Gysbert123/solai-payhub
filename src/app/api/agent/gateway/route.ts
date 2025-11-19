import { NextRequest, NextResponse } from 'next/server';
import { encodeURL, findReference, FindReferenceError } from '@solana/pay';
import BigNumber from 'bignumber.js';
import { Connection, PublicKey, SystemProgram, Keypair } from '@solana/web3.js';
import {
  createGrokGatewayRequest,
  getGrokGatewayRequestByReference,
  confirmGrokGatewayPayment,
  markGrokGatewayDelivered,
} from '@/lib/db';

const PROJECT_WALLET = process.env.NEXT_PUBLIC_PROJECT_WALLET;
const GROK_API_KEY = process.env.GROK_API_KEY;
const SOLANA_ENDPOINT = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const DEFAULT_RAKE_PERCENTAGE = Number(process.env.GROK_RAKE_PERCENTAGE ?? '60');

// Dynamic pricing config (based on xAI posted rates)
const INPUT_RATE_PER_MTOK_USD = Number(process.env.GROK_INPUT_RATE_PER_MTOK_USD ?? '5'); // $5 / 1M prompt tokens
const OUTPUT_RATE_PER_MTOK_USD = Number(process.env.GROK_OUTPUT_RATE_PER_MTOK_USD ?? '15'); // $15 / 1M completion tokens
const OUTPUT_TOKEN_RATIO = Number(process.env.GROK_EXPECTED_OUTPUT_RATIO ?? '0.6'); // expected completion tokens relative to prompt tokens
const MIN_PRICE_SOL = Number(process.env.GROK_MIN_PRICE_SOL ?? '0.0005');
const MAX_PRICE_SOL = Number(process.env.GROK_MAX_PRICE_SOL ?? '0.01');
const PRICE_RAKE_MULTIPLIER = Number(process.env.GROK_PRICE_RAKE_MULTIPLIER ?? '1.6'); // 60% margin default
const SOL_PRICE_FALLBACK_USD = Number(process.env.GROK_SOL_PRICE_USD ?? '150');
const SOL_PRICE_CACHE_MS = Number(process.env.GROK_SOL_PRICE_CACHE_MS ?? '300000');
const SOL_PRICE_API_URL =
  process.env.GROK_SOL_PRICE_API_URL ??
  'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';

let cachedSolPrice: { value: number; expiresAt: number } | null = null;

function sanitizeString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function buildPhantomUrl(paymentUrl: string) {
  return `https://phantom.app/ul/v1/pay?link=${encodeURIComponent(paymentUrl)}`;
}

async function getSolPriceUsd(): Promise<number> {
  const now = Date.now();
  if (cachedSolPrice && cachedSolPrice.expiresAt > now && Number.isFinite(cachedSolPrice.value)) {
    return cachedSolPrice.value;
  }

  try {
    const res = await fetch(SOL_PRICE_API_URL, { next: { revalidate: 0 } });
    if (!res.ok) {
      throw new Error(`price request failed: ${res.status}`);
    }
    const data = await res.json();
    const maybe = data?.solana?.usd ?? data?.market_data?.current_price?.usd;
    const parsed = Number(maybe);
    if (!parsed || !Number.isFinite(parsed) || parsed <= 0) {
      throw new Error('invalid price response');
    }
    cachedSolPrice = {
      value: parsed,
      expiresAt: now + SOL_PRICE_CACHE_MS,
    };
    return parsed;
  } catch (err) {
    console.warn('[Grok Gateway] Falling back to static SOL price', err);
    cachedSolPrice = {
      value: SOL_PRICE_FALLBACK_USD,
      expiresAt: now + SOL_PRICE_CACHE_MS,
    };
    return SOL_PRICE_FALLBACK_USD;
  }
}

function estimateTokenCount(text: string) {
  if (!text) return 1;
  return Math.max(1, Math.ceil(text.length / 4));
}

function calculateDynamicPrice(prompt: string, solPriceUsd: number) {
  const promptTokens = estimateTokenCount(prompt);
  const expectedOutputTokens = Math.max(1, Math.ceil(promptTokens * OUTPUT_TOKEN_RATIO));

  const inputCostUsd = (promptTokens / 1_000_000) * INPUT_RATE_PER_MTOK_USD;
  const outputCostUsd = (expectedOutputTokens / 1_000_000) * OUTPUT_RATE_PER_MTOK_USD;
  const baseUsd = (inputCostUsd + outputCostUsd) * PRICE_RAKE_MULTIPLIER;

  let solAmount = baseUsd / (solPriceUsd || SOL_PRICE_FALLBACK_USD);
  if (!Number.isFinite(solAmount) || solAmount <= 0) {
    solAmount = MIN_PRICE_SOL;
  }

  solAmount = Math.min(MAX_PRICE_SOL, Math.max(MIN_PRICE_SOL, solAmount));

  return new BigNumber(solAmount).decimalPlaces(9, BigNumber.ROUND_UP);
}

async function assertSystemTransfer(
  connection: Connection,
  signature: string,
  recipient: PublicKey,
  amount: BigNumber,
  reference: PublicKey
) {
  const tx = await connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });

  if (!tx || !tx.meta) {
    throw new Error('transaction not found');
  }

  const expectedLamports = amount.multipliedBy(1_000_000_000);

  const message = tx.transaction.message;
  const accountKeys: PublicKey[] = [];
  const instructions: {
    programId: PublicKey;
    keys: { pubkey: PublicKey }[];
  }[] = [];

  if ('instructions' in message) {
    // Legacy transaction
    message.accountKeys.forEach((key) => accountKeys.push(key));
    message.instructions.forEach((ix) => {
      const programId = message.accountKeys[ix.programIdIndex]!;
      const keys = ix.accounts.map((index) => ({
        pubkey: message.accountKeys[index]!,
      }));
      instructions.push({ programId, keys });
    });
  } else {
    // Versioned transaction (v0 and beyond)
    const accountKeysFromLookups = {
      writable:
        tx.meta.loadedAddresses?.writable.map((key) => new PublicKey(key)) ?? [],
      readonly:
        tx.meta.loadedAddresses?.readonly.map((key) => new PublicKey(key)) ?? [],
    };

    const lookupKeys = message.getAccountKeys({ accountKeysFromLookups });
    lookupKeys.staticAccountKeys.forEach((key) => accountKeys.push(key));
    const writableLookups = lookupKeys.accountKeysFromLookups?.writable ?? [];
    const readonlyLookups = lookupKeys.accountKeysFromLookups?.readonly ?? [];
    writableLookups.forEach((key) => accountKeys.push(key));
    readonlyLookups.forEach((key) => accountKeys.push(key));

    message.compiledInstructions.forEach((ix) => {
      const programId = accountKeys[ix.programIdIndex]!;
      const keys = ix.accountKeyIndexes.map((index) => ({
        pubkey: accountKeys[index]!,
      }));
      instructions.push({ programId, keys });
    });
  }

  const recipientIndex = accountKeys.findIndex((key) => key.equals(recipient));

  if (recipientIndex === -1) {
    throw new Error('recipient mismatch');
  }

  const transferIx = instructions.find(
    (ix) =>
      ix.programId.equals(SystemProgram.programId) &&
      ix.keys.length >= 2 &&
      ix.keys[1].pubkey.equals(recipient)
  );

  if (!transferIx) {
    throw new Error('system transfer not found');
  }

  const hasReference = transferIx.keys.some((key) => key.pubkey.equals(reference));
  if (!hasReference) {
    throw new Error('reference not found');
  }

  const postLamports = new BigNumber(tx.meta.postBalances[recipientIndex]);
  const preLamports = new BigNumber(tx.meta.preBalances[recipientIndex]);
  const deltaLamports = postLamports.minus(preLamports);

  if (deltaLamports.lt(expectedLamports)) {
    throw new Error('amount not transferred');
  }
}

async function callGrokAPI(prompt: string): Promise<{
  response: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}> {
  if (!GROK_API_KEY) {
    console.error('[Grok Gateway] GROK_API_KEY not configured');
    throw new Error('Grok API service not available');
  }

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'grok-beta',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Grok API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};

  const inputTokens = usage.prompt_tokens || 0;
  const outputTokens = usage.completion_tokens || 0;

  // Calculate cost based on xAI published rates
  const inputCost = (inputTokens / 1_000_000) * INPUT_RATE_PER_MTOK_USD;
  const outputCost = (outputTokens / 1_000_000) * OUTPUT_RATE_PER_MTOK_USD;
  const totalCost = inputCost + outputCost;

  return {
    response: content,
    inputTokens,
    outputTokens,
    costUsd: totalCost,
  };
}

function generateJupiterRecommendation(grokResponse: string): string | undefined {
  // Simple heuristic: if Grok mentions tokens, prices, or trading, suggest Jupiter
  const tradingKeywords = ['token', 'price', 'trade', 'swap', 'buy', 'sell', 'sol', 'usdc'];
  const lowerResponse = grokResponse.toLowerCase();
  
  if (tradingKeywords.some(keyword => lowerResponse.includes(keyword))) {
    return 'Consider checking Jupiter for best swap rates: https://jup.ag';
  }
  
  return undefined;
}

export async function POST(req: NextRequest) {
  if (!PROJECT_WALLET) {
    return NextResponse.json(
      { error: 'Project wallet not configured' },
      { status: 500 }
    );
  }

  if (!GROK_API_KEY) {
    return NextResponse.json(
      { error: 'Grok API service not configured' },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const reference = sanitizeString((body as any).reference, 64);
  const prompt = sanitizeString((body as any).prompt, 10000);
  const agentId = sanitizeString((body as any).agentId, 64) || 'anonymous';
  const agentWallet = sanitizeString((body as any).agentWallet, 64);

  // Confirmation path: reference provided, check payment
  if (reference && !prompt) {
    const request = await getGrokGatewayRequestByReference(reference);
    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (request.status === 'delivered' || request.status === 'confirmed') {
      return NextResponse.json(
        {
          status: 'delivered',
          response: request.grok_response,
          jupiterRecommendation: request.jupiter_recommendation,
          signature: request.tx_signature,
          costUsd: request.grok_cost_usd,
        },
        { status: 200 }
      );
    }

    if (request.status !== 'pending') {
      return NextResponse.json(
        { status: request.status, message: 'Request not pending' },
        { status: 409 }
      );
    }

    const connection = new Connection(SOLANA_ENDPOINT, 'confirmed');
    const solPriceUsd = await getSolPriceUsd();
    const referenceKey = new PublicKey(reference);

    try {
      const { signature } = await findReference(connection, referenceKey, {
        finality: 'confirmed',
      });

      const recipientKey = new PublicKey(PROJECT_WALLET);
      const expectedAmount = new BigNumber(
        request.payment_amount_sol ?? MIN_PRICE_SOL.toString()
      );
      await assertSystemTransfer(
        connection,
        signature,
        recipientKey,
        expectedAmount,
        referenceKey
      );

      // Call Grok API
      const grokResult = await callGrokAPI(request.prompt);
      const jupiterRec = generateJupiterRecommendation(grokResult.response);

      // Calculate rake (for logging)
      const paymentAmountUsd = expectedAmount.multipliedBy(solPriceUsd);
      const rakePercent = request.rake_percentage ?? DEFAULT_RAKE_PERCENTAGE;
      const rakeAmount = paymentAmountUsd.multipliedBy(rakePercent).dividedBy(100);
      const profit = rakeAmount.minus(grokResult.costUsd);

      console.log(`[Grok Gateway] Request ${request.id}:`);
      console.log(`  Revenue: $${paymentAmountUsd.toFixed(4)} (${expectedAmount.toFixed(4)} SOL)`);
      console.log(`  Grok Cost: $${grokResult.costUsd.toFixed(4)}`);
      console.log(`  Rake (${rakePercent}%): $${rakeAmount.toFixed(4)}`);
      console.log(`  Profit: $${profit.toFixed(4)}`);
      console.log(`  Tokens: ${grokResult.inputTokens} input + ${grokResult.outputTokens} output`);

      const updated = await confirmGrokGatewayPayment({
        reference,
        signature,
        grokCostUsd: grokResult.costUsd.toFixed(9),
        grokResponse: grokResult.response,
        jupiterRecommendation: jupiterRec,
      });

      if (!updated) {
        return NextResponse.json(
          { error: 'Failed to confirm payment' },
          { status: 500 }
        );
      }

      await markGrokGatewayDelivered(updated.id);

      return NextResponse.json(
        {
          status: 'delivered',
          response: grokResult.response,
          jupiterRecommendation: jupiterRec,
          signature,
          costUsd: grokResult.costUsd.toFixed(6),
          tokens: {
            input: grokResult.inputTokens,
            output: grokResult.outputTokens,
          },
        },
        {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    } catch (err) {
      if (err instanceof FindReferenceError) {
        return NextResponse.json({ status: 'pending' }, { status: 402 });
      }
      console.error('Grok gateway payment validation failed:', err);
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: err instanceof Error ? err.message : String(err),
        },
        { status: 422 }
      );
    }
  }

  // Initial request path: prompt provided, create payment request
  if (!prompt) {
    return NextResponse.json({ error: 'prompt required' }, { status: 400 });
  }

  if (!agentWallet) {
    return NextResponse.json({ error: 'agentWallet required' }, { status: 400 });
  }

  const solPriceUsd = await getSolPriceUsd();
  const paymentReference = Keypair.generate().publicKey.toBase58();
  const paymentAmount = calculateDynamicPrice(prompt, solPriceUsd);

  const request = await createGrokGatewayRequest({
    agentId,
    agentWallet,
    prompt,
    reference: paymentReference,
    paymentAmountSol: paymentAmount.toFixed(9),
    rakePercentage: DEFAULT_RAKE_PERCENTAGE,
  });

  if (!request) {
    return NextResponse.json(
      { error: 'Service unavailable' },
      { status: 503 }
    );
  }

  const paymentUrl = encodeURL({
    recipient: new PublicKey(PROJECT_WALLET),
    amount: paymentAmount,
    reference: new PublicKey(paymentReference),
    label: 'SolAI Grok Gateway',
    message: `AI Gateway request (${paymentAmount.toFixed(4)} SOL)`,
    memo: request.id,
  }).toString();

  return NextResponse.json(
    {
      requestId: request.id,
      reference: paymentReference,
      amount: paymentAmount.toFixed(4),
      recipient: PROJECT_WALLET,
      paymentUrl,
      phantomUrl: buildPhantomUrl(paymentUrl),
    },
    {
      status: 402,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}

export const maxDuration = 60; // Grok API can take time

