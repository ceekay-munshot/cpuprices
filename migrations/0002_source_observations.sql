-- 0002_source_observations.sql
-- Raw, append-only observation table for the full PassMark CPU list
-- (/cpu-list/all). Stores EVERY scraped row, not just the curated tracked SKUs.
--
-- Relationship to price_history:
--   - source_observations is the wide corpus: every CPU the source emits,
--     across vendors, with no sku_id requirement.
--   - price_history is the narrow curated table: only the tracked canonical
--     SKUs from config/tracked-skus.json, with sku_id NOT NULL.
--   - A given scrape_run writes to both: every row into source_observations,
--     matched rows additionally into price_history.

CREATE TABLE source_observations (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id               INTEGER NOT NULL REFERENCES sources(id),
  scrape_run_id           INTEGER NOT NULL REFERENCES scrape_runs(id),
  source_sku_name         TEXT NOT NULL,
  normalized_source_name  TEXT NOT NULL,
  vendor_inferred         TEXT CHECK (
                            vendor_inferred IS NULL
                            OR vendor_inferred IN ('Intel', 'AMD', 'Apple', 'Qualcomm', 'ARM', 'Other')
                          ),
  segment_inferred        TEXT,
  benchmark_score         INTEGER,
  rank                    INTEGER,
  cpu_value               REAL,
  price_cents             INTEGER,
  raw_price_text          TEXT,
  currency                TEXT NOT NULL DEFAULT 'USD',
  url                     TEXT,
  scraped_at              TEXT NOT NULL,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for the dashboard's hot queries.
CREATE INDEX idx_so_run                ON source_observations(scrape_run_id);
CREATE INDEX idx_so_source_scraped     ON source_observations(source_id, scraped_at DESC);
CREATE INDEX idx_so_normalized         ON source_observations(normalized_source_name);
CREATE INDEX idx_so_vendor_scraped     ON source_observations(vendor_inferred, scraped_at DESC);

-- Append-only enforcement, matching price_history's posture.
CREATE TRIGGER source_observations_no_update
BEFORE UPDATE ON source_observations
BEGIN
  SELECT RAISE(ABORT, 'source_observations is append-only: UPDATE is not allowed');
END;

CREATE TRIGGER source_observations_no_delete
BEFORE DELETE ON source_observations
BEGIN
  SELECT RAISE(ABORT, 'source_observations is append-only: DELETE is not allowed');
END;
