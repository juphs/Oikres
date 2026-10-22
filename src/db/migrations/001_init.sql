-- Oikres schema v1. Times are epoch milliseconds (UTC). Money is whole naira.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  email_verified_at INTEGER,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  is_lister INTEGER NOT NULL DEFAULT 0 CHECK (is_lister IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  phone TEXT,
  notify_email INTEGER NOT NULL DEFAULT 1 CHECK (notify_email IN (0, 1)),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  password_changed_at INTEGER,
  last_login_at INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

CREATE TABLE tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX idx_tokens_user ON tokens (user_id, purpose);

CREATE TABLE lister_profiles (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  business_name TEXT,
  type TEXT NOT NULL DEFAULT 'agent' CHECK (type IN ('agent', 'landlord')),
  whatsapp_number TEXT NOT NULL,
  phone_verified INTEGER NOT NULL DEFAULT 0 CHECK (phone_verified IN (0, 1)),
  phone_verified_at INTEGER,
  phone_verified_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  id_status TEXT NOT NULL DEFAULT 'none' CHECK (id_status IN ('none', 'submitted', 'approved', 'rejected')),
  id_type TEXT,
  id_checked INTEGER NOT NULL DEFAULT 0 CHECK (id_checked IN (0, 1)),
  id_checked_at INTEGER,
  id_checked_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  id_file TEXT,
  id_uploaded_at INTEGER,
  id_purge_after INTEGER,
  id_note TEXT,
  admin_notes TEXT,
  plan_tier TEXT NOT NULL DEFAULT 'free',
  plan_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_profiles_purge ON lister_profiles (id_purge_after);

CREATE TABLE areas (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 100
);
CREATE TABLE junctions (
  id INTEGER PRIMARY KEY,
  area_id INTEGER NOT NULL REFERENCES areas (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (area_id, name)
);

CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  lister_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lister_profile_id INTEGER NOT NULL REFERENCES lister_profiles (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  property_type TEXT,
  area_id INTEGER REFERENCES areas (id) ON DELETE SET NULL,
  junction TEXT,
  minutes_walk INTEGER,
  minutes_keke INTEGER,
  charges_disclosed INTEGER NOT NULL DEFAULT 0 CHECK (charges_disclosed IN (0, 1)),
  price_from INTEGER NOT NULL DEFAULT 0 CHECK (price_from >= 0),
  period_from TEXT NOT NULL DEFAULT 'year',
  move_in_from INTEGER NOT NULL DEFAULT 0 CHECK (move_in_from >= 0),
  price_yearly INTEGER NOT NULL DEFAULT 0 CHECK (price_yearly >= 0),
  has_room_share INTEGER NOT NULL DEFAULT 0 CHECK (has_room_share IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'live', 'needs_reconfirm', 'hidden', 'rejected', 'rented', 'suspended', 'deleted')),
  hidden_reason TEXT CHECK (hidden_reason IS NULL OR hidden_reason IN ('stale', 'reports', 'admin')),
  rejection_reason TEXT,
  submitted_at INTEGER,
  published_at INTEGER,
  last_confirmed_at INTEGER,
  reconfirm_due_at INTEGER,
  reminder_sent_at INTEGER,
  rented_at INTEGER,
  visited_done INTEGER NOT NULL DEFAULT 0 CHECK (visited_done IN (0, 1)),
  visited_at INTEGER,
  visited_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  visited_note TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  contact_clicks INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  plan_tier TEXT NOT NULL DEFAULT 'free',
  featured_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_listings_status_pub ON listings (status, published_at DESC);
CREATE INDEX idx_listings_status_area ON listings (status, area_id, price_yearly);
CREATE INDEX idx_listings_lister ON listings (lister_id, status);
CREATE INDEX idx_listings_due ON listings (status, reconfirm_due_at);

CREATE TABLE listing_units (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('whole_unit', 'private_room', 'shared_room')),
  spaces_total INTEGER NOT NULL DEFAULT 1 CHECK (spaces_total >= 1),
  spaces_available INTEGER NOT NULL DEFAULT 1 CHECK (spaces_available >= 0),
  rent INTEGER NOT NULL DEFAULT 0 CHECK (rent >= 0),
  period TEXT NOT NULL DEFAULT 'year' CHECK (period IN ('year', 'semester', 'month')),
  gender_preference TEXT NOT NULL DEFAULT 'any' CHECK (gender_preference IN ('any', 'male', 'female')),
  shared_facilities TEXT NOT NULL DEFAULT '',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'partly_taken', 'full')),
  move_in_total INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_units_listing ON listing_units (listing_id, position);

CREATE TABLE listing_fees (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  custom_label TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('fixed', 'percent')),
  value REAL NOT NULL CHECK (value >= 0),
  payee TEXT NOT NULL CHECK (payee IN ('agent', 'landlord', 'oikres')),
  refundable INTEGER NOT NULL DEFAULT 0 CHECK (refundable IN (0, 1)),
  note TEXT
);
CREATE INDEX idx_fees_listing ON listing_fees (listing_id, position);

CREATE TABLE listing_media (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL CHECK (type IN ('image', 'video')),
  url TEXT NOT NULL,
  thumb_url TEXT,
  public_id TEXT,
  media_uid TEXT,
  width INTEGER,
  height INTEGER
);
CREATE INDEX idx_media_listing ON listing_media (listing_id, position);

CREATE TABLE listing_amenities (
  listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  amenity TEXT NOT NULL,
  PRIMARY KEY (listing_id, amenity)
);

-- Files uploaded to this server (and tracking so unused uploads can be cleaned up).
CREATE TABLE media_files (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'video', 'id')),
  file TEXT NOT NULL,
  thumb_file TEXT,
  width INTEGER,
  height INTEGER,
  size INTEGER NOT NULL DEFAULT 0,
  attached INTEGER NOT NULL DEFAULT 0 CHECK (attached IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_media_files_orphans ON media_files (attached, created_at);

CREATE TABLE wishlists (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  listing_id INTEGER REFERENCES listings (id) ON DELETE CASCADE,
  anon_id TEXT,
  user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  at INTEGER NOT NULL
);
CREATE INDEX idx_events_dedupe ON events (type, listing_id, anon_id, at);
CREATE INDEX idx_events_at ON events (at);

CREATE TABLE contact_feedback (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  anon_id TEXT,
  user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  replied INTEGER NOT NULL CHECK (replied IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_feedback_listing ON contact_feedback (listing_id, anon_id, created_at);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
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
CREATE INDEX idx_reports_listing ON reports (listing_id, reporter_key, status);
CREATE INDEX idx_reports_status ON reports (status, created_at DESC);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type TEXT,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications (user_id, read_at, created_at DESC);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  actor_label TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX idx_audit_at ON audit_log (at DESC);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
