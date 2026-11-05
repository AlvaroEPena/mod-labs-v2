-- Reviews (spec §17). Stores only what the reviewer agreed to publish: no email, IP address or other
-- personal data. Times are epoch milliseconds. Rows stay 'pending' (never shown) until the owner
-- approves them through a signed link; a delete removes the row.
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
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
