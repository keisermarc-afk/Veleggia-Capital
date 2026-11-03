-- Step 3: alerts, push subscriptions, small key/value store (alert state, VAPID key pair), run log.
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,            -- Zurich time "yyyy-mm-dd hh:mm"
  key TEXT NOT NULL UNIQUE,    -- one alert per event, never repeated
  asset TEXT NOT NULL,
  type TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('warn', 'good', 'info')),
  message TEXT NOT NULL
);

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE TABLE app_kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  n_alerts INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  ms INTEGER NOT NULL DEFAULT 0
);
