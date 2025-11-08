import { mysqlTable, varchar, decimal, timestamp, text } from 'drizzle-orm/mysql-core';

export const positions = mysqlTable('positions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  user_wallet: varchar('user_wallet', { length: 48 }).notNull(),
  token_mint: varchar('token_mint', { length: 48 }).notNull(),
  buy_amount: decimal('buy_amount', { precision: 20, scale: 9 }).notNull(),
  entry_sol: decimal('entry_sol', { precision: 20, scale: 9 }).notNull(),
  tx_signature: varchar('tx_signature', { length: 100 }),
  status: varchar('status', { length: 20 }).default('open'),
  profit: decimal('profit', { precision: 20, scale: 9 }),
  created_at: timestamp('created_at').defaultNow(),
  sold_at: timestamp('sold_at'),
});

export const agentPayments = mysqlTable('agent_payments', {
  id: varchar('id', { length: 36 }).primaryKey(),
  agent_id: varchar('agent_id', { length: 64 }).notNull(),
  reference: varchar('reference', { length: 64 }).notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  amount: decimal('amount', { precision: 20, scale: 9 }).notNull(),
  tx_signature: varchar('tx_signature', { length: 120 }),
  insight_json: text('insight_json'),
  created_at: timestamp('created_at').defaultNow(),
  confirmed_at: timestamp('confirmed_at'),
  delivered_at: timestamp('delivered_at'),
});

// FORCE REBUILD