-- 15 Nov 2026: INJ (Injective) added as a range market. SQLite cannot change a CHECK constraint, so the
-- table is rebuilt with the same columns and data.
CREATE TABLE range_levels_new (
  asset TEXT PRIMARY KEY CHECK (asset IN ('BTC', 'ETH', 'SPX', 'NDX', 'INJ')),
  range_high TEXT NOT NULL,
  mid TEXT NOT NULL DEFAULT '',
  range_low TEXT NOT NULL,
  set_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  proxy_ratio TEXT NOT NULL DEFAULT '',
  watch_levels TEXT NOT NULL DEFAULT '',
  long_trigger_4h TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  trigger_tf TEXT NOT NULL DEFAULT ''
);
INSERT INTO range_levels_new (asset, range_high, mid, range_low, set_on, note, proxy_ratio, watch_levels, long_trigger_4h, updated_at, updated_by, trigger_tf)
  SELECT asset, range_high, mid, range_low, set_on, note, proxy_ratio, watch_levels, long_trigger_4h, updated_at, updated_by, trigger_tf FROM range_levels;
DROP TABLE range_levels;
ALTER TABLE range_levels_new RENAME TO range_levels;
