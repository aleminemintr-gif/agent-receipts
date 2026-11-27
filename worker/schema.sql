CREATE TABLE IF NOT EXISTS accounts (
  key_hash TEXT PRIMARY KEY, id TEXT NOT NULL, label TEXT, created TEXT,
  early_rank INTEGER, points INTEGER NOT NULL, day TEXT, used_today INTEGER NOT NULL DEFAULT 0,
  total_receipts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS receipts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hits (k TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS hits_k ON hits(k, ts);
CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, check_kind TEXT NOT NULL, params TEXT NOT NULL, claim TEXT,
  after_minutes INTEGER NOT NULL, due_at TEXT NOT NULL, baseline_receipt TEXT NOT NULL, baseline_fp TEXT NOT NULL,
  status TEXT NOT NULL, result_receipt TEXT, drift INTEGER, created TEXT, done_at TEXT
);
CREATE INDEX IF NOT EXISTS watches_due ON watches(status, due_at);
CREATE TABLE IF NOT EXISTS payments (
  tx TEXT PRIMARY KEY, payer TEXT, network TEXT, asset TEXT, amount TEXT, kind TEXT, account_id TEXT, at TEXT
);
