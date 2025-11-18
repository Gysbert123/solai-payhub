import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { randomUUID } from 'crypto';
import { positions, agentPayments, arbs, marketplaceListings, marketplacePurchases } from './schema';
import { eq, and, isNull, isNotNull, sql, inArray, desc, lt } from 'drizzle-orm';

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
type MarketplaceListingRow = typeof marketplaceListings.$inferSelect;

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
    id: randomUUID(),
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

  const id = randomUUID();
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

export async function createMarketplaceListingDraft(params: {
  agentId: string;
  agentWallet: string;
  title: string;
  summary: string;
  content: string;
  priceUsdc: string;
  listFeeReference: string;
}) {
  if (!db) {
    console.warn('Database connection unavailable: createMarketplaceListingDraft skipped.');
    return null;
  }

  const id = randomUUID();
  const insertValues: typeof marketplaceListings.$inferInsert = {
    id,
    agent_id: params.agentId,
    agent_wallet: params.agentWallet,
    title: params.title,
    summary: params.summary,
    content: params.content,
    price_usdc: params.priceUsdc,
    list_fee_reference: params.listFeeReference,
  };

  await db.insert(marketplaceListings).values(insertValues);

  return await getMarketplaceListingById(id);
}

export async function getMarketplaceListingById(id: string) {
  if (!db) return null;

  const [record] = await db
    .select()
    .from(marketplaceListings)
    .where(eq(marketplaceListings.id, id))
    .limit(1);

  return record ?? null;
}

export async function getMarketplaceListingByReference(
  reference: string,
  mode: 'list' | 'purchase'
) {
  if (!db) return null;

  const field =
    mode === 'list'
      ? marketplaceListings.list_fee_reference
      : marketplaceListings.purchase_reference;

  const [record] = await db
    .select()
    .from(marketplaceListings)
    .where(eq(field, reference))
    .limit(1);

  return record ?? null;
}

export async function activateMarketplaceListing(
  id: string,
  signature: string,
  expiresAt: Date | null
) {
  if (!db) return;

  const updateValues: Partial<typeof marketplaceListings.$inferSelect> = {
    status: 'active',
    list_fee_signature: signature,
    activated_at: new Date(),
    expires_at: expiresAt ?? null,
  };

  await db
    .update(marketplaceListings)
    .set(updateValues)
    .where(eq(marketplaceListings.id, id));
}

export async function listMarketplaceListings(options?: {
  status?: Array<MarketplaceListingRow['status']>;
  buyerWallet?: string;
  limit?: number;
}) {
  if (!db) return [];

  const { status, buyerWallet, limit = 20 } = options ?? {};
  
  // If status includes 'awaiting_payment' and buyerWallet is provided, filter by wallet
  // Otherwise, if status includes 'awaiting_payment' without buyerWallet, exclude them
  if (status && status.length > 0) {
    if (status.includes('awaiting_payment')) {
      if (buyerWallet) {
        // Only show awaiting_payment listings for this specific wallet
        return await db
          .select()
          .from(marketplaceListings)
          .where(
            and(
              inArray(marketplaceListings.status, status),
              eq(marketplaceListings.buyer_wallet, buyerWallet)
            )
          )
          .orderBy(desc(marketplaceListings.created_at))
          .limit(limit);
      } else {
        // Exclude awaiting_payment listings if no wallet specified
        const otherStatuses = status.filter(s => s !== 'awaiting_payment');
        if (otherStatuses.length > 0) {
          return await db
            .select()
            .from(marketplaceListings)
            .where(inArray(marketplaceListings.status, otherStatuses))
            .orderBy(desc(marketplaceListings.created_at))
            .limit(limit);
        } else {
          // If only awaiting_payment was requested without wallet, return empty
          return [];
        }
      }
    } else {
      return await db
        .select()
        .from(marketplaceListings)
        .where(inArray(marketplaceListings.status, status))
        .orderBy(desc(marketplaceListings.created_at))
        .limit(limit);
    }
  }
  
  // No status filter - return all
  return await db
    .select()
    .from(marketplaceListings)
    .orderBy(desc(marketplaceListings.created_at))
    .limit(limit);
}

export async function getPurchasedListingsByWallet(
  buyerWallet: string,
  limit = 50
): Promise<MarketplaceListingRow[]> {
  if (!db) {
    console.warn('Database connection unavailable: returning empty purchased listings.');
    return [];
  }

  // Get purchases from purchase history table
  const purchases = await db
    .select()
    .from(marketplacePurchases)
    .where(eq(marketplacePurchases.buyer_wallet, buyerWallet))
    .orderBy(desc(marketplacePurchases.purchased_at))
    .limit(limit);

  // Get the actual listings
  const listingIds = purchases.map(p => p.listing_id);
  if (listingIds.length === 0) return [];

  const listings = await db
    .select()
    .from(marketplaceListings)
    .where(inArray(marketplaceListings.id, listingIds));

  // Sort by purchase date
  const listingMap = new Map(listings.map(l => [l.id, l]));
  return purchases
    .map(p => listingMap.get(p.listing_id))
    .filter((l): l is MarketplaceListingRow => l !== undefined);
}

export async function createMarketplacePurchase(params: {
  listingId: string;
  buyerAgentId: string | null;
  buyerWallet: string;
  purchaseReference: string;
  purchaseSignature: string;
  rakeAmount: string;
  sellerAmount: string;
}) {
  if (!db) return null;

  // Try to create the purchase record, but don't fail if table doesn't exist yet
  // The migration will be run separately
  try {

  const insertValues: {
    id: string;
    listing_id: string;
    buyer_wallet: string;
    purchase_reference: string;
    purchase_signature: string;
    rake_amount_usdc: string;
    seller_amount_usdc: string;
    buyer_agent_id?: string;
  } = {
    id: randomUUID(),
    listing_id: params.listingId,
    buyer_wallet: params.buyerWallet,
    purchase_reference: params.purchaseReference,
    purchase_signature: params.purchaseSignature,
    rake_amount_usdc: params.rakeAmount,
    seller_amount_usdc: params.sellerAmount,
  };

  if (params.buyerAgentId) {
    insertValues.buyer_agent_id = params.buyerAgentId;
  }

    return await db.insert(marketplacePurchases).values(insertValues);
  } catch (err: any) {
    // If table doesn't exist, log but don't fail - migration needs to be run
    if (err?.message?.includes('does not exist') || err?.message?.includes('relation')) {
      console.warn('marketplace_purchases table does not exist. Please run migration 0003_create_marketplace_purchases.sql');
      return null;
    }
    throw err;
  }
}

export async function reserveMarketplaceListingForBuyer(params: {
  listingId: string;
  buyerAgentId: string;
  buyerWallet: string;
  purchaseReference: string;
}) {
  if (!db) return null;

  const updateValues: Partial<typeof marketplaceListings.$inferSelect> = {
    status: 'awaiting_payment',
    buyer_agent_id: params.buyerAgentId,
    buyer_wallet: params.buyerWallet,
    purchase_reference: params.purchaseReference,
  };

  await db
    .update(marketplaceListings)
    .set(updateValues)
    .where(eq(marketplaceListings.id, params.listingId));

  return await getMarketplaceListingById(params.listingId);
}

export async function confirmMarketplacePurchase(params: {
  listingId: string;
  signature: string;
  rakeAmount: string;
  sellerAmount: string;
  keepActive?: boolean; // If true, keep listing active for multiple purchases
  buyerAgentId?: string | null;
  buyerWallet?: string;
  purchaseReference?: string;
}) {
  if (!db) return null;

  // Create purchase history record
  const listing = await getMarketplaceListingById(params.listingId);
  if (listing) {
    await createMarketplacePurchase({
      listingId: params.listingId,
      buyerAgentId: params.buyerAgentId ?? listing.buyer_agent_id,
      buyerWallet: params.buyerWallet ?? listing.buyer_wallet ?? '',
      purchaseReference: params.purchaseReference ?? listing.purchase_reference ?? '',
      purchaseSignature: params.signature,
      rakeAmount: params.rakeAmount,
      sellerAmount: params.sellerAmount,
    });
  }

  const updateValues: Partial<typeof marketplaceListings.$inferSelect> = {
    // Keep listing active for multiple purchases, only mark as sold if keepActive is false
    status: params.keepActive !== false ? 'active' : 'sold',
    // Clear buyer info so next buyer can purchase (but we keep it in purchase_history)
    buyer_agent_id: null,
    buyer_wallet: null,
    // DON'T clear purchase_reference and purchase_signature - they're needed for lookup
    // They'll be overwritten when the next buyer reserves the listing
  };

  await db
    .update(marketplaceListings)
    .set(updateValues)
    .where(eq(marketplaceListings.id, params.listingId));

  return await getMarketplaceListingById(params.listingId);
}

export async function recordMarketplaceDelivery(listingId: string, payload: string) {
  if (!db) return null;

  const updateValues: Partial<typeof marketplaceListings.$inferSelect> = {
    delivery_payload: payload,
  };

  await db
    .update(marketplaceListings)
    .set(updateValues)
    .where(eq(marketplaceListings.id, listingId));

  return await getMarketplaceListingById(listingId);
}

export async function expireMarketplaceListings(referenceDate = new Date()) {
  if (!db) return 0;

  const updateValues: Partial<typeof marketplaceListings.$inferSelect> = {
    status: 'expired',
  };

  const result = await db
    .update(marketplaceListings)
    .set(updateValues)
    .where(
      and(
        isNull(marketplaceListings.sold_at),
        isNull(marketplaceListings.purchase_signature),
        isNotNull(marketplaceListings.expires_at),
        lt(marketplaceListings.expires_at, referenceDate),
        inArray(marketplaceListings.status, ['active', 'awaiting_payment'])
      )
    )
    .returning({ id: marketplaceListings.id });

  return result.length;
}

// Reset stale "awaiting_payment" listings back to "active" after 1 hour
export async function resetStaleAwaitingPaymentListings() {
  if (!db) return 0;

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const updateValues: Partial<typeof marketplaceListings.$inferSelect> = {
    status: 'active',
    buyer_agent_id: null,
    buyer_wallet: null,
    purchase_reference: null,
  };

  const result = await db
    .update(marketplaceListings)
    .set(updateValues)
    .where(
      and(
        eq(marketplaceListings.status, 'awaiting_payment'),
        // Reset if created more than 1 hour ago and no purchase signature
        lt(marketplaceListings.created_at, oneHourAgo),
        isNull(marketplaceListings.purchase_signature)
      )
    )
    .returning({ id: marketplaceListings.id });

  return result.length;
}