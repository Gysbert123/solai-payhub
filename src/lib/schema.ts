import { pgTable, varchar, numeric, timestamp, text } from 'drizzle-orm/pg-core';

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

// FORCE REBUILD