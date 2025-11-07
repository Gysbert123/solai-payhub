import { db } from '@/lib/db';
import { trades } from '@/lib/schema';
import { NextRequest } from 'next/server';
import { getTokenBalance } from '@/lib/solana';

export async function POST(req: NextRequest) {
  const { wallet, tokenIn, tokenOut, amountIn } = await req.json();

  // Simulate buy (replace with Jupiter swap later)
  const txId = `simulated_${Date.now()}`;

  const [result] = await db.insert(trades).values({
    wallet,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut: amountIn * 1.0, // placeholder
    txId,
    status: 'bought',
    buyPrice: 1.0,
    targetSellPrice: 1.05,
    createdAt: new Date(),
  }).returning();

  // Start auto-sell monitor in background
  monitorSell(result.id);

  return Response.json({ success: true, tradeId: result.id, txId });
}

async function monitorSell(tradeId: number) {
  setInterval(async () => {
    const trade = await db.select().from(trades).where({ id: tradeId }).then(r => r[0]);
    if (!trade) return;

    const currentPrice = await getCurrentPrice(trade.tokenOut); // implement later
    if (currentPrice >= trade.targetSellPrice) {
      // trigger sell via Jupiter
      await db.update(trades).set({ status: 'sold' }).where({ id: tradeId });
    }
  }, 5000);
}