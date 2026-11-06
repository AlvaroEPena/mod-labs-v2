-- Reviews (spec §17). Stores only what the reviewer agreed to publish: no email, IP address or other
-- personal data. Times are epoch milliseconds. Rows stay 'pending' (never shown) until the owner
-- approves them through a signed link. A delete removes the row.
CREATE TABLE reviews (
  -- AUTOINCREMENT: an id is never handed out twice, even after the newest row is deleted, so a signed
  -- moderation link for a deleted review can never approve or delete a later one (spec §18).
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  service TEXT,
  source TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  -- an approved review always has its approval time, a pending one never does
  CHECK ((status = 'approved') = (approved_at IS NOT NULL))
);

-- The published list (newest approval first). Partial index: queries must filter status = 'approved'.
CREATE INDEX idx_reviews_approved ON reviews (approved_at DESC, id DESC) WHERE status = 'approved';

-- The rolling 24 h submission cap counts rows by creation time.
CREATE INDEX idx_reviews_created_at ON reviews (created_at);

-- Per-visitor daily review counts (spec §18). `key` is HMAC(per-day key, IPv4 address or IPv6 /64), see
-- worker/reviews/visitor-limit.ts: the address is never stored, and a new key every UTC day means buckets
-- can't be linked across days. Rows from before yesterday are purged on later submissions.
CREATE TABLE review_limits (
  key TEXT PRIMARY KEY,
  -- UTC day as yyyy-mm-dd (fixed width, so the purge can compare it as text)
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  count INTEGER NOT NULL CHECK (count >= 1)
) WITHOUT ROWID;

CREATE INDEX idx_review_limits_day ON review_limits (day);
