-- Phase 3: honest per-product price evidence + vocabulary view for typo tolerance.

-- One row per product, computed at import time by src/server/domain/price-evidence.ts.
-- "reliable" means: >=1 comparison-eligible priced offer, a single unit group, and a bounded spread.
CREATE TABLE product_price_evidence (
  product_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,                -- reliable | wide_spread | mixed_units | no_eligible | no_price
  reliable_count INTEGER NOT NULL,     -- comparison-eligible priced offers
  min_toman INTEGER,
  median_toman INTEGER,
  max_toman INTEGER,
  unit_hint TEXT,                      -- per_metre | roll_or_pack | unknown (only when a single group)
  spread_ratio REAL,                   -- max/min among eligible offers
  stale_share REAL,                    -- share of eligible offers older than 90 days at the snapshot
  newest_at TEXT,
  oldest_at TEXT,
  total_offers INTEGER NOT NULL,
  priced_offers INTEGER NOT NULL,
  distinct_sellers INTEGER NOT NULL,
  excluded_json TEXT,                  -- {flag: count} of priced offers excluded from the range
  rules_version TEXT NOT NULL
);
CREATE INDEX idx_ppe_status ON product_price_evidence(status);
CREATE INDEX idx_ppe_median ON product_price_evidence(median_toman);

-- term | doc | cnt over the FTS index; used for vocabulary-based typo correction and join/split detection.
CREATE VIRTUAL TABLE product_fts_vocab USING fts5vocab(product_fts, 'row');
