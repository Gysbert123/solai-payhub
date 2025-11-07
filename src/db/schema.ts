import { pgTable, serial, varchar, numeric, timestamp, text } from 'drizzle-orm/pg-core';

export const trades = pgTable('trades', {
  id: serial('id').primaryKey(),
  user_id: varchar('user_id', { length: 255 }).notNull(),
  token_mint: varchar('token_mint', { length: 44 }).notNull(),
  amount: numeric('amount', { precision: 20, scale: 9 }).notNull(),
  buy_price: numeric('buy_price', { precision: 20, scale: 9 }).notNull(),
  status: text('status').$type<'open' | 'sold'>().default('open'),
  profit: numeric('profit', { precision: 10, scale: 2 }),
  created_at: timestamp('created_at').defaultNow(),
});