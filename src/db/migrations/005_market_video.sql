-- Market items can carry one walkthrough/demo video next to their photos.
ALTER TABLE market_media ADD COLUMN type TEXT NOT NULL DEFAULT 'image' CHECK (type IN ('image', 'video'));
