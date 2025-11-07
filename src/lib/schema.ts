import { mysqlTable, varchar, decimal, timestamp } from 'drizzle-orm/mysql-core';

export const trades = mysqlTable('trades', {
  id: varchar('id', { length: 36 }).primaryKey(),
  user_id: varchar('user_id', { length: 48 }).notNull(),
  token_mint: varchar('token_mint', { length: 48 }).notNull(),
  amount: decimal('amount', { precision: 20, scale: 9 }).notNull(),
  buy_price: decimal('buy_price', { precision: 20, scale: 9 }).notNull(),
  profit: decimal('profit', { precision: 20, scale: 9 }),
  status: varchar('status', { length: 20 }).default('open'),
  created_at: timestamp('created_at').defaultNow(),
  sold_at: timestamp('sold_at'),
});