import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { positions } from './schema';
import { eq, and, isNull } from 'drizzle-orm';

function isValidDatabaseUrl(urlString: string | undefined) {
  if (!urlString) return false;

  try {
    const url = new URL(urlString);
    if (!url.hostname || url.hostname === 'HOST') return false;
    return url.protocol === 'mysql:' || url.protocol === 'mysqls:';
  } catch {
    return false;
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = isValidDatabaseUrl(databaseUrl)
  ? mysql.createPool(databaseUrl!)
  : null;

export const db = connection ? drizzle(connection) : null;

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
  if (!db) {
    console.warn('Database connection unavailable: savePosition skipped.');
    return;
  }

  return await db.insert(positions).values({
    id: crypto.randomUUID(),
    user_wallet: userWallet,
    token_mint: tokenMint,
    buy_amount: buyAmount,
    entry_sol: entrySol,
  });
}

export async function getOpenTrades() {
  if (!db) {
    console.warn('Database connection unavailable: returning empty open trades.');
    return [];
  }

  return await db
    .select()
    .from(positions)
    .where(and(eq(positions.status, 'open'), isNull(positions.sold_at)));
}

export async function markTradeAsSold(id: string, profit: number) {
  if (!db) {
    console.warn('Database connection unavailable: markTradeAsSold skipped.');
    return;
  }

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