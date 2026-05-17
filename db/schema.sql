-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  nickname TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  last_provider TEXT,
  points INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(provider, provider_id)
);

-- Refresh tokens table
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- Purchases table
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  game_id TEXT NOT NULL,
  amount_paid INTEGER NOT NULL,
  points_used INTEGER DEFAULT 0,
  coupon_id INTEGER REFERENCES coupons(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Game completions table
CREATE TABLE IF NOT EXISTS game_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  game_id TEXT NOT NULL,
  room_code TEXT,
  role TEXT,
  ending_id TEXT,
  mission_score INTEGER DEFAULT 0,
  won INTEGER DEFAULT 0,
  points_awarded INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Coupons table
CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  code TEXT UNIQUE NOT NULL,
  discount_amount INTEGER NOT NULL,
  game_id TEXT,
  used INTEGER DEFAULT 0,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_purchases_user_game ON purchases(user_id, game_id);
CREATE INDEX IF NOT EXISTS idx_completions_user_game ON game_completions(user_id, game_id);
CREATE INDEX IF NOT EXISTS idx_coupons_user ON coupons(user_id);
