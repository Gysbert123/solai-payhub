import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { positions } from './schema';
import { eq, and, isNull } from 'drizzle-orm';

const connection = mysql.createPool(process.env.DATABASE_URL!);
export const db = drizzle(connection);

// Save a new buy position
export async function savePosition(
  userWallet: string,
  tokenMint: string,
  buyAmount: string,
  entrySol: string
) {
  return await db.insert(positions).values({
    id: crypto.randomUUID(),
    user_wallet: userWallet,
    token_mint: tokenMint,
    buy_amount: buyAmount,
    entry_sol: entrySol,
  });
}

// Get all open positions
export async function getOpenTrades() {
  return await db
    .select()
    .from(positions)
    .where(and(eq(positions.status, 'open'), isNull(positions.sold_at)));
}

// Mark position as sold
export async function markTradeAsSold(id: string, profit: number) {
  await db
    .update(positions)
    .set({
      status: 'sold' as const,
      profit: profit.toFixed(6),
      sold_at: new Date(),
    })
    .where(eq(positions.id, id));
}