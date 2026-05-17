const express = require('express');
const router = express.Router();
const { oauthLogin, refreshAccessToken, logout } = require('../lib/auth');
const { requireAuth, optionalAuth } = require('../lib/middleware');
const points = require('../lib/points');
const db = require('../lib/db');

// --- Game catalog ---
const GAMES = [
  {
    id: 'fork',
    title: 'Fork',
    subtitle: '갈라진 의도',
    description: '자율시스템 연구실에서 벌어진 살인 사건. 사건의 진실을 밝혀야 합니다.',
    price: 20000,
    players: 2,
    duration: '60~80분',
    coverBg: '/games/fork/assets/kraft-texture.png',
    coverLogo: '/games/fork/assets/Title.png',
    coverIllust: '/platform-assets/title-illustration.png',
    coverCharacters: ['/games/fork/assets/Hajin.png', '/games/fork/assets/Dohyun.png'],
    available: true,
  },
];

// ==========================================================================
// AUTH ROUTES — OAuth only
// ==========================================================================

// --- Kakao OAuth ---
router.get('/auth/kakao', (req, res) => {
  const clientId = process.env.KAKAO_CLIENT_ID;
  const redirectUri = process.env.KAKAO_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/kakao/callback`;
  if (!clientId) return res.status(500).json({ error: 'Kakao OAuth not configured' });

  const url = `https://kauth.kakao.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
  res.redirect(url);
});

router.get('/auth/kakao/callback', async (req, res) => {
  try {
    const { code, error: kakaoError, error_description } = req.query;
    if (kakaoError) {
      console.error('[Kakao OAuth] Authorization error:', kakaoError, error_description);
      return res.redirect(`/?error=kakao_${kakaoError}`);
    }
    if (!code) {
      console.error('[Kakao OAuth] No authorization code received');
      return res.redirect('/?error=kakao_no_code');
    }

    const clientId = process.env.KAKAO_CLIENT_ID;
    const clientSecret = process.env.KAKAO_CLIENT_SECRET;
    const redirectUri = process.env.KAKAO_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/kakao/callback`;

    const tokenParams = {
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
    };
    // Only include client_secret if it's actually set
    if (clientSecret) {
      tokenParams.client_secret = clientSecret;
    }

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(tokenParams),
    });
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[Kakao OAuth] Token request failed:', tokenData);
      return res.redirect(`/?error=kakao_token_failed&detail=${encodeURIComponent(tokenData.error_code || tokenData.error || 'unknown')}`);
    }

    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();

    if (!userRes.ok || !userData.id) {
      console.error('[Kakao OAuth] User info request failed:', userData);
      return res.redirect('/?error=kakao_user_failed');
    }

    const profile = {
      id: String(userData.id),
      email: userData.kakao_account?.email,
      nickname: userData.kakao_account?.profile?.nickname || '카카오 사용자',
    };

    const result = oauthLogin('kakao', profile);
    res.redirect(`/?token=${result.accessToken}&refresh=${result.refreshToken}&provider=kakao`);
  } catch (err) {
    console.error('[Kakao OAuth] Unexpected error:', err);
    res.redirect('/?error=kakao_exception');
  }
});

// --- Google OAuth ---
router.get('/auth/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  if (!clientId) return res.status(500).json({ error: 'Google OAuth not configured' });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=email%20profile`;
  res.redirect(url);
});

router.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, error: googleError } = req.query;
    if (googleError) {
      console.error('[Google OAuth] Authorization error:', googleError);
      return res.redirect(`/?error=google_${googleError}`);
    }
    if (!code) {
      console.error('[Google OAuth] No authorization code received');
      return res.redirect('/?error=google_no_code');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;

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

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[Google OAuth] Token request failed:', tokenData);
      return res.redirect(`/?error=google_token_failed&detail=${encodeURIComponent(tokenData.error || 'unknown')}`);
    }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();

    if (!userRes.ok || !userData.id) {
      console.error('[Google OAuth] User info request failed:', userData);
      return res.redirect('/?error=google_user_failed');
    }

    const profile = {
      id: userData.id,
      email: userData.email,
      nickname: userData.name || '구글 사용자',
    };

    const result = oauthLogin('google', profile);
    res.redirect(`/?token=${result.accessToken}&refresh=${result.refreshToken}&provider=google`);
  } catch (err) {
    console.error('[Google OAuth] Unexpected error:', err);
    res.redirect('/?error=google_exception');
  }
});

// --- Token refresh ---
router.post('/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  const result = refreshAccessToken(refreshToken);
  if (!result) {
    return res.status(401).json({ error: '세션이 만료되었습니다. 다시 로그인해주세요.' });
  }

  res.json({
    token: result.accessToken,
    refreshToken: result.refreshToken,
  });
});

// --- Logout ---
router.post('/auth/logout', (req, res) => {
  const { refreshToken } = req.body;
  logout(refreshToken);
  res.json({ success: true });
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
    provider: user.provider,
    lastProvider: user.last_provider,
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
    const accessType = req.user ? points.getAccessType(req.user.id, g.id) : null;
    return { ...g, purchased: !!accessType, accessType };
  });
  res.json(gameList);
});

// GET /api/games/:id
router.get('/games/:id', optionalAuth, (req, res) => {
  const game = GAMES.find((g) => g.id === req.params.id);
  if (!game) return res.status(404).json({ error: '게임을 찾을 수 없습니다.' });

  const accessType = req.user ? points.getAccessType(req.user.id, game.id) : null;
  res.json({ ...game, purchased: !!accessType, accessType });
});

// POST /api/games/:id/purchase
router.post('/games/:id/purchase', requireAuth, async (req, res) => {
  const game = GAMES.find((g) => g.id === req.params.id);
  if (!game) return res.status(404).json({ error: '게임을 찾을 수 없습니다.' });

  // Check if already purchased
  if (points.hasPurchased(req.user.id, game.id)) {
    return res.status(400).json({ error: '이미 구매한 게임입니다.' });
  }

  const { pointsToUse = 0, couponCode, paymentMethod } = req.body;
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
    'INSERT INTO purchases (user_id, game_id, amount_paid, points_used, coupon_id, payment_method) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, game.id, amountPaid, actualPointsUsed, couponId, paymentMethod || null);

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

// ==========================================================================
// REVIEW ROUTES
// ==========================================================================

// GET /api/reviews — list all reviews (newest first)
router.get('/reviews', (req, res) => {
  const reviews = db.prepare(
    `SELECT r.id, r.game_id, r.rating, r.content, r.created_at,
            u.nickname, u.provider
     FROM reviews r
     JOIN users u ON r.user_id = u.id
     ORDER BY r.created_at DESC`
  ).all();

  // Average rating per game
  const stats = db.prepare(
    `SELECT game_id, COUNT(*) as count, ROUND(AVG(rating), 1) as avg_rating
     FROM reviews GROUP BY game_id`
  ).all();

  res.json({ reviews, stats });
});

// POST /api/reviews — write a review (must have completed the game)
router.post('/reviews', requireAuth, (req, res) => {
  const { gameId, rating, content } = req.body;

  if (!gameId || !rating || !content) {
    return res.status(400).json({ error: '모든 항목을 입력해주세요.' });
  }
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: '별점은 1~5 사이여야 합니다.' });
  }
  if (content.trim().length < 5) {
    return res.status(400).json({ error: '후기는 5자 이상 작성해주세요.' });
  }

  // Check if user completed this game
  const completion = db.prepare(
    'SELECT id FROM game_completions WHERE user_id = ? AND game_id = ?'
  ).get(req.user.id, gameId);

  if (!completion) {
    return res.status(403).json({ error: '게임을 완료한 후 후기를 작성할 수 있습니다.' });
  }

  // Check if already reviewed
  const existing = db.prepare(
    'SELECT id FROM reviews WHERE user_id = ? AND game_id = ?'
  ).get(req.user.id, gameId);

  if (existing) {
    return res.status(400).json({ error: '이미 후기를 작성했습니다.' });
  }

  db.prepare(
    'INSERT INTO reviews (user_id, game_id, rating, content) VALUES (?, ?, ?, ?)'
  ).run(req.user.id, gameId, rating, content.trim());

  res.json({ success: true });
});

// ==========================================================================
// PROMO CODE ROUTES
// ==========================================================================

// POST /api/promo/redeem — redeem a promo code for game access
router.post('/promo/redeem', requireAuth, (req, res) => {
  const { code } = req.body;
  if (!code || !code.trim()) {
    return res.status(400).json({ error: '프로모션 코드를 입력해주세요.' });
  }

  const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code.trim().toUpperCase());
  if (!promo) {
    return res.status(404).json({ error: '유효하지 않은 프로모션 코드입니다.' });
  }

  // Check expiry
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    return res.status(400).json({ error: '만료된 프로모션 코드입니다.' });
  }

  // Check max uses
  if (promo.max_uses !== null && promo.current_uses >= promo.max_uses) {
    return res.status(400).json({ error: '사용 한도에 도달한 프로모션 코드입니다.' });
  }

  // Check if user already has access (purchased or already redeemed)
  if (points.hasPurchased(req.user.id, promo.game_id)) {
    return res.status(400).json({ error: '이미 해당 게임에 접근 권한이 있습니다.' });
  }

  // Check if already redeemed this specific code
  const existing = db.prepare(
    'SELECT id FROM promo_redemptions WHERE user_id = ? AND promo_code_id = ?'
  ).get(req.user.id, promo.id);
  if (existing) {
    return res.status(400).json({ error: '이미 사용한 프로모션 코드입니다.' });
  }

  // Redeem
  db.prepare(
    'INSERT INTO promo_redemptions (user_id, promo_code_id, game_id) VALUES (?, ?, ?)'
  ).run(req.user.id, promo.id, promo.game_id);

  db.prepare(
    'UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = ?'
  ).run(promo.id);

  const game = GAMES.find((g) => g.id === promo.game_id);
  res.json({
    success: true,
    gameId: promo.game_id,
    gameTitle: game ? game.title : promo.game_id,
    message: `${game ? game.title : promo.game_id} 이용권이 등록되었습니다.`,
  });
});

// DELETE /api/reviews/:id — delete own review
router.delete('/reviews/:id', requireAuth, (req, res) => {
  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!review) return res.status(404).json({ error: '후기를 찾을 수 없습니다.' });
  if (review.user_id !== req.user.id) return res.status(403).json({ error: '본인의 후기만 삭제할 수 있습니다.' });

  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
