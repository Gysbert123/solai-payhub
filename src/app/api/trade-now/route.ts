import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { trades } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(request: Request) {
  const body = await request.json();
  const { user_id, token_mint, amount, buy_price } = body;

  if (!user_id || !token_mint || !amount || !buy_price) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const result = await db
      .insert(trades)
      .values({
        user_id,
        token_mint,
        amount: amount.toString(),
        buy_price: buy_price.toString(),
      })
      .returning();

    const newTrade = result[0];

    return NextResponse.json({
      success: true,
      trade: {
        id: newTrade.id,
        user_id: newTrade.user_id,
        token_mint: newTrade.token_mint,
        amount: newTrade.amount,
        buy_price: newTrade.buy_price,
        status: newTrade.status,
      },
    });
  } catch (error) {
    console.error('Trade insert failed:', error);
    return NextResponse.json({ error: 'Failed to save trade' }, { status: 500 });
  }
}