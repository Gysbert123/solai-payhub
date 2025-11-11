import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { randomUUID } from 'crypto';
import { positions, agentPayments, arbs } from './schema';
import { eq, and, isNull, sql, inArray, desc } from 'drizzle-orm';

function isValidDatabaseUrl(url?: string) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname || parsed.hostname === 'HOST') return false;
    return parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:';
  } catch {
    return false;
  }
}

const databaseUrl = process.env.DATABASE_URL;

const client = isValidDatabaseUrl(databaseUrl)
  ? postgres(databaseUrl!, {
      ssl: 'require',
      prepare: false,
    })
  : null;

export const db = client ? drizzle(client) : null;

type PositionRow = typeof positions.$inferSelect;
type PositionStatusUpdate = {
  status: PositionRow['status'];
  profit: PositionRow['profit'];
  sold_at: PositionRow['sold_at'];
};
type AgentPaymentRow = typeof agentPayments.$inferSelect;

export function logAgentPayment(event: string, details: Record<string, unknown>) {
  console.log(`[agent-payment] ${event}`, details);
}

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

  logAgentPayment('created', { id, agentId, reference, amount });

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

  logAgentPayment('confirmed', { reference, txSignature });

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

  logAgentPayment('delivered', { id });
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

export async function recordArbs(entries: {
  baseMint: string;
  quoteMint: string;
  baseSymbol: string;
  quoteSymbol: string;
  price: string;
  profitPct: string;
  source: string;
}[]) {
  if (!db) {
    console.warn('Database connection unavailable: recordArbs skipped.');
    return;
  }

  if (entries.length === 0) return;

  const baseMints = entries.map((entry) => entry.baseMint);

  await db.delete(arbs).where(inArray(arbs.base_mint, baseMints));

  await db.insert(arbs).values(
    entries.map((entry) => ({
      id: randomUUID(),
      base_mint: entry.baseMint,
      quote_mint: entry.quoteMint,
      base_symbol: entry.baseSymbol,
      quote_symbol: entry.quoteSymbol,
      price: entry.price,
      profit_pct: entry.profitPct,
      source: entry.source,
    }))
  );
}

export async function listRecentArbs(limit = 10) {
  if (!db) return [];

  return db
    .select()
    .from(arbs)
    .orderBy(desc(arbs.created_at))
    .limit(limit);
}