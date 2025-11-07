import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { positions } from './schema';
import { eq } from 'drizzle-orm';

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

// Mark position as sold with profit
export async function markAsSold(id: string, profit: number) {
  await db
    .update(positions)
    .set({
      status: 'sold' as const,
      profit: profit.toFixed(6),
      sold_at: new Date(),
    })
    .where(eq(positions.id, id));
}