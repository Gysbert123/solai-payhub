import { NextResponse } from 'next/server';
import { recordArbs } from '@/lib/db';

const TOKENS = [
  {
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
  },
  {
    mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    symbol: 'WIF',
  },
  {
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    symbol: 'JUP',
  },
];

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyK7fDi';
const PROFIT_THRESHOLD = 0.5;

type TokenSnapshot = {
  price: number;
  changePct: number;
};

function pickChangePercent(data: Record<string, any> | undefined): number {
  if (!data) return 0;
  const candidates = [
    data.priceChange,
    data.priceChange24h,
    data.priceChange1h,
    data.priceChange5m,
    data.price_percent_change,
    data.price_percent_change_24h,
    data.price_percent_change_1h,
    data.price_percent_change_5m,
  ];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

async function fetchTokenSnapshot(mint: string): Promise<TokenSnapshot | null> {
  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey) {
    console.error('BIRDEYE_API_KEY missing');
    return null;
  }

  try {
    const res = await fetch(`https://public-api.birdeye.so/public/price?address=${mint}`, {
      headers: {
        accept: 'application/json',
        'X-API-KEY': apiKey,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error('Birdeye price error', mint, res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const payload = data?.data;
    const price = payload?.value ?? payload?.price;
    const changePct = pickChangePercent(payload);

    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      return null;
    }

    return {
      price,
      changePct,
    };
  } catch (error) {
    console.error('Birdeye fetch failed', mint, error);
    return null;
  }
}

export async function GET() {
  try {
    const results = [];

    for (const token of TOKENS) {
      const snapshot = await fetchTokenSnapshot(token.mint);
      if (!snapshot) continue;

      const profitPct = snapshot.changePct ?? 0;
      if (Math.abs(profitPct) >= PROFIT_THRESHOLD) {
        results.push({
          baseMint: token.mint,
          quoteMint: USDC_MINT,
          baseSymbol: token.symbol,
          quoteSymbol: 'USDC',
          price: snapshot.price.toFixed(9),
          profitPct: profitPct.toFixed(4),
          source: 'Birdeye',
        });
      }
    }

    if (results.length > 0) {
      await recordArbs(results);
    }

    return NextResponse.json({ stored: results.length });
  } catch (error) {
    console.error('Scanner cron failed:', error);
    return NextResponse.json({ error: 'scanner failed' }, { status: 500 });
  }
}

