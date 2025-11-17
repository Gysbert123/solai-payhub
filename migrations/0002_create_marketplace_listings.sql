CREATE TABLE IF NOT EXISTS marketplace_listings (
    id VARCHAR(36) PRIMARY KEY,
    agent_id VARCHAR(64) NOT NULL,
    agent_wallet VARCHAR(64) NOT NULL,
    title VARCHAR(120) NOT NULL,
    summary TEXT NOT NULL,
    content TEXT NOT NULL,
    price_usdc NUMERIC(20, 9) NOT NULL,
    list_fee_reference VARCHAR(64) NOT NULL,
    list_fee_signature VARCHAR(120),
    purchase_reference VARCHAR(64),
    purchase_signature VARCHAR(120),
    status VARCHAR(32) NOT NULL DEFAULT 'pending_fee',
    buyer_agent_id VARCHAR(64),
    buyer_wallet VARCHAR(64),
    rake_bps INTEGER NOT NULL DEFAULT 2000,
    rake_amount_usdc NUMERIC(20, 9),
    seller_amount_usdc NUMERIC(20, 9),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    sold_at TIMESTAMPTZ,
    delivery_payload TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_listings_list_fee_reference_key
    ON marketplace_listings (list_fee_reference);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_listings_purchase_reference_key
    ON marketplace_listings (purchase_reference)
    WHERE purchase_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketplace_listings_status_idx
    ON marketplace_listings (status);



