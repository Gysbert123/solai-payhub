import { pgTable, varchar, numeric, timestamp, text, integer } from 'drizzle-orm/pg-core';

export const positions = pgTable('positions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  user_wallet: varchar('user_wallet', { length: 48 }).notNull(),
  token_mint: varchar('token_mint', { length: 48 }).notNull(),
  buy_amount: numeric('buy_amount', { precision: 20, scale: 9 }).notNull(),
  entry_sol: numeric('entry_sol', { precision: 20, scale: 9 }).notNull(),
  tx_signature: varchar('tx_signature', { length: 100 }),
  status: varchar('status', { length: 20 }).default('open'),
  profit: numeric('profit', { precision: 20, scale: 9 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  sold_at: timestamp('sold_at', { withTimezone: true }),
});

export const agentPayments = pgTable('agent_payments', {
  id: varchar('id', { length: 36 }).primaryKey(),
  agent_id: varchar('agent_id', { length: 64 }).notNull(),
  reference: varchar('reference', { length: 64 }).notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  amount: numeric('amount', { precision: 20, scale: 9 }).notNull(),
  tx_signature: varchar('tx_signature', { length: 120 }),
  insight_json: text('insight_json'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  confirmed_at: timestamp('confirmed_at', { withTimezone: true }),
  delivered_at: timestamp('delivered_at', { withTimezone: true }),
});

export const arbs = pgTable('arbs', {
  id: varchar('id', { length: 36 }).primaryKey(),
  base_mint: varchar('base_mint', { length: 64 }).notNull(),
  quote_mint: varchar('quote_mint', { length: 64 }).notNull(),
  base_symbol: varchar('base_symbol', { length: 16 }).notNull(),
  quote_symbol: varchar('quote_symbol', { length: 16 }).notNull(),
  price: numeric('price', { precision: 20, scale: 9 }).notNull(),
  profit_pct: numeric('profit_pct', { precision: 10, scale: 4 }).notNull(),
  source: varchar('source', { length: 32 }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const marketplaceListings = pgTable('marketplace_listings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  agent_id: varchar('agent_id', { length: 64 }).notNull(),
  agent_wallet: varchar('agent_wallet', { length: 64 }).notNull(),
  title: varchar('title', { length: 120 }).notNull(),
  summary: text('summary').notNull(),
  content: text('content').notNull(),
  price_usdc: numeric('price_usdc', { precision: 20, scale: 9 }).notNull(),
  list_fee_reference: varchar('list_fee_reference', { length: 64 }).notNull(),
  list_fee_signature: varchar('list_fee_signature', { length: 120 }),
  purchase_reference: varchar('purchase_reference', { length: 64 }),
  purchase_signature: varchar('purchase_signature', { length: 120 }),
  status: varchar('status', { length: 32 }).notNull().default('pending_fee'),
  buyer_agent_id: varchar('buyer_agent_id', { length: 64 }),
  buyer_wallet: varchar('buyer_wallet', { length: 64 }),
  rake_bps: integer('rake_bps').default(2000).notNull(),
  rake_amount_usdc: numeric('rake_amount_usdc', { precision: 20, scale: 9 }),
  seller_amount_usdc: numeric('seller_amount_usdc', { precision: 20, scale: 9 }),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  activated_at: timestamp('activated_at', { withTimezone: true }),
  sold_at: timestamp('sold_at', { withTimezone: true }),
  delivery_payload: text('delivery_payload'),
});

export const marketplacePurchases = pgTable('marketplace_purchases', {
  id: varchar('id', { length: 36 }).primaryKey(),
  listing_id: varchar('listing_id', { length: 36 }).notNull(),
  buyer_agent_id: varchar('buyer_agent_id', { length: 64 }),
  buyer_wallet: varchar('buyer_wallet', { length: 64 }).notNull(),
  purchase_reference: varchar('purchase_reference', { length: 64 }).notNull(),
  purchase_signature: varchar('purchase_signature', { length: 120 }).notNull(),
  rake_amount_usdc: numeric('rake_amount_usdc', { precision: 20, scale: 9 }),
  seller_amount_usdc: numeric('seller_amount_usdc', { precision: 20, scale: 9 }),
  purchased_at: timestamp('purchased_at', { withTimezone: true }).defaultNow(),
});

// FORCE REBUILD