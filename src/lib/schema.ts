import { pgTable, serial, varchar, decimal, timestamp, text } from 'drizzle-orm/postgres-js';

export const trades = pgTable('trades', {
  id: serial('id').primaryKey(),
  wallet: varchar('wallet', { length: 255 }).notNull(),
  tokenIn: varchar('token_in', { length: 100 }).notNull(),
  tokenOut: varchar('token_out', { length: 100 }).notNull(),
  amountIn: decimal('amount_in', { precision: 20, scale: 9 }).notNull(),
  amountOut: decimal('amount_out', { precision: 20, scale: 9 }),
  txId: text('tx_id'),
  status: varchar('status', { length: 50 }).notNull(),
  buyPrice: decimal('buy_price', { precision: 20, scale: 9 }),
  targetSellPrice: decimal('target_sell_price', { precision: 20, scale: 9 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});