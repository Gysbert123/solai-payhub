import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { positions, agentPayments } from './schema';
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';

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
type AgentPaymentRow = typeof agentPayments.$inferSelect;

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

export async function createAgentPayment(
  agentId: string,
  reference: string,
  amount: string
) {
  if (!db) {
    console.warn('Database connection unavailable: createAgentPayment skipped.');
    return null;
  }

  const id = crypto.randomUUID();
  await db.insert(agentPayments).values({
    id,
    agent_id: agentId,
    reference,
    amount,
  });

  const [record] = await db
    .select()
    .from(agentPayments)
    .where(eq(agentPayments.id, id))
    .limit(1);

  return record ?? null;
}

export async function getPendingAgentPayment(agentId: string) {
  if (!db) return null;

  const [record] = await db
    .select()
    .from(agentPayments)
    .where(
      and(
        eq(agentPayments.agent_id, agentId),
        eq(agentPayments.status, 'pending')
      )
    )
    .limit(1);

  return record ?? null;
}

export async function getConfirmedAgentPayment(agentId: string) {
  if (!db) return null;

  const [record] = await db
    .select()
    .from(agentPayments)
    .where(
      and(
        eq(agentPayments.agent_id, agentId),
        inArray(agentPayments.status, ['confirmed', 'delivered'])
      )
    )
    .orderBy(sql`COALESCE(${agentPayments.confirmed_at}, ${agentPayments.created_at}) DESC`)
    .limit(1);

  return record ?? null;
}

export async function getAgentPaymentByReference(reference: string) {
  if (!db) return null;

  const [record] = await db
    .select()
    .from(agentPayments)
    .where(eq(agentPayments.reference, reference))
    .limit(1);

  return record ?? null;
}

export async function confirmAgentPayment(
  reference: string,
  txSignature: string,
  insightJson: string
) {
  if (!db) {
    console.warn('Database connection unavailable: confirmAgentPayment skipped.');
    return null;
  }

  const updateValues: Partial<AgentPaymentRow> = {
    status: 'confirmed',
    tx_signature: txSignature,
    insight_json: insightJson,
    confirmed_at: new Date(),
  };

  await db
    .update(agentPayments)
    .set(updateValues)
    .where(eq(agentPayments.reference, reference));

  return await getAgentPaymentByReference(reference);
}

export async function markAgentInsightDelivered(id: string) {
  if (!db) return;

  const updateValues: Partial<AgentPaymentRow> = {
    status: 'delivered',
    delivered_at: new Date(),
  };

  await db
    .update(agentPayments)
    .set(updateValues)
    .where(eq(agentPayments.id, id));
}

export async function getAgentRevenueSummary() {
  if (!db) {
    return {
      totalCount: 0,
      totalAmount: '0',
    };
  }

  const [row] = await db
    .select({
      totalCount: sql<number>`COUNT(*)`,
      totalAmount: sql<string>`COALESCE(SUM(${agentPayments.amount}), 0)`,
    })
    .from(agentPayments)
    .where(inArray(agentPayments.status, ['confirmed', 'delivered']));

  return {
    totalCount: row?.totalCount ?? 0,
    totalAmount: row?.totalAmount ?? '0',
  };
}

export async function listRecentAgentPayments(limit = 5) {
  if (!db) return [];

  return await db
    .select()
    .from(agentPayments)
    .where(inArray(agentPayments.status, ['confirmed', 'delivered']))
    .orderBy(
      sql`COALESCE(${agentPayments.confirmed_at}, ${agentPayments.delivered_at}, ${agentPayments.created_at}) DESC`
    )
    .limit(limit);
}