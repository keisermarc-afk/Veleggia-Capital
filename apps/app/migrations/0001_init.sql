-- Range levels: one row per asset, values stored as typed (text), in the dashboard's CSV columns.
CREATE TABLE range_levels (
  asset TEXT PRIMARY KEY CHECK (asset IN ('BTC', 'ETH', 'SPX', 'NDX')),
  range_high TEXT NOT NULL,
  mid TEXT NOT NULL DEFAULT '',
  range_low TEXT NOT NULL,
  set_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  proxy_ratio TEXT NOT NULL DEFAULT '',
  watch_levels TEXT NOT NULL DEFAULT '',
  long_trigger_4h TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

-- Every save, kept: Marc's level history.
CREATE TABLE range_levels_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset TEXT NOT NULL,
  data TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  saved_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX range_levels_history_asset ON range_levels_history (asset, id);

-- The current week's plan, in the dashboard's CSV columns.
CREATE TABLE weekly_plan (
  pos INTEGER NOT NULL,
  id TEXT PRIMARY KEY,
  week TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  written TEXT NOT NULL,
  section TEXT NOT NULL CHECK (section IN ('headline', 'exit', 'long', 'short', 'rule', 'risk')),
  asset TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  "trigger" TEXT NOT NULL DEFAULT '',
  stop TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '',
  risk_class TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);

-- Every saved plan, kept whole.
CREATE TABLE weekly_plan_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week TEXT NOT NULL,
  data TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  saved_by TEXT NOT NULL DEFAULT ''
);
