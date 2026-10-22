-- Phase 2 schema. RAW columns keep the source text; typed/normalised columns are additive.
-- Source convention: the literal strings "null" and "" in plain columns are stored as SQL NULL;
-- JSON / price / timestamp columns additionally keep the exact source text in *_raw.

CREATE TABLE import_runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,                 -- running | complete
  source_kind TEXT NOT NULL,            -- zip | dir | fixture
  source_sha256 TEXT,
  importer_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  snapshot_ref TEXT,                    -- max(price_changed_at): reference date for staleness
  stats_json TEXT
);

CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  brand_name TEXT,
  category_name TEXT NOT NULL,
  model TEXT,
  persian_title TEXT,
  image_urls_raw TEXT,
  specs_raw TEXT,
  images_json TEXT,                     -- JSON array of validated http(s) URLs
  specs_json TEXT,                      -- JSON array of {section,key,value}
  spec_count INTEGER NOT NULL DEFAULT 0,
  parse_issues TEXT,                    -- JSON array of codes
  title_norm TEXT NOT NULL DEFAULT '',
  brand_norm TEXT NOT NULL DEFAULT '',
  category_norm TEXT NOT NULL DEFAULT '',
  model_keys TEXT NOT NULL DEFAULT '',  -- space separated compact model keys
  offer_count INTEGER NOT NULL DEFAULT 0,
  priced_offer_count INTEGER NOT NULL DEFAULT 0,
  source_row INTEGER NOT NULL
);
CREATE INDEX idx_products_category ON products(category_name);

CREATE TABLE shops (
  shop_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  location_label TEXT,
  lat REAL,                             -- NULL only if the source coordinate is unusable (flagged)
  lon REAL,
  category_names_raw TEXT,
  category_names_json TEXT,
  contacts_raw TEXT,                    -- synthetic phone numbers; NEVER selected by repositories
  instagram_raw TEXT,
  instagram_url TEXT,                   -- validated https URL or NULL
  website_url_raw TEXT,
  website_url TEXT,                     -- validated http(s) URL or NULL
  payment_options_raw TEXT,
  payment_json TEXT,                    -- JSON array of {providerName, channel}; NULL when nothing declared
  supports_fast_delivery_raw TEXT,
  supports_fast_delivery INTEGER,       -- 1 / 0 / NULL (unknown)
  weekly_hours_raw TEXT,
  hours_json TEXT NOT NULL,             -- DeclaredHours (placeholders stripped)
  has_schedule INTEGER NOT NULL,
  placeholder_shifts INTEGER NOT NULL DEFAULT 0,
  unsupported_days INTEGER NOT NULL DEFAULT 0,
  parse_issues TEXT,
  name_norm TEXT NOT NULL DEFAULT '',
  label_norm TEXT NOT NULL DEFAULT '',
  offer_count INTEGER NOT NULL DEFAULT 0,
  source_row INTEGER NOT NULL
);
CREATE INDEX idx_shops_label ON shops(location_label);
CREATE INDEX idx_shops_lat_lon ON shops(lat, lon);

CREATE TABLE offers (
  offer_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  shop_id TEXT NOT NULL,
  seller_title TEXT NOT NULL,           -- raw, never rewritten
  description TEXT,
  price_toman_raw TEXT,                 -- exact source text ("null" kept)
  price_toman INTEGER,                  -- exact integer when <= 2^53-1; NULL when unrecorded / unparseable / out of JS-safe range
  price_out_of_range INTEGER NOT NULL DEFAULT 0,  -- 1 when the raw digits exceed 2^53-1 (exact value stays in price_toman_raw)
  last_price_changed_at_raw TEXT,
  price_changed_at TEXT,                -- ISO-8601 UTC, NULL when unknown
  warranty_raw TEXT,
  warranty_months INTEGER,
  warranty_provider TEXT,
  warranty_description TEXT,
  seller_title_norm TEXT NOT NULL DEFAULT '',
  model_keys TEXT NOT NULL DEFAULT '',
  unit_hint TEXT NOT NULL DEFAULT 'unknown',  -- per_metre | roll_or_pack | unknown
  parse_issues TEXT,
  source_row INTEGER NOT NULL
);
CREATE INDEX idx_offers_product ON offers(product_id);
CREATE INDEX idx_offers_shop ON offers(shop_id);
CREATE INDEX idx_offers_product_shop ON offers(product_id, shop_id);

CREATE TABLE quality_flags (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,            -- offer | shop | product
  entity_id TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,               -- info | warn | error
  rules_version TEXT NOT NULL,
  reason TEXT NOT NULL,                 -- Persian explanation
  details_json TEXT
);
CREATE INDEX idx_flags_entity ON quality_flags(entity_type, entity_id);
CREATE INDEX idx_flags_code ON quality_flags(code);

-- Contentless FTS5 index over Persian-normalised text. rowid = products.rowid.
CREATE VIRTUAL TABLE product_fts USING fts5(
  title, brand, category, model_keys, seller_titles,
  content='',
  tokenize='unicode61 remove_diacritics 2',
  prefix='2 3 4'
);

-- Bounding-box index for shops. id = shops.rowid.
CREATE VIRTUAL TABLE shop_geo USING rtree(id, min_lat, max_lat, min_lon, max_lon);
