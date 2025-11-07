import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { trades } from '@/db/schema';
import { eq } from 'drizzle-orm';

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql);

export async function getOpenTrades() {
  return await db.select().from(trades).where(eq(trades.status, 'open'));
}

export async function markTradeAsSold(id: number, profit: number) {
  await db.update(trades).set({ status: 'sold', profit: profit.toFixed(2) }).where(eq(trades.id, id));
}