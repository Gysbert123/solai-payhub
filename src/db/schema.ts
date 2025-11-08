import { pgTable, serial, varchar, numeric, timestamp, text } from 'drizzle-orm/pg-core';

export const trades = pgTable('trades', {
  id: serial('id').primaryKey(),
  user_id: varchar('user_id', { length: 255 }).notNull(),
  token_mint: varchar('token_mint', { length: 44 }).notNull(),
  amount: numeric('amount', { precision: 20, scale: 9 }).notNull(),
  buy_price: numeric('buy_price', { precision: 20, scale: 9 }).notNull(),
  status: varchar('status', { length: 20 }).default('open'),
  profit: numeric('profit', { precision: 20, scale: 9 }),
  created_at: timestamp('created_at').defaultNow(),
  sold_at: timestamp('sold_at'),
});

export const agentPayments = pgTable('agent_payments', {
  id: varchar('id', { length: 36 }).primaryKey(),
  agent_id: varchar('agent_id', { length: 64 }).notNull(),
  reference: varchar('reference', { length: 64 }).notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  amount: numeric('amount', { precision: 20, scale: 9 }).notNull(),
  tx_signature: varchar('tx_signature', { length: 120 }),
  insight_json: text('insight_json'),
  created_at: timestamp('created_at').defaultNow(),
  confirmed_at: timestamp('confirmed_at'),
  delivered_at: timestamp('delivered_at'),
});