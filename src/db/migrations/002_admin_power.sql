-- Admin tools: private notes on users, and featured lodges (shown first in search).
ALTER TABLE users ADD COLUMN admin_notes TEXT;
ALTER TABLE listings ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1));
CREATE INDEX idx_listings_featured ON listings (status, is_featured DESC, published_at DESC);
