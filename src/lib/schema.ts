import { mysqlTable, varchar, decimal, timestamp } from 'drizzle-orm/mysql-core';

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