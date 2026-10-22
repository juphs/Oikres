-- Places (state > campus, areas belong to a state), marketplace, public reviews, reports on items/people/reviews, and account bans.
-- Never edit this file once it has been applied: add a new numbered file instead.

-- ---- States and campuses. The launch market (Anambra, UNIZIK) is created here so existing areas and lodges can be attached to it.
CREATE TABLE states (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 100
);
CREATE TABLE campuses (
  id INTEGER PRIMARY KEY,
  state_id INTEGER NOT NULL REFERENCES states (id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 100
);
CREATE INDEX idx_campuses_state ON campuses (state_id, sort_order);
INSERT INTO states (name, slug, sort_order) VALUES ('Anambra', 'anambra', 1);
INSERT INTO campuses (state_id, name, slug, sort_order) VALUES ((SELECT id FROM states WHERE slug = 'anambra'), 'UNIZIK', 'unizik', 1);

-- Existing areas and lodges all belong to the launch market.
ALTER TABLE areas ADD COLUMN state_id INTEGER REFERENCES states (id);
UPDATE areas SET state_id = (SELECT id FROM states WHERE slug = 'anambra');
CREATE INDEX idx_areas_state ON areas (state_id, sort_order);

ALTER TABLE listings ADD COLUMN state_id INTEGER REFERENCES states (id) ON DELETE SET NULL;
ALTER TABLE listings ADD COLUMN campus_id INTEGER REFERENCES campuses (id) ON DELETE SET NULL;
UPDATE listings SET state_id = (SELECT id FROM states WHERE slug = 'anambra'), campus_id = (SELECT id FROM campuses WHERE slug = 'unizik');
CREATE INDEX idx_listings_place ON listings (status, state_id, campus_id);

-- ---- Account bans. A banned account also has status 'suspended', so every existing sign-in and session check already blocks it.
ALTER TABLE users ADD COLUMN banned_at INTEGER;
ALTER TABLE users ADD COLUMN ban_reason TEXT;
ALTER TABLE users ADD COLUMN banned_by INTEGER REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX idx_users_banned ON users (banned_at) WHERE banned_at IS NOT NULL;

-- ---- Marketplace
CREATE TABLE market_items (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  seller_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  item_condition TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  negotiable INTEGER NOT NULL DEFAULT 0 CHECK (negotiable IN (0, 1)),
  state_id INTEGER REFERENCES states (id) ON DELETE SET NULL,
  campus_id INTEGER REFERENCES campuses (id) ON DELETE SET NULL,
  pickup TEXT,
  whatsapp_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('pending', 'live', 'sold', 'hidden', 'deleted')),
  hidden_reason TEXT CHECK (hidden_reason IS NULL OR hidden_reason IN ('reports', 'admin', 'banned')),
  report_count INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER,
  sold_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_items_status_pub ON market_items (status, published_at DESC);
CREATE INDEX idx_items_status_cat ON market_items (status, category, price);
CREATE INDEX idx_items_place ON market_items (status, state_id, campus_id);
CREATE INDEX idx_items_seller ON market_items (seller_id, status);

CREATE TABLE market_media (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES market_items (id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  url TEXT NOT NULL,
  thumb_url TEXT,
  public_id TEXT,
  media_uid TEXT,
  width INTEGER,
  height INTEGER
);
CREATE INDEX idx_market_media_item ON market_media (item_id, position);

-- ---- Public reviews: one per reviewer per person, 1 to 5 stars, optional comment. Admins can remove (soft) abusive ones.
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  subject_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'removed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (subject_id, author_id),
  CHECK (subject_id != author_id)
);
CREATE INDEX idx_reviews_subject ON reviews (subject_id, status, created_at DESC);
CREATE INDEX idx_reviews_author ON reviews (author_id);

-- ---- Reports about market items, people and reviews (lodge reports keep their own table).
-- subject_user_id is the account responsible, so an administrator sees everything reported against one person in one place.
CREATE TABLE abuse_reports (
  id INTEGER PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('item', 'user', 'review')),
  target_id INTEGER NOT NULL,
  subject_user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reporter_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  reporter_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  handled_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  handled_at INTEGER,
  resolution_note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_abuse_target ON abuse_reports (target_type, target_id, reporter_key, status);
CREATE INDEX idx_abuse_status ON abuse_reports (status, target_type, created_at DESC);
CREATE INDEX idx_abuse_subject ON abuse_reports (subject_user_id, status);

-- ---- Ads: created by administrators, shown as cards inside the lodge list and/or the market list.
-- An ad is an image or text card with a button that opens a web page, a page on this site, or a WhatsApp chat.
CREATE TABLE ads (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT,
  image_url TEXT,
  thumb_url TEXT,
  media_uid TEXT,
  sponsor TEXT,
  badge TEXT,
  button_label TEXT,
  link_type TEXT NOT NULL DEFAULT 'url' CHECK (link_type IN ('url', 'page', 'whatsapp', 'none')),
  link_value TEXT,
  placement TEXT NOT NULL DEFAULT 'both' CHECK (placement IN ('lodges', 'market', 'both')),
  state_id INTEGER REFERENCES states (id) ON DELETE SET NULL,
  campus_id INTEGER REFERENCES campuses (id) ON DELETE SET NULL,
  starts_at INTEGER,
  ends_at INTEGER,
  position INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_ads_active ON ads (is_active, placement, position);
