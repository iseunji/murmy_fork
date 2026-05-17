const { verifyToken, findById } = require('./auth');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: '인증이 만료되었습니다.', code: 'TOKEN_EXPIRED' });
  }

  const user = findById.get(decoded.id);
  if (!user) {
    return res.status(401).json({ error: '사용자를 찾을 수 없습니다.' });
  }

  req.user = user;
  next();
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.cookies?.token;

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = findById.get(decoded.id);
    }
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
