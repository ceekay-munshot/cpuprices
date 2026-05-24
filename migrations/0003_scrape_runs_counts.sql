-- 0003_scrape_runs_counts.sql
-- Disambiguate scrape_runs accounting now that a single run writes to two
-- tables (source_observations + price_history).
--
-- Original column:
--   rows_found    = total rows the source page returned   (unchanged here)
--   rows_inserted = rows inserted into the curated table  (kept; writes
--                   continue to set it equal to price_history_inserted for
--                   back-compat with earlier scrape_runs rows)
--
-- New explicit columns (all nullable so legacy rows stay valid):
--   observations_inserted   - rows inserted into source_observations
--   price_history_inserted  - rows inserted into price_history
--   tracked_skus_matched    - tracked canonical SKUs that matched
--   tracked_skus_missing    - tracked canonical SKUs that did not match
--
-- Going forward, the four new columns are the source of truth. rows_inserted
-- remains populated only for continuity with rows written before this
-- migration.

ALTER TABLE scrape_runs ADD COLUMN observations_inserted  INTEGER;
ALTER TABLE scrape_runs ADD COLUMN price_history_inserted INTEGER;
ALTER TABLE scrape_runs ADD COLUMN tracked_skus_matched   INTEGER;
ALTER TABLE scrape_runs ADD COLUMN tracked_skus_missing   INTEGER;
