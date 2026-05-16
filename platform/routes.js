const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { signup, login, oauthLogin, verifyToken } = require('../lib/auth');
const { requireAuth, optionalAuth } = require('../lib/middleware');
const points = require('../lib/points');
const db = require('../lib/db');

// --- Game catalog ---
const GAMES = [
  {
    id: 'fork',
    title: 'Fork',
    subtitle: '갈라진 의도',
    description: '자율시스템 연구실에서 벌어진 살인 사건. 두 조교 중 한 명은 범인, 한 명은 탐정이 되어 진실을 밝혀야 합니다.',
    price: 20000,
    players: 2,
    duration: '60~90분',
    coverImage: '/platform-assets/fork-cover.png',
    available: true,
  },
];

// ==========================================================================
// AUTH ROUTES
// ==========================================================================

// POST /api/auth/signup
router.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, nickname } = req.body;

    if (!email || !password || !nickname) {
      return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
    }

    const result = await signup(email, password, nickname);
    res.json({
      user: { id: result.user.id, email: result.user.email, nickname: result.user.nickname, points: result.user.points },
      token: result.token,
      couponCode: result.couponCode,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
    }

    const result = await login(email, password);
    res.json({
      user: { id: result.user.id, email: result.user.email, nickname: result.user.nickname, points: result.user.points },
      token: result.token,
    });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// GET /api/auth/kakao — redirect to Kakao OAuth
router.get('/auth/kakao', (req, res) => {
  const clientId = process.env.KAKAO_CLIENT_ID;
  const redirectUri = process.env.KAKAO_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/kakao/callback`;
  if (!clientId) return res.status(500).json({ error: 'Kakao OAuth not configured' });

  const url = `https://kauth.kakao.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
  res.redirect(url);
});

// GET /api/auth/kakao/callback
router.get('/auth/kakao/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const clientId = process.env.KAKAO_CLIENT_ID;
    const clientSecret = process.env.KAKAO_CLIENT_SECRET || '';
    const redirectUri = process.env.KAKAO_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/kakao/callback`;

    // Exchange code for token
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tokenData = await tokenRes.json();

    // Get user info
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();

    const profile = {
      id: String(userData.id),
      email: userData.kakao_account?.email,
      nickname: userData.kakao_account?.profile?.nickname || '카카오 사용자',
    };

    const result = oauthLogin('kakao', profile);
    // Redirect to frontend with token
    res.redirect(`/?token=${result.token}`);
  } catch (err) {
    res.redirect('/?error=oauth_failed');
  }
});

// GET /api/auth/google — redirect to Google OAuth
router.get('/auth/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  if (!clientId) return res.status(500).json({ error: 'Google OAuth not configured' });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=email%20profile`;
  res.redirect(url);
});

// GET /api/auth/google/callback
router.get('/auth/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;

    // Exchange code for token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tokenData = await tokenRes.json();

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();

    const profile = {
      id: userData.id,
      email: userData.email,
      nickname: userData.name || '구글 사용자',
    };

    const result = oauthLogin('google', profile);
    res.redirect(`/?token=${result.token}`);
  } catch (err) {
    res.redirect('/?error=oauth_failed');
  }
});

// ==========================================================================
// USER ROUTES
// ==========================================================================

// GET /api/user/me
router.get('/user/me', requireAuth, (req, res) => {
  const user = req.user;
  const coupons = db.prepare(
    'SELECT id, code, discount_amount, game_id, used, expires_at FROM coupons WHERE user_id = ? AND used = 0'
  ).all(user.id);

  res.json({
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    points: user.points,
    coupons,
  });
});

// GET /api/user/history
router.get('/user/history', requireAuth, (req, res) => {
  const completions = db.prepare(
    'SELECT game_id, role, ending_id, mission_score, won, points_awarded, created_at FROM game_completions WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);

  const purchases = db.prepare(
    'SELECT game_id, amount_paid, points_used, created_at FROM purchases WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);

  res.json({ completions, purchases });
});

// ==========================================================================
// GAME ROUTES
// ==========================================================================

// GET /api/games
router.get('/games', optionalAuth, (req, res) => {
  const gameList = GAMES.map((g) => {
    const purchased = req.user ? points.hasPurchased(req.user.id, g.id) : false;
    return { ...g, purchased };
  });
  res.json(gameList);
});

// GET /api/games/:id
router.get('/games/:id', optionalAuth, (req, res) => {
  const game = GAMES.find((g) => g.id === req.params.id);
  if (!game) return res.status(404).json({ error: '게임을 찾을 수 없습니다.' });

  const purchased = req.user ? points.hasPurchased(req.user.id, game.id) : false;
  res.json({ ...game, purchased });
});

// POST /api/games/:id/purchase
router.post('/games/:id/purchase', requireAuth, async (req, res) => {
  const game = GAMES.find((g) => g.id === req.params.id);
  if (!game) return res.status(404).json({ error: '게임을 찾을 수 없습니다.' });

  // Check if already purchased
  if (points.hasPurchased(req.user.id, game.id)) {
    return res.status(400).json({ error: '이미 구매한 게임입니다.' });
  }

  const { pointsToUse = 0, couponCode } = req.body;
  let discount = 0;
  let couponId = null;

  // Apply coupon if provided
  if (couponCode) {
    const coupon = db.prepare(
      'SELECT * FROM coupons WHERE user_id = ? AND code = ? AND used = 0'
    ).get(req.user.id, couponCode);

    if (!coupon) {
      return res.status(400).json({ error: '유효하지 않은 쿠폰입니다.' });
    }
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return res.status(400).json({ error: '만료된 쿠폰입니다.' });
    }
    if (coupon.game_id && coupon.game_id !== game.id) {
      return res.status(400).json({ error: '이 게임에 사용할 수 없는 쿠폰입니다.' });
    }

    discount = coupon.discount_amount;
    couponId = coupon.id;
  }

  // Apply points
  const maxPointsUsable = game.price - discount;
  const actualPointsUsed = Math.min(pointsToUse, maxPointsUsable, req.user.points);

  if (actualPointsUsed > 0 && !points.usePoints(req.user.id, actualPointsUsed)) {
    return res.status(400).json({ error: '포인트가 부족합니다.' });
  }

  const amountPaid = game.price - discount - actualPointsUsed;

  // Record purchase
  db.prepare(
    'INSERT INTO purchases (user_id, game_id, amount_paid, points_used, coupon_id) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.id, game.id, amountPaid, actualPointsUsed, couponId);

  // Mark coupon as used
  if (couponId) {
    db.prepare('UPDATE coupons SET used = 1 WHERE id = ?').run(couponId);
  }

  // Award purchase points (+2P)
  points.awardPurchasePoints(req.user.id);

  // Refresh user data
  const updatedUser = db.prepare('SELECT points FROM users WHERE id = ?').get(req.user.id);

  res.json({
    success: true,
    amountPaid,
    pointsUsed: actualPointsUsed,
    discountApplied: discount,
    newPointsBalance: updatedUser.points,
  });
});

// GET /api/games/:id/access
router.get('/games/:id/access', requireAuth, (req, res) => {
  const hasAccess = points.hasPurchased(req.user.id, req.params.id);
  res.json({ hasAccess });
});

// POST /api/games/:id/complete — called by game server after game ends
router.post('/games/:id/complete', requireAuth, (req, res) => {
  const { roomCode, role, endingId, missionScore, won } = req.body;
  const gameId = req.params.id;

  const awarded = points.recordGameCompletion(req.user.id, gameId, {
    roomCode,
    role,
    endingId,
    missionScore,
    won,
  });

  const updatedUser = db.prepare('SELECT points FROM users WHERE id = ?').get(req.user.id);

  res.json({
    pointsAwarded: awarded,
    newPointsBalance: updatedUser.points,
  });
});

module.exports = router;
