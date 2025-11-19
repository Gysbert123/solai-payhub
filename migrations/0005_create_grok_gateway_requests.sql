CREATE TABLE IF NOT EXISTS grok_gateway_requests (
  id VARCHAR(36) PRIMARY KEY,
  agent_id VARCHAR(64) NOT NULL,
  agent_wallet VARCHAR(64) NOT NULL,
  prompt TEXT NOT NULL,
  reference VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  payment_amount_sol NUMERIC(20, 9) NOT NULL,
  grok_cost_usd NUMERIC(20, 9),
  rake_percentage INTEGER DEFAULT 60,
  tx_signature VARCHAR(120),
  grok_response TEXT,
  jupiter_recommendation TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_grok_gateway_requests_reference ON grok_gateway_requests(reference);
CREATE INDEX IF NOT EXISTS idx_grok_gateway_requests_agent_wallet ON grok_gateway_requests(agent_wallet);
CREATE INDEX IF NOT EXISTS idx_grok_gateway_requests_status ON grok_gateway_requests(status);
CREATE INDEX IF NOT EXISTS idx_grok_gateway_requests_created_at ON grok_gateway_requests(created_at DESC);

