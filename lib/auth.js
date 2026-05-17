const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'murmy-dev-secret-change-in-production';
const ACCESS_TOKEN_EXPIRES = '1h';
const REFRESH_TOKEN_DAYS = 30;

// --- Prepared statements ---
const insertUser = db.prepare(
  'INSERT INTO users (email, nickname, provider, provider_id, last_provider) VALUES (?, ?, ?, ?, ?)'
);
const findById = db.prepare('SELECT * FROM users WHERE id = ?');
const findByProvider = db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?');
const insertCoupon = db.prepare(
  'INSERT INTO coupons (user_id, code, discount_amount, expires_at) VALUES (?, ?, ?, ?)'
);
const insertRefreshToken = db.prepare(
  'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)'
);
const findRefreshToken = db.prepare(
  'SELECT * FROM refresh_tokens WHERE token = ?'
);
const deleteRefreshToken = db.prepare(
  'DELETE FROM refresh_tokens WHERE token = ?'
);
const deleteUserRefreshTokens = db.prepare(
  'DELETE FROM refresh_tokens WHERE user_id = ?'
);
const updateLastProvider = db.prepare(
  'UPDATE users SET last_provider = ? WHERE id = ?'
);

// --- Token functions ---

function generateAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, nickname: user.nickname },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES }
  );
}

function generateRefreshToken(userId) {
  const token = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  insertRefreshToken.run(userId, token, expiresAt);
  return { token, expiresAt };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function refreshAccessToken(refreshToken) {
  const record = findRefreshToken.get(refreshToken);
  if (!record) return null;

  // Check expiry
  if (new Date(record.expires_at) < new Date()) {
    deleteRefreshToken.run(refreshToken);
    return null;
  }

  const user = findById.get(record.user_id);
  if (!user) return null;

  // Rotate refresh token (delete old, create new)
  deleteRefreshToken.run(refreshToken);
  const newRefresh = generateRefreshToken(user.id);
  const accessToken = generateAccessToken(user);

  return { accessToken, refreshToken: newRefresh.token, user };
}

// --- OAuth login/signup ---

function oauthLogin(provider, profile) {
  // Check if user exists with this provider
  let user = findByProvider.get(provider, profile.id);
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    // Create new user
    const result = insertUser.run(
      profile.email || null,
      profile.nickname || profile.name || '사용자',
      provider,
      profile.id,
      provider
    );
    const userId = result.lastInsertRowid;

    // Welcome coupon (2000원 할인, 90일)
    const couponCode = 'WELCOME-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    insertCoupon.run(userId, couponCode, 2000, expiresAt);

    user = findById.get(userId);
  }

  // Update last_provider
  updateLastProvider.run(provider, user.id);

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refresh = generateRefreshToken(user.id);

  return { user, accessToken, refreshToken: refresh.token, isNewUser };
}

function logout(refreshToken) {
  if (refreshToken) {
    deleteRefreshToken.run(refreshToken);
  }
}

function logoutAll(userId) {
  deleteUserRefreshTokens.run(userId);
}

module.exports = {
  oauthLogin,
  verifyToken,
  generateAccessToken,
  refreshAccessToken,
  logout,
  logoutAll,
  findById,
  JWT_SECRET,
};
