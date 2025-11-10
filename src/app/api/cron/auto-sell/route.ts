import { NextResponse } from 'next/server';
import { getOpenTrades, markTradeAsSold } from '@/lib/db';
import {
  Connection,
  Keypair,
  Transaction,
} from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const BIRDEYE_PRICE_API = 'https://public-api.birdeye.so/public/price?address=';
const SLIPPAGE_BPS = 50;
const PROFIT_THRESHOLD = 5;

const jupiter = createJupiterApiClient();

function loadTraderKeypair(): Keypair {
  const secret = process.env.TRADER_PRIVATE_KEY;
  if (!secret) {
    throw new Error('Missing TRADER_PRIVATE_KEY');
  }

  try {
    const bytes = JSON.parse(secret);
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch (err) {
    throw new Error('Failed to parse TRADER_PRIVATE_KEY');
  }
}

function createConnection(): Connection {
  const endpoint = process.env.SOLANA_RPC_URL;
  if (!endpoint) {
    throw new Error('Missing SOLANA_RPC_URL environment variable.');
  }
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    throw new Error('SOLANA_RPC_URL must start with http:// or https://');
  }
  return new Connection(endpoint, 'confirmed');
}

async function fetchPrice(mint: string): Promise<number | null> {
  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey) {
    console.error('Missing BIRDEYE_API_KEY.');
    return null;
  }

  try {
    const res = await fetch(`${BIRDEYE_PRICE_API}${mint}`, {
      headers: {
        accept: 'application/json',
        'X-API-KEY': apiKey,
      },
    });

    if (!res.ok) {
      console.error('Birdeye price error', await res.text());
      return null;
    }

    const data = await res.json();
    return data?.data?.value ?? data?.data?.price ?? null;
  } catch (error) {
    console.error('Birdeye price fetch failed:', error);
    return null;
  }
}

async function executeSwap(
  connection: Connection,
  trader: Keypair,
  inputMint: string,
  amountLamports: number
) {
  try {
    const quote = await jupiter.quoteGet({
      inputMint,
      outputMint: SOL_MINT,
      amount: amountLamports,
      slippageBps: SLIPPAGE_BPS,
      asLegacyTransaction: true,
    });

    const swap = await jupiter.swapPost({
      swapRequest: {
        quoteResponse: quote,
        userPublicKey: trader.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        asLegacyTransaction: true,
      },
    });

    const transaction = Transaction.from(Buffer.from(swap.swapTransaction, 'base64'));
    transaction.sign(trader);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,
    });
    await connection.confirmTransaction(signature, 'confirmed');

    return signature;
  } catch (error) {
    console.error('Jupiter swap failed:', error);
    return null;
  }
}

async function sendSellAlert(tokenMint: string, profit: number, signature: string) {
  const token = process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const message = `Sold ${tokenMint} +${profit.toFixed(2)}% | TX: https://solscan.io/tx/${signature}`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });
  } catch (error) {
    console.error('Telegram alert failed:', error);
  }
}

export async function GET() {
  let connection: Connection;
  let trader: Keypair;

  try {
    connection = createConnection();
    trader = loadTraderKeypair();
  } catch (error) {
    console.error('Auto-sell setup failed:', error);
    return NextResponse.json({ error: 'Auto-sell misconfigured' }, { status: 500 });
  }

  const trades = await getOpenTrades();
  let soldCount = 0;

  for (const trade of trades) {
    try {
      const entryPrice = Number(trade.entry_sol);
      const size = Number(trade.buy_amount);
      if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(size) || size <= 0) {
        continue;
      }

      const price = await fetchPrice(trade.token_mint);
      if (!price) continue;

      const profitPct = ((price - entryPrice) / entryPrice) * 100;
      if (profitPct < PROFIT_THRESHOLD) continue;

      const lamports = Math.floor(size * 1e9);
      if (!Number.isFinite(lamports) || lamports <= 0) continue;

      const signature = await executeSwap(connection, trader, trade.token_mint, lamports);
      if (!signature) continue;

      await markTradeAsSold(trade.id, profitPct);
      await sendSellAlert(trade.token_mint, profitPct, signature);
      soldCount++;
    } catch (error) {
      console.error('Failed to process trade', trade.id, error);
    }
  }

  return NextResponse.json({ sold: soldCount });
}