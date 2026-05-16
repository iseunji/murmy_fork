const db = require('./db');

// --- Prepared statements ---
const getBalance = db.prepare('SELECT points FROM users WHERE id = ?');
const addPoints = db.prepare('UPDATE users SET points = points + ? WHERE id = ?');
const deductPoints = db.prepare('UPDATE users SET points = points - ? WHERE id = ? AND points >= ?');

const checkCompletion = db.prepare(
  'SELECT id, points_awarded FROM game_completions WHERE user_id = ? AND game_id = ? LIMIT 1'
);
const insertCompletion = db.prepare(
  `INSERT INTO game_completions (user_id, game_id, room_code, role, ending_id, mission_score, won, points_awarded)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

const checkPurchase = db.prepare(
  'SELECT id FROM purchases WHERE user_id = ? AND game_id = ? LIMIT 1'
);

// --- Points logic ---

// 게임 구매 시 +2P
function awardPurchasePoints(userId) {
  addPoints.run(2, userId);
  return 2;
}

// 게임 끝까지 플레이 시 +1P (게임당 1회만)
function awardCompletionPoints(userId, gameId) {
  const existing = checkCompletion.get(userId, gameId);
  if (existing && existing.points_awarded >= 1) {
    return 0; // Already awarded for this game
  }
  addPoints.run(1, userId);
  return 1;
}

// 승리 시 +미션 점수
function awardWinPoints(userId, gameId, missionScore) {
  if (missionScore <= 0) return 0;
  addPoints.run(missionScore, userId);
  return missionScore;
}

// 포인트 사용 (구매 할인)
function usePoints(userId, amount) {
  if (amount <= 0) return true;
  const user = getBalance.get(userId);
  if (!user || user.points < amount) return false;
  deductPoints.run(amount, userId, amount);
  return true;
}

// 포인트 잔액 조회
function getPointsBalance(userId) {
  const user = getBalance.get(userId);
  return user ? user.points : 0;
}

// 게임 완료 기록 + 포인트 지급
function recordGameCompletion(userId, gameId, { roomCode, role, endingId, missionScore, won }) {
  let totalAwarded = 0;

  // Check if already has completion record for this game
  const existing = checkCompletion.get(userId, gameId);

  if (!existing) {
    // First completion — award completion point (+1P)
    totalAwarded += awardCompletionPoints(userId, gameId);

    // Award win points if applicable
    if (won && missionScore > 0) {
      totalAwarded += awardWinPoints(userId, gameId, missionScore);
    }

    insertCompletion.run(userId, gameId, roomCode, role, endingId, missionScore, won ? 1 : 0, totalAwarded);
  }

  return totalAwarded;
}

// 게임 구매 여부 확인
function hasPurchased(userId, gameId) {
  return !!checkPurchase.get(userId, gameId);
}

module.exports = {
  awardPurchasePoints,
  awardCompletionPoints,
  awardWinPoints,
  usePoints,
  getPointsBalance,
  recordGameCompletion,
  hasPurchased,
};
