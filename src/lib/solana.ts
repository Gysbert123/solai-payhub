import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { positions } from './schema';
import { eq, and, isNull } from 'drizzle-orm';

const connection = mysql.createPool(process.env.DATABASE_URL!);
export const db = drizzle(connection);

type PositionRow = typeof positions.$inferSelect;
type PositionStatusUpdate = {
  status: PositionRow['status'];
  profit: PositionRow['profit'];
  sold_at: PositionRow['sold_at'];
};

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

export async function getOpenTrades() {
  return await db
    .select()
    .from(positions)
    .where(and(eq(positions.status, 'open'), isNull(positions.sold_at)));
}

export async function markTradeAsSold(id: string, profit: number) {
  const updateValues: PositionStatusUpdate = {
    status: 'sold',
    profit: profit.toFixed(9),
    sold_at: new Date(),
  };

  await db
    .update(positions)
    .set(updateValues as unknown as Partial<typeof positions.$inferInsert>)
    .where(eq(positions.id, id));
}