-- T2.10c development policy. Re-running this schema never restores uses/headroom.
-- It also migrates a legacy database (uses <= 4, reservation = 315802) in place: each table is
-- rebuilt through a _next copy on every run, without an explicit transaction. The order is
-- self-healing: a run interrupted after a DROP leaves the copied _next table, and the next run's
-- INSERT OR IGNORE keeps that copy over a freshly inserted default row.
CREATE TABLE IF NOT EXISTS summary_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  uses INTEGER NOT NULL CHECK (uses >= 0),
  spent INTEGER NOT NULL CHECK (spent >= 0),
  inflight TEXT,
  disabled INTEGER NOT NULL CHECK (disabled IN (0, 1))
);
INSERT OR IGNORE INTO summary_budget (id, uses, spent, inflight, disabled) VALUES (1, 0, 0, NULL, 0);
CREATE TABLE IF NOT EXISTS summary_budget_next (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  uses INTEGER NOT NULL CHECK (uses >= 0),
  spent INTEGER NOT NULL CHECK (spent >= 0),
  inflight TEXT,
  disabled INTEGER NOT NULL CHECK (disabled IN (0, 1))
);
INSERT OR IGNORE INTO summary_budget_next SELECT id, uses, spent, inflight, disabled FROM summary_budget;
DROP TABLE summary_budget;
ALTER TABLE summary_budget_next RENAME TO summary_budget;
CREATE TABLE IF NOT EXISTS summary_requests (
  request_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('inflight', 'settled')),
  reservation INTEGER NOT NULL CHECK (reservation BETWEEN 1 AND 315802),
  actual INTEGER CHECK (actual >= 0),
  error TEXT CHECK (error IS NULL OR error IN ('provider-error', 'invalid-response'))
);
CREATE TABLE IF NOT EXISTS summary_requests_next (
  request_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('inflight', 'settled')),
  reservation INTEGER NOT NULL CHECK (reservation BETWEEN 1 AND 315802),
  actual INTEGER CHECK (actual >= 0),
  error TEXT CHECK (error IS NULL OR error IN ('provider-error', 'invalid-response'))
);
INSERT OR IGNORE INTO summary_requests_next SELECT request_id, state, reservation, actual, error FROM summary_requests;
DROP TABLE summary_requests;
ALTER TABLE summary_requests_next RENAME TO summary_requests;
