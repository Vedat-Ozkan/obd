-- T2.10c development policy. Re-running this schema never restores uses/headroom.
CREATE TABLE IF NOT EXISTS summary_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  uses INTEGER NOT NULL CHECK (uses BETWEEN 0 AND 4),
  spent INTEGER NOT NULL CHECK (spent >= 0),
  inflight TEXT,
  disabled INTEGER NOT NULL CHECK (disabled IN (0, 1))
);
INSERT OR IGNORE INTO summary_budget (id, uses, spent, inflight, disabled) VALUES (1, 0, 0, NULL, 0);
CREATE TABLE IF NOT EXISTS summary_requests (
  request_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('inflight', 'settled')),
  reservation INTEGER NOT NULL CHECK (reservation = 315802),
  actual INTEGER CHECK (actual >= 0),
  error TEXT CHECK (error IS NULL OR error IN ('provider-error', 'invalid-response'))
);
