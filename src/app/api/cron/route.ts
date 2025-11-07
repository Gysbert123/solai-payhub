import { NextResponse } from 'next/server';
import { getOpenTrades, markTradeAsSold } from '@/lib/db';
import { Connection } from '@solana/web3.js';

const connection = new Connection(process.env.SOLANA_RPC_URL!, 'confirmed');
const JUPITER_PRICE_API = 'https://price.jup.ag/v4/price?ids=';

async function getCurrentPrice(mint: string): Promise<number | null> {
  try {
    const res = await fetch(JUPITER_PRICE_API + mint, { next: { revalidate: 30 } });
    const data = await res.json();
    return data.data[mint]?.price ?? null;
  } catch {
    return null;
  }
}

async function executeSellViaJupiter(inputMint: string, amount: string) {
  try {
    const quoteRes = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=So11111111111111111111111111111111111111112&amount=${amount}&slippageBps=50`
    );
    const quote = await quoteRes.json();
    if (!quote || quote.error) return null;

    const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: process.env.WALLET_PUBLIC_KEY,
        wrapAndUnwrapSol: true,
      }),
    });
    const { swapTransaction } = await swapRes.json();
    const txBuf = Buffer.from(swapTransaction, 'base64');
    const sig = await connection.sendRawTransaction(txBuf, { skipPreflight: true });
    await connection.confirmTransaction(sig, 'processed');
    return sig;
  } catch {
    return null;
  }
}

export async function GET() {
  const trades = await getOpenTrades();
  let sold = 0;

  for (const trade of trades) {
    const currentPrice = await getCurrentPrice(trade.token_mint);
    if (!currentPrice) continue;

    const buyPrice = parseFloat(trade.entry_sol);
    const profitPct = ((currentPrice - buyPrice) / buyPrice) * 100;

    if (profitPct >= 5) {
      const amountLamports = BigInt(Math.floor(parseFloat(trade.buy_amount) * 1e9)).toString();
      const sig = await executeSellViaJupiter(trade.token_mint, amountLamports);
      if (sig) {
        await markTradeAsSold(trade.id, profitPct);
        sold++;
      }
    }
  }

  return NextResponse.json({
    message: 'Auto-sell ran (Hobby: daily 00:00 UTC)',
    checked: trades.length,
    sold,
    nextRun: '00:00 UTC',
    timestamp: new Date().toISOString(),
  });
}