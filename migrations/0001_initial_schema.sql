-- 0001_initial_schema.sql
-- Initial schema for the CPU prices tracker.
-- Designed for ~8 sources from day one. price_history is append-only.

CREATE TABLE sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  base_url    TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE skus (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  vendor      TEXT NOT NULL,
  bucket      TEXT NOT NULL,
  tier        TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_skus_vendor ON skus(vendor);
CREATE INDEX idx_skus_bucket ON skus(bucket);

CREATE TABLE source_sku_aliases (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id               INTEGER NOT NULL REFERENCES sources(id),
  sku_id                  INTEGER NOT NULL REFERENCES skus(id),
  source_name             TEXT NOT NULL,
  normalized_source_name  TEXT NOT NULL,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source_id, normalized_source_name)
);
CREATE INDEX idx_aliases_sku ON source_sku_aliases(sku_id);

CREATE TABLE scrape_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id       INTEGER NOT NULL REFERENCES sources(id),
  status          TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failure')),
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  rows_found      INTEGER,
  rows_inserted   INTEGER,
  error_message   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_runs_source_started ON scrape_runs(source_id, started_at DESC);

CREATE TABLE price_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id            INTEGER NOT NULL REFERENCES skus(id),
  source_id         INTEGER NOT NULL REFERENCES sources(id),
  scrape_run_id     INTEGER NOT NULL REFERENCES scrape_runs(id),
  source_sku_name   TEXT NOT NULL,
  price_cents       INTEGER,
  raw_price_text    TEXT,
  currency          TEXT NOT NULL DEFAULT 'USD',
  price_type        TEXT NOT NULL DEFAULT 'street',
  benchmark_score   INTEGER,
  url               TEXT,
  scraped_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ph_sku_scraped         ON price_history(sku_id, scraped_at DESC);
CREATE INDEX idx_ph_source_scraped      ON price_history(source_id, scraped_at DESC);
CREATE INDEX idx_ph_sku_source_scraped  ON price_history(sku_id, source_id, scraped_at DESC);
CREATE INDEX idx_ph_run                 ON price_history(scrape_run_id);

-- Append-only enforcement on price_history.
-- Reads remain unaffected; INSERT is allowed; UPDATE and DELETE raise ABORT.
CREATE TRIGGER price_history_no_update
BEFORE UPDATE ON price_history
BEGIN
  SELECT RAISE(ABORT, 'price_history is append-only: UPDATE is not allowed');
END;

CREATE TRIGGER price_history_no_delete
BEFORE DELETE ON price_history
BEGIN
  SELECT RAISE(ABORT, 'price_history is append-only: DELETE is not allowed');
END;
