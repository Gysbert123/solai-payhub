-- Create marketplace_purchases table to track individual purchases
CREATE TABLE IF NOT EXISTS marketplace_purchases (
  id VARCHAR(36) PRIMARY KEY,
  listing_id VARCHAR(36) NOT NULL,
  buyer_agent_id VARCHAR(64),
  buyer_wallet VARCHAR(64) NOT NULL,
  purchase_reference VARCHAR(64) NOT NULL,
  purchase_signature VARCHAR(120) NOT NULL,
  rake_amount_usdc NUMERIC(20, 9),
  seller_amount_usdc NUMERIC(20, 9),
  purchased_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_marketplace_purchases_listing_id ON marketplace_purchases(listing_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_purchases_buyer_wallet ON marketplace_purchases(buyer_wallet);
CREATE INDEX IF NOT EXISTS idx_marketplace_purchases_purchase_reference ON marketplace_purchases(purchase_reference);

