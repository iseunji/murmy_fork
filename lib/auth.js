const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'murmy-dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';
const SALT_ROUNDS = 10;

// --- Prepared statements ---
const insertUser = db.prepare(
  'INSERT INTO users (email, password_hash, nickname, provider, provider_id) VALUES (?, ?, ?, ?, ?)'
);
const findByEmail = db.prepare('SELECT * FROM users WHERE email = ? AND provider = ?');
const findById = db.prepare('SELECT * FROM users WHERE id = ?');
const findByProvider = db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?');
const insertCoupon = db.prepare(
  'INSERT INTO coupons (user_id, code, discount_amount, expires_at) VALUES (?, ?, ?, ?)'
);

// --- Auth functions ---

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, nickname: user.nickname },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

async function signup(email, password, nickname) {
  // Check if email already exists
  const existing = findByEmail.get(email, 'email');
  if (existing) {
    throw new Error('이미 가입된 이메일입니다.');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = insertUser.run(email, passwordHash, nickname, 'email', null);
  const userId = result.lastInsertRowid;

  // Generate welcome coupon (2000원 할인)
  const couponCode = 'WELCOME-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days
  insertCoupon.run(userId, couponCode, 2000, expiresAt);

  const user = findById.get(userId);
  return { user, token: generateToken(user), couponCode };
}

async function login(email, password) {
  const user = findByEmail.get(email, 'email');
  if (!user) {
    throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new Error('이메일 또는 비밀번��가 올바르지 않습니다.');
  }

  return { user, token: generateToken(user) };
}

function oauthLogin(provider, profile) {
  // Check if user exists with this provider
  let user = findByProvider.get(provider, profile.id);

  if (!user) {
    // Check if email exists (link accounts)
    if (profile.email) {
      user = findByEmail.get(profile.email, 'email');
      if (user) {
        // Update existing user with OAuth info
        db.prepare('UPDATE users SET provider = ?, provider_id = ? WHERE id = ?')
          .run(provider, profile.id, user.id);
        user = findById.get(user.id);
      }
    }

    if (!user) {
      // Create new user
      const result = insertUser.run(
        profile.email || `${provider}_${profile.id}@oauth.local`,
        null,
        profile.nickname || profile.name || '사용자',
        provider,
        profile.id
      );
      const userId = result.lastInsertRowid;

      // Welcome coupon
      const couponCode = 'WELCOME-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      insertCoupon.run(userId, couponCode, 2000, expiresAt);

      user = findById.get(userId);
    }
  }

  return { user, token: generateToken(user) };
}

module.exports = {
  signup,
  login,
  oauthLogin,
  verifyToken,
  generateToken,
  findById,
  JWT_SECRET,
};
