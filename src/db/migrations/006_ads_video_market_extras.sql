-- Ads can carry a video; market items get an expiry date, a featured flag, seller stats, and can be saved by buyers.
ALTER TABLE ads ADD COLUMN video_url TEXT;
ALTER TABLE ads ADD COLUMN video_media_uid TEXT;

-- An item is shown for a set number of days, then drops out of the market until its seller renews it (status stays 'live').
ALTER TABLE market_items ADD COLUMN expires_at INTEGER;
ALTER TABLE market_items ADD COLUMN expiry_notified_at INTEGER;
ALTER TABLE market_items ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1));
ALTER TABLE market_items ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE market_items ADD COLUMN contacts INTEGER NOT NULL DEFAULT 0;
-- Items that already exist get a full 60 days from now.
UPDATE market_items SET expires_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 5184000000 WHERE status IN ('live', 'pending', 'sold', 'hidden');
CREATE INDEX idx_items_expiry ON market_items (status, expires_at);

CREATE TABLE market_saved (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES market_items (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX idx_market_saved_item ON market_saved (item_id);

-- One view and one contact per visitor per item per day, so the seller's numbers are not inflated by refreshing.
CREATE TABLE market_events (
  item_id INTEGER NOT NULL REFERENCES market_items (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('view', 'contact')),
  day INTEGER NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (item_id, kind, day, visitor)
);
CREATE INDEX idx_market_events_day ON market_events (day);
