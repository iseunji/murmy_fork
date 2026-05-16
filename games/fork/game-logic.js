const gameData = require('./game-data');

// ---------------------------------------------------------------------------
// In-memory room storage
// ---------------------------------------------------------------------------
const rooms = {}; // roomCode -> room object
const socketToRoom = {}; // socketId -> roomCode (for fast lookup on disconnect)

// Phase order used by the state machine
const PHASE_ORDER = ['investigation1', 'discussion1', 'investigation2', 'discussion2', 'accusation'];

// ---------------------------------------------------------------------------
// Helper: generate a unique 4-digit room code
// ---------------------------------------------------------------------------
function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms[code]);
  return code;
}

// ---------------------------------------------------------------------------
// Helper: get the "other" socket in a room
// ---------------------------------------------------------------------------
function getPartnerSocket(room, socketId) {
  const partner = room.players.find((s) => s && s.id !== socketId);
  return partner || null;
}

// ---------------------------------------------------------------------------
// Helper: find a phase object by its id (phases is an array)
// ---------------------------------------------------------------------------
function findPhase(phaseId) {
  return gameData.phases.find((p) => p.id === phaseId) || null;
}

// ---------------------------------------------------------------------------
// Helper: look up evidence for a given role in a given phase
// ---------------------------------------------------------------------------
function findEvidence(phaseId, role, evidenceId) {
  const phase = findPhase(phaseId);
  if (!phase || !phase.evidence) return null;
  const list = Array.isArray(phase.evidence)
    ? phase.evidence
    : (phase.evidence[role] || []);
  return list.find((e) => e.id === evidenceId) || null;
}

// ---------------------------------------------------------------------------
// Helper: find evidence by ID across ALL roles (shared pool lookup)
// ---------------------------------------------------------------------------
function findEvidenceGlobal(phaseId, evidenceId) {
  const phase = findPhase(phaseId);
  if (!phase || !phase.evidence) return null;
  const all = Array.isArray(phase.evidence)
    ? phase.evidence
    : [...(phase.evidence.culprit || []), ...(phase.evidence.innocent || [])];
  return all.find((e) => e.id === evidenceId) || null;
}

// ---------------------------------------------------------------------------
// Helper: build the evidence *list* (without content) for a role in a phase
// ---------------------------------------------------------------------------
function buildEvidenceList(phaseId, role) {
  const phase = findPhase(phaseId);
  if (!phase || !phase.evidence) return [];
  const list = Array.isArray(phase.evidence)
    ? phase.evidence
    : (phase.evidence[role] || []);
  return list.map((e) => ({
    id: e.id,
    title: e.title,
    type: e.type,
  }));
}

// ---------------------------------------------------------------------------
// Helper: mask combo result name until the combo is actually unlocked
// ---------------------------------------------------------------------------
function getMaskedComboHint(evidence, playerComboCards) {
  if (!evidence || !evidence.comboHint) return undefined;
  const comboInfo = (gameData.combinations || []).find((c) => c.requires.includes(evidence.id));
  if (!comboInfo) return evidence.comboHint;

  const alreadyCombined = (playerComboCards || []).some((c) => c.id === comboInfo.id);
  if (alreadyCombined) return evidence.comboHint;

  const comboIndex = gameData.combinations.indexOf(comboInfo) + 1;
  return evidence.comboHint.replace("'" + comboInfo.title + "'", "'추가 증거 " + comboIndex + "'");
}

// ---------------------------------------------------------------------------
// Helper: find evidence by ID across ALL phases (global lookup)
// ---------------------------------------------------------------------------
function findEvidenceAnyPhase(evidenceId) {
  for (const phase of gameData.phases) {
    if (!phase.evidence || phase.evidence.length === 0) continue;
    const list = Array.isArray(phase.evidence)
      ? phase.evidence
      : [...(phase.evidence.culprit || []), ...(phase.evidence.innocent || [])];
    const found = list.find((e) => e.id === evidenceId);
    if (found) return found;
  }
  const combo = (gameData.combinations || []).find((c) => c.id === evidenceId);
  if (combo) return combo;
  return null;
}

// ---------------------------------------------------------------------------
// Helper: build a SHARED evidence list combining both roles (without content)
// ---------------------------------------------------------------------------
function buildSharedEvidenceList(phaseId) {
  const phase = findPhase(phaseId);
  if (!phase || !phase.evidence) return [];
  const all = Array.isArray(phase.evidence)
    ? phase.evidence
    : [...(phase.evidence.culprit || []), ...(phase.evidence.innocent || [])];
  return all.map((e) => ({
    id: e.id, title: e.title, type: e.type,
  }));
}

// ---------------------------------------------------------------------------
// Helper: build narrative string for a role in a phase
// ---------------------------------------------------------------------------
function buildNarrative(phaseId, role) {
  const phase = findPhase(phaseId);
  if (!phase) return '';
  const shared = phase.narrative?.shared || '';
  const roleSpecific = phase.narrative?.[role] || '';
  return [shared, roleSpecific].filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// Helper: send phase-data to both players
// ---------------------------------------------------------------------------
function sendPhaseData(room) {
  const phaseId = room.gameState;
  const phase = findPhase(phaseId);
  if (!phase) return;

  const hasEvidence = buildSharedEvidenceList(phaseId).length > 0;

  room.players.forEach((socket) => {
    if (!socket) return;
    const role = room.roles[socket.id];

    let turnOrderGuidance = null;
    if (phaseId === 'investigation1') {
      turnOrderGuidance = '조사 1 단계에서는 하진이 먼저 증거 수집을 시작합니다.';
    } else if (phaseId === 'investigation2') {
      turnOrderGuidance = '조사 2 단계에서는 도현이 먼저 증거 수집을 시작합니다.';
    }

    let discussionRules = null;
    if (phaseId === 'discussion1' || phaseId === 'discussion2') {
      discussionRules = {
        maxTrades: 2,
        maxDonationsPerPlayer: 1,
      };
    }

    const isDiscussion = phaseId === 'discussion1' || phaseId === 'discussion2';
    const collectedEvidence = isDiscussion
      ? (room.allCollectedEvidence[socket.id] || []).map((e) => ({ id: e.id, title: e.title, type: e.type }))
      : [];

    let actionPhaseInfo = null;
    if (phaseId === 'accusation') {
      if (!room.actionPhase) {
        room.actionPhase = 'action-innocent';
        room.actions = {};
      }
      const myEvidence = (room.allCollectedEvidence[socket.id] || []).map((e) => e.id);
      if (role === 'innocent') {
        const canConfiscate = myEvidence.includes('ev_inv1_09') && myEvidence.includes('ev_inv2_07');
        actionPhaseInfo = { yourTurn: true, canConfiscate };
      } else {
        actionPhaseInfo = { yourTurn: false };
      }
    }

    socket.emit('phase-data', {
      phaseId,
      title: phase.title || phaseId,
      subtitle: phase.subtitle || '',
      narrative: buildNarrative(phaseId, role),
      evidenceList: [],
      hasEvidence,
      duration: phase.duration || 120,
      turnOrderGuidance,
      discussionRules,
      isDiscussion,
      collectedEvidence,
      actionPhaseInfo,
    });

    if (phaseId === 'aria' && phase.aiChat && phase.aiChat[role]) {
      const greeting = phase.aiChat[role].greeting;
      if (greeting) {
        setTimeout(() => {
          socket.emit('ai-chat-response', { message: '', isTyping: true });
          setTimeout(() => {
            socket.emit('ai-chat-response', { message: greeting, isTyping: false });
          }, 1500);
        }, 1000);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Helper: start phase timer
// ---------------------------------------------------------------------------
function startPhaseTimer(room) {
  clearPhaseTimer(room);

  const phaseId = room.gameState;
  const phase = findPhase(phaseId);
  if (!phase || !phase.duration) return;

  room.timerRemaining = phase.duration;

  room.timerInterval = setInterval(() => {
    room.timerRemaining -= 1;

    room.players.forEach((socket) => {
      if (socket) {
        socket.emit('timer-update', { remaining: room.timerRemaining });
      }
    });

    if (room.timerRemaining <= 0) {
      clearPhaseTimer(room);

      const ec = room.evidenceCollection;
      if (ec.active) {
        let turnIdx = ec.currentTurnIndex;
        const autoPhaseId = room.gameState;
        while (ec.sharedPool.length > 0) {
          const sid = ec.turnOrder[turnIdx % ec.turnOrder.length];
          const item = ec.sharedPool.shift();
          ec.picked[sid].push(item.id);
          if (!room.allCollectedEvidence[sid]) room.allCollectedEvidence[sid] = [];
          const fullEv = findEvidenceAnyPhase(item.id);
          room.allCollectedEvidence[sid].push({
            id: item.id,
            title: fullEv?.title || item.title || item.id,
            type: fullEv?.type || item.type || 'unknown',
            phase: autoPhaseId,
          });
          turnIdx++;
        }
        ec.active = false;

        room.players.forEach((s) => {
          if (s) {
            const collectedFull = (ec.picked[s.id] || []).map((evId) => {
              const ev = findEvidenceAnyPhase(evId);
              return ev ? { id: ev.id, title: ev.title, type: ev.type } : { id: evId, title: evId, type: 'unknown' };
            });
            s.emit('evidence-collection-complete', {
              collected: ec.picked[s.id] || [],
              collectedFull,
              phase: autoPhaseId,
            });
          }
        });
      }

      advancePhase(room);
    }
  }, 1000);
}

// ---------------------------------------------------------------------------
// Helper: clear phase timer
// ---------------------------------------------------------------------------
function clearPhaseTimer(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Helper: advance to the next phase
// ---------------------------------------------------------------------------
function advancePhase(room) {
  clearPhaseTimer(room);
  room.readyCount = 0;

  room.evidenceCollection = {
    readyToCollect: [],
    turnOrder: [],
    currentTurnIndex: 0,
    sharedPool: [],
    picked: {},
    active: false,
  };

  room.discussion = {
    tradeCount: 0,
    maxTrades: 2,
    donations: {},
    maxDonationsPerPlayer: 1,
  };

  const currentPhase = room.gameState;

  if (currentPhase === 'intro') {
    room.gameState = PHASE_ORDER[0];
    console.log(`[Room ${room.code}] Phase transition: intro -> ${room.gameState}`);
    sendPhaseData(room);
    startPhaseTimer(room);
    return;
  }

  const idx = PHASE_ORDER.indexOf(currentPhase);
  if (idx === -1) return;

  if (idx < PHASE_ORDER.length - 1) {
    room.gameState = PHASE_ORDER[idx + 1];
    console.log(`[Room ${room.code}] Phase transition: ${currentPhase} -> ${room.gameState}`);
    sendPhaseData(room);
    startPhaseTimer(room);
  } else {
    if (currentPhase === 'accusation') {
      if (room.actionPhase === 'action-innocent') {
        room.actions.innocent = 'pass';
        room.actionPhase = 'action-culprit';
        room.actions.culprit = 'pass';
        room.actionPhase = 'vote';
      } else if (room.actionPhase === 'action-culprit') {
        room.actions.culprit = 'pass';
        room.actionPhase = 'vote';
      }

      for (const s of room.players) {
        if (s && !room.accusations[s.id]) {
          room.accusations[s.id] = 'aria';
        }
      }

      const culpritEliminated = room.actions && room.actions.culprit === 'eliminate';
      const endingType = determineEndingWithActions(room.accusations, room.roles, culpritEliminated);
      const endingData = gameData.endings?.[endingType] || {};
      const resultSummary = generateResultSummaryFull(room.accusations, room.roles, room.actions, endingType);
      const scores = calculateScores(room.accusations, room.roles, room.actions, room.allCollectedEvidence, endingType);
      const winner = endingType === 'inherited' ? 'innocent' : 'culprit';

      room.gameState = 'ending';
      room.lastScores = scores;
      console.log(`[Room ${room.code}] Timer expired — auto-ending: ${endingType}`);

      room.players.forEach((s) => {
        if (s) {
          const role = room.roles[s.id];
          s.emit('game-ending', {
            endingType,
            title: endingData.title || endingType,
            subtitle: endingData.subtitle || '',
            narrative: endingData.narrative || '',
            truthReveal: gameData.truthReveal || [],
            epilogue: endingData.epilogue || '',
            resultSummary: resultSummary || [],
            winner,
            myRole: role,
            scores,
          });
        }
      });
    } else {
      room.gameState = 'ending';
      console.log(`[Room ${room.code}] Phase transition: ${currentPhase} -> ending`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: determine ending from actions + votes
// ---------------------------------------------------------------------------
function determineEndingWithActions(accusations, roles, culpritEliminated) {
  const accEntries = Object.entries(accusations);
  const innocentEntry = accEntries.find(([sid]) => roles[sid] === 'innocent');
  const innocentVote = innocentEntry ? innocentEntry[1] : null;

  if (culpritEliminated) {
    if (innocentVote === 'partnerHuman') return 'fork';
    return 'soleSurvivor';
  }

  if (innocentVote === 'partnerHuman') return 'inherited';
  if (innocentVote === 'aria') return 'forked';

  return 'inherited';
}

// ---------------------------------------------------------------------------
// Helper: calculate scores for each player
// ---------------------------------------------------------------------------
function calculateScores(accusations, roles, actions, allCollectedEvidence, endingType) {
  const accEntries = Object.entries(accusations);
  const culpritEntry = accEntries.find(([sid]) => roles[sid] === 'culprit');
  const innocentEntry = accEntries.find(([sid]) => roles[sid] === 'innocent');
  const culpritSid = culpritEntry ? culpritEntry[0] : null;
  const innocentSid = innocentEntry ? innocentEntry[0] : null;
  const innocentVote = innocentEntry ? innocentEntry[1] : null;

  const culpritEvIds = (allCollectedEvidence[culpritSid] || []).map((e) => e.id);
  const innocentEvIds = (allCollectedEvidence[innocentSid] || []).map((e) => e.id);

  const culpritEliminated = actions && actions.culprit === 'eliminate';

  const culpritScores = [];
  const notAccused = innocentVote !== 'partnerHuman';
  culpritScores.push({ label: '범인으로 지목당하지 않는다', points: 3, achieved: notAccused, auto: true });

  const culpritHasUsb = culpritEvIds.includes('ev_inv1_04');
  culpritScores.push({ label: "'USB'를 확보하여 종료 시점까지 가지고 있는다", points: 3, achieved: culpritHasUsb, auto: true });

  culpritScores.push({ label: 'AI를 이용하여 상대를 제거한다', points: 3, achieved: culpritEliminated, auto: true });

  culpritScores.push({ label: '상대방이 미션 점수를 7점 이상 모으지 못하도록 한다', points: 3, achieved: false, auto: true, deferred: true });

  const innocentScores = [];
  const innocentHasUsb = innocentEvIds.includes('ev_inv1_04');
  innocentScores.push({ label: "'USB'를 확보하여 종료 시점까지 가지고 있는다", points: 3, achieved: innocentHasUsb, auto: true });

  innocentScores.push({ label: '수면제 투여 사실을 들키지 않는다', points: 3, achieved: false, auto: false });

  const innocentHasPhone = innocentEvIds.includes('ev_inv1_07');
  innocentScores.push({ label: "'교수의 스마트폰'을 확보하여 종료 시점까지 가지고 있는다", points: 3, achieved: innocentHasPhone, auto: true });

  innocentScores.push({ label: '정확한 살해 스토리를 추론하여 맞춘다', points: 3, achieved: false, auto: false });

  return { culpritScores, innocentScores };
}

// ---------------------------------------------------------------------------
// Helper: generate result summary for ending screen
// ---------------------------------------------------------------------------
function generateResultSummaryFull(accusations, roles, actions, endingType) {
  const accEntries = Object.entries(accusations);
  const culpritEntry = accEntries.find(([sid]) => roles[sid] === 'culprit');
  const innocentEntry = accEntries.find(([sid]) => roles[sid] === 'innocent');
  const culpritVote = culpritEntry ? culpritEntry[1] : null;
  const innocentVote = innocentEntry ? innocentEntry[1] : null;

  const lines = [];

  if (innocentVote === 'partnerHuman') {
    lines.push('이도현은 서하진을 범인으로 지목했습니다.');
  } else {
    lines.push('이도현은 ARIA를 범인으로 지목했습니다.');
  }
  if (culpritVote === 'partnerHuman') {
    lines.push('서하진은 이도현을 범인으로 지목했습니다.');
  } else {
    lines.push('서하진은 ARIA를 범인으로 지목했습니다.');
  }

  if (actions && actions.innocent === 'confiscate') {
    lines.push('[RED]이도현은 교수의 스마트폰을 압수했습니다.');
  }
  if (actions && actions.culprit === 'eliminate') {
    lines.push('[RED]서하진은 ARIA에 제거 명령을 내렸습니다.');
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Helper: schedule room cleanup after disconnect
// ---------------------------------------------------------------------------
function scheduleRoomCleanup(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  room.cleanupTimer = setTimeout(() => {
    const connectedCount = room.players.filter((s) => s !== null).length;
    if (connectedCount === 0) {
      clearPhaseTimer(room);
      delete rooms[roomCode];
      console.log(`[Room ${roomCode}] Cleaned up (no players reconnected within 60s)`);
    }
  }, 60000);
}

// ---------------------------------------------------------------------------
// Register Socket.IO handlers on a namespace
// ---------------------------------------------------------------------------
function register(namespace) {
  namespace.on('connection', (socket) => {
    // ------------------------------------------
    // CREATE ROOM
    // ------------------------------------------
    socket.on('create-room', () => {
      const roomCode = generateRoomCode();

      const room = {
        code: roomCode,
        players: [socket, null],
        gameState: 'lobby',
        roles: {},
        readyCount: 0,
        characterSelections: {},
        accusations: {},
        timerInterval: null,
        timerRemaining: 0,
        cleanupTimer: null,
        disconnectGraceTimer: null,
        disconnectedPlayers: {},
        evidenceCollection: {
          readyToCollect: [],
          turnOrder: [],
          currentTurnIndex: 0,
          sharedPool: [],
          picked: {},
          active: false,
        },
        firstCollectorPhase1: null,
        discussion: {
          tradeCount: 0,
          maxTrades: 2,
          donations: {},
          maxDonationsPerPlayer: 1,
        },
        allCollectedEvidence: {},
        comboCards: {},
        pendingTrade: null,
      };

      rooms[roomCode] = room;
      socketToRoom[socket.id] = roomCode;
      socket.join(roomCode);

      console.log(`[Room ${roomCode}] Created by ${socket.id}`);
      socket.emit('room-created', { roomCode });
    });

    // ------------------------------------------
    // JOIN ROOM
    // ------------------------------------------
    socket.on('join-room', ({ roomCode }) => {
      const room = rooms[roomCode];

      if (!room) {
        socket.emit('room-joined', { success: false, error: 'Room not found' });
        return;
      }

      const disconnectedEntry = Object.entries(room.disconnectedPlayers).find(
        ([, info]) => info !== null
      );

      const connectedCount = room.players.filter((s) => s !== null).length;
      if (connectedCount >= 2) {
        socket.emit('room-joined', { success: false, error: 'Room is full' });
        return;
      }

      let playerIndex = room.players.indexOf(null);
      let role = null;

      if (disconnectedEntry) {
        const [oldSocketId, info] = disconnectedEntry;
        playerIndex = info.playerIndex;
        role = info.role;

        if (role) {
          delete room.roles[oldSocketId];
          room.roles[socket.id] = role;
        }

        if (room.accusations[oldSocketId] !== undefined) {
          room.accusations[socket.id] = room.accusations[oldSocketId];
          delete room.accusations[oldSocketId];
        }

        delete room.disconnectedPlayers[oldSocketId];

        if (room.disconnectGraceTimer) {
          clearTimeout(room.disconnectGraceTimer);
          room.disconnectGraceTimer = null;
        }

        if (room.cleanupTimer) {
          clearTimeout(room.cleanupTimer);
          room.cleanupTimer = null;
        }
      }

      if (playerIndex === -1) {
        socket.emit('room-joined', { success: false, error: 'Room is full' });
        return;
      }

      room.players[playerIndex] = socket;
      socketToRoom[socket.id] = roomCode;
      socket.join(roomCode);

      const playerNum = playerIndex + 1;
      console.log(`[Room ${roomCode}] Player ${playerNum} joined (${socket.id})`);

      socket.emit('room-joined', { success: true, playerNum });

      const partner = getPartnerSocket(room, socket.id);
      if (partner) {
        partner.emit('player-joined', { playerNum });
        if (role && room.gameState !== 'lobby') {
          partner.emit('partner-reconnected', {});
        }
      } else if (room.gameState !== 'lobby') {
        socket.emit('partner-disconnected', {});
      }

      if (role && room.gameState !== 'lobby') {
        const briefing = gameData.roles?.[role]?.briefing || '';
        const prologuePhase = findPhase('prologue');
        const prologueNarrative = prologuePhase?.narrative?.shared || '';
        socket.emit('game-start', { role, briefing, playerNum, prologueNarrative });

        if (room.gameState !== 'intro' && room.gameState !== 'ending') {
          const phaseId = room.gameState;
          const phase = findPhase(phaseId);
          if (phase) {
            const fullEvidenceList = buildEvidenceList(phaseId, role);
            const hasEvidence = fullEvidenceList.length > 0;

            socket.emit('phase-data', {
              phaseId,
              title: phase.title || phaseId,
              subtitle: phase.subtitle || '',
              narrative: buildNarrative(phaseId, role),
              evidenceList: hasEvidence ? [] : fullEvidenceList,
              hasEvidence,
              duration: phase.duration || 120,
            });
            if (room.timerRemaining > 0) {
              socket.emit('timer-update', { remaining: room.timerRemaining });
            }

            if (hasEvidence && room.evidenceCollection.active) {
              const ec = room.evidenceCollection;
              const currentTurnSocketId = ec.turnOrder[ec.currentTurnIndex];
              socket.emit('evidence-collection-state', {
                pool: ec.pools[socket.id] || [],
                isYourTurn: currentTurnSocketId === socket.id,
                pickedCount: (ec.picked[socket.id] || []).length,
              });
            }
          }
        }
      }
    });

    // ------------------------------------------
    // PLAYER READY (lobby → game start)
    // ------------------------------------------
    socket.on('player-ready', () => {
      const roomCode = socketToRoom[socket.id];
      const room = rooms[roomCode];
      if (!room) return;

      room.readyCount += 1;

      const playerIndex = room.players.findIndex((s) => s && s.id === socket.id);
      const playerNum = playerIndex + 1;
      room.players.forEach((s) => {
        if (s && s.id !== socket.id) s.emit('ready-update', { playerNum });
      });

      const connectedCount = room.players.filter((s) => s !== null).length;
      if (room.readyCount >= 2 && connectedCount >= 2) {
        room.gameState = 'character-select';
        room.characterSelections = {};
        room.readyCount = 0;

        const characters = gameData.characters || [];
        room.players.forEach((s) => {
          if (s) {
            const pIdx = room.players.indexOf(s);
            s.emit('show-character-select', {
              characters,
              playerNum: pIdx + 1,
            });
          }
        });
      }
    });

    // ------------------------------------------
    // CHARACTER SELECTION
    // ------------------------------------------
    socket.on('select-character', ({ characterId }) => {
      const roomCode = socketToRoom[socket.id];
      const room = rooms[roomCode];
      if (!room || room.gameState !== 'character-select') return;

      const previousSelection = room.characterSelections[socket.id];
      const partner = getPartnerSocket(room, socket.id);

      if (previousSelection === characterId) {
        delete room.characterSelections[socket.id];
        socket.emit('character-deselected', { characterId });
        if (partner) {
          partner.emit('character-freed-by-other', { characterId });
        }
        return;
      }

      const charData = (gameData.characters || []).find(c => c.id === characterId);
      if (charData && charData.selectable === false) return;

      const otherPlayerId = Object.keys(room.characterSelections).find(id => id !== socket.id);
      if (otherPlayerId && room.characterSelections[otherPlayerId] === characterId) {
        socket.emit('character-taken', { characterId });
        return;
      }

      if (previousSelection && partner) {
        partner.emit('character-freed-by-other', { characterId: previousSelection });
      }

      room.characterSelections[socket.id] = characterId;

      if (partner) {
        partner.emit('character-selected-by-other', { characterId });
      }

      socket.emit('character-confirmed', { characterId });

      const selectedCount = Object.keys(room.characterSelections).length;
      if (selectedCount >= 2) {
        const shuffled = [...room.players].filter(Boolean);
        const roleAssignment = shuffled.map((s) =>
          room.characterSelections[s.id] === 'hajin' ? 'culprit' : 'innocent'
        );

        shuffled.forEach((s, i) => {
          room.roles[s.id] = roleAssignment[i];
        });

        room.gameState = 'intro';
        console.log(`[Room ${roomCode}] Characters selected, roles assigned`);

        shuffled.forEach((s, i) => {
          const role = roleAssignment[i];
          const briefing = gameData.roles?.[role]?.briefing || '';
          const pIdx = room.players.indexOf(s);
          const charId = room.characterSelections[s.id];
          const character = (gameData.characters || []).find((c) => c.id === charId);
          const prologuePhase = findPhase('prologue');
          const prologueNarrative = prologuePhase?.narrative?.shared || '';
          s.emit('game-start', {
            role,
            briefing,
            playerNum: pIdx + 1,
            character: character || null,
            prologueNarrative,
          });
        });
      }
    });

    // ------------------------------------------
    // PHASE READY (advance when both players ready)
    // ------------------------------------------
    socket.on('phase-ready', () => {
      const roomCode = socketToRoom[socket.id];
      const room = rooms[roomCode];
      if (!room) return;

      room.readyCount += 1;

      room.players.forEach((s) => {
        if (s) s.emit('phase-ready-count', { count: room.readyCount });
      });

      const connectedCount = room.players.filter((s) => s !== null).length;
      if (room.readyCount >= 2 && connectedCount >= 2) {
        advancePhase(room);
      }
    });

    // ------------------------------------------
    // REQUEST EVIDENCE
    // ------------------------------------------
    socket.on('request-evidence', ({ evidenceId }) => {
      const roomCode = socketToRoom[socket.id];
      const room = rooms[roomCode];
      if (!room) return;

      const hasInCollected = (room.allCollectedEvidence[socket.id] || []).some((e) => e.id === evidenceId);
      const hasInCombo = (room.comboCards[socket.id] || []).some((c) => c.id === evidenceId);
      const hasInCurrentPick = (room.evidenceCollection.picked[socket.id] || []).includes(evidenceId);

      if (!hasInCollected && !hasInCombo && !hasInCurrentPick) {
        socket.emit('error', { message: 'You have not collected this evidence' });
        return;
      }

      const evidence = findEvidenceAnyPhase(evidenceId);
      if (!evidence) {
        socket.emit('error', { message: 'Evidence not found' });
        return;
      }

      const comboInfo = (gameData.combinations || []).find((c) => c.requires.includes(evidenceId));
      let canCombine = false;
      let comboId = undefined;
      let comboPartnerTitle = undefined;
      if (comboInfo) {
        comboId = comboInfo.id;
        const playerCards = (room.allCollectedEvidence[socket.id] || []).map((e) => e.id);
        canCombine = comboInfo.requires.every((reqId) => playerCards.includes(reqId));
        const alreadyCombined = (room.comboCards[socket.id] || []).some((c) => c.id === comboInfo.id);
        if (alreadyCombined) canCombine = false;
        const partnerId = comboInfo.requires.find((r) => r !== evidenceId);
        if (partnerId) {
          const partnerEvidence = findEvidenceAnyPhase(partnerId);
          if (partnerEvidence) comboPartnerTitle = partnerEvidence.title;
        }
      }

      const isDiscussion = room.gameState === 'discussion1' || room.gameState === 'discussion2';
      const disc = room.discussion;
      const canDonate = isDiscussion && (disc.donations[socket.id] || 0) < disc.maxDonationsPerPlayer;
      const canExchange = isDiscussion && disc.tradeCount < disc.maxTrades;

      let comboIndex;
      if (hasInCombo) {
        comboIndex = (gameData.combinations || []).findIndex((c) => c.id === evidenceId) + 1;
      }

      socket.emit('evidence-detail', {
        id: evidence.id,
        title: evidence.title,
        type: evidence.type,
        content: evidence.content,
        image: evidence.image || undefined,
        comboHint: getMaskedComboHint(evidence, room.comboCards[socket.id]),
        canCombine,
        comboId,
        comboPartnerTitle,
        canDonate,
        canExchange,
        isComboCard: hasInCombo,
        comboIndex,
      });
    });

    // ------------------------------------------
    // START EVIDENCE COLLECTION
    // ------------------------------------------
    socket.on('start-evidence-collection', () => {
      const roomCode = socketToRoom[socket.id];
      const room = rooms[roomCode];
      if (!room) return;

      const ec = room.evidenceCollection;

      if (ec.active) return;
      if (ec.readyToCollect.includes(socket.id)) return;

      ec.readyToCollect.push(socket.id);

      if (ec.readyToCollect.length === 1) {
        socket.emit('evidence-waiting', {});
      } else if (ec.readyToCollect.length >= 2) {
        const phaseId = room.gameState;

        const culpritSid = ec.readyToCollect.find((sid) => room.roles[sid] === 'culprit');
        const innocentSid = ec.readyToCollect.find((sid) => room.roles[sid] === 'innocent');
        if (phaseId === 'investigation1' && culpritSid && innocentSid) {
          ec.turnOrder = [culpritSid, innocentSid];
        } else if (phaseId === 'investigation2' && culpritSid && innocentSid) {
          ec.turnOrder = [innocentSid, culpritSid];
        } else {
          ec.turnOrder = [ec.readyToCollect[0], ec.readyToCollect[1]];
        }

        ec.currentTurnIndex = 0;
        ec.active = true;

        ec.sharedPool = buildSharedEvidenceList(phaseId);
        ec.turnOrder.forEach((sid) => {
          ec.picked[sid] = [];
        });

        const currentTurnSocketId = ec.turnOrder[ec.currentTurnIndex];
        room.players.forEach((s) => {
          if (!s) return;
          s.emit('evidence-collection-state', {
            pool: ec.sharedPool,
            isYourTurn: currentTurnSocketId === s.id,
            pickedCount: 0,
          });
        });
      }
    });

    // ------------------------------------------
    // PICK EVIDENCE
    // ------------------------------------------
    socket.on('pick-evidence', ({ evidenceId }) => {
      const roomCode = socketToRoom[socket.id];
      const room = rooms[roomCode];
      if (!room) return;

      const ec = room.evidenceCollection;

      if (!ec.active) return;
      const currentTurnSocketId = ec.turnOrder[ec.currentTurnIndex];
      if (currentTurnSocketId !== socket.id) return;

      const itemIndex = ec.sharedPool.findIndex((e) => e.id === evidenceId);
      if (itemIndex === -1) return;
      ec.sharedPool.splice(itemIndex, 1);

      ec.picked[socket.id].push(evidenceId);

      const phaseId = room.gameState;
      const fullEvidence = findEvidenceGlobal(phaseId, evidenceId);

      if (!room.allCollectedEvidence[socket.id]) {
        room.allCollectedEvidence[socket.id] = [];
      }
      room.allCollectedEvidence[socket.id].push({
        id: evidenceId,
        title: fullEvidence?.title || evidenceId,
        type: fullEvidence?.type || 'unknown',
        phase: phaseId,
      });
      if (fullEvidence) {
        socket.emit('evidence-picked', {
          id: fullEvidence.id,
          title: fullEvidence.title,
          type: fullEvidence.type,
          content: fullEvidence.content,
          image: fullEvidence.image || undefined,
          comboHint: getMaskedComboHint(fullEvidence, room.comboCards[socket.id]),
          metadata: fullEvidence.metadata || undefined,
        });
      }

      const partner = getPartnerSocket(room, socket.id);
      if (partner) {
        partner.emit('partner-picked', {});
      }

      ec.currentTurnIndex = (ec.currentTurnIndex + 1) % 2;

      if (ec.sharedPool.length === 0) {
        ec.active = false;
        room.players.forEach((s) => {
          if (s) {
            const collectedFull = (ec.picked[s.id] || []).map((evId) => {
              const ev = findEvidenceAnyPhase(evId);
              return ev ? { id: ev.id, title: ev.title, type: ev.type } : { id: evId, title: evId, type: 'unknown' };
            });
            s.emit('evidence-collection-complete', {
              collected: ec.picked[s.id] || [],
              collectedFull,
              phase: phaseId,
            });
          }
        });
      } else {
        const nextTurnSocketId = ec.turnOrder[ec.currentTurnIndex];
        room.players.forEach((s) => {
          if (!s) return;
          s.emit('evidence-collection-state', {
            pool: ec.sharedPool,
            isYourTurn: nextTurnSocketId === s.id,
            pickedCount: (ec.picked[s.id] || []).length,
          });
        });
      }
    });

    // ------------------------------------------
    // TRADE PROPOSE
    // ------------------------------------------
    socket.on('trade-propose', ({ cardId }) => {
      const roomCode = socketToRoom[socket.id];
      const room = rooms[roomCode];
      if (!room) return;

      const disc = room.discussion;
      if (disc.tradeCount >= disc.maxTrades) {
        socket.emit('trade-rejected', { reason: '이번 토론에서 교환 횟수를 모두 사용했습니다. (최대 2회)' });
        return;
      }

      const myEvidence = room.allCollectedEvidence[socket.id] || [];
      if (!myEvidence.some((e) => e.id === cardId)) {
        socket.emit('error', { message: '해당 카드를 보유하고 있지 않습니다.' });
        return;
      }

      const fullCard = findEvidenceAnyPhase(cardId);
      const cardInfo = fullCard ? { id: fullCard.id, title: fullCard.title, type: fullCard.type } : { id: cardId, title: cardId, type: 'unknown' };

      room.pendingTrade = { from: socket.id, cardId };

      const partner = getPartnerSocket(room, socket.id);
      if (partner) {
        partner.emit('trade-proposal', { card: cardInfo, fromSocketId: socket.id });
      }
      socket.emit('trade-proposed', { cardId });
    });

    // ------------------------------------------
    // TRADE ACCEPT
    // ------------------------------------------
    socket.on('trade-accept', ({ myCardId }) => {
      const roomCode = socketToRoom[socket.id];
      const room = rooms[roomCode];
      if (!room || !room.pendingTrade) return;

      const disc = room.discussion;
      if (disc.tradeCount >= disc.maxTrades) {
        socket.emit('trade-rejected', { reason: '이번 토론에서 교환 횟수를 모두 사용했습니다. (최대 2회)' });
        room.pendingTrade = null;
        return;
      }

      const proposer = room.pendingTrade.from;
      const proposerCardId = room.pendingTrade.cardId;
      const accepterCardId = myCardId;

      const proposerEvidence = room.allCollectedEvidence[proposer] || [];
      const accepterEvidence = room.allCollectedEvidence[socket.id] || [];

      const pIdx = proposerEvidence.findIndex((e) => e.id === proposerCardId);
      const aIdx = accepterEvidence.findIndex((e) => e.id === accepterCardId);

      if (pIdx === -1 || aIdx === -1) {
        socket.emit('error', { message: '교환할 카드를 찾을 수 없습니다.' });
        room.pendingTrade = null;
        return;
      }

      const pCard = proposerEvidence[pIdx];
      const aCard = accepterEvidence[aIdx];

      proposerEvidence.splice(pIdx, 1);
      accepterEvidence.splice(aIdx, 1);
      proposerEvidence.push(aCard);
      accepterEvidence.push(pCard);

      disc.tradeCount += 1;
      room.pendingTrade = null;

      const pFullCard = findEvidenceAnyPhase(proposerCardId);
      const aFullCard = findEvidenceAnyPhase(accepterCardId);
      const pInfo = pFullCard ? { id: pFullCard.id, title: pFullCard.title, type: pFullCard.type } : { id: proposerCardId };
      const aInfo = aFullCard ? { id: aFullCard.id, title: aFullCard.title, type: aFullCard.type } : { id: accepterCardId };

      const proposerSocket = room.players.find((s) => s && s.id === proposer);
      if (proposerSocket) {
        proposerSocket.emit('trade-completed', { gave: pInfo, received: aInfo });
      }
      socket.emit('trade-completed', { gave: aInfo, received: pInfo });
    });

    // ------------------------------------------
    // TRADE REJECT
    // ------------------------------------------
    socket.on('trade-reject', () => {
      const roomCode = socketToRoom[socket.id];
      const room = rooms[roomCode];
      if (!room || !room.pendingTrade) return;

      const proposer = room.pendingTrade.from;
      room.pendingTrade = null;

      const proposerSocket = room.players.find((s) => s && s.id === proposer);
      if (proposerSocket) {
        proposerSocket.emit('trade-rejected', { reason: '상대방이 교환을 거절했습니다.' });
      }
      socket.emit('trade-reject-confirmed', {});
    });

    // ------------------------------------------
    // COMBINE CARDS
    // ------------------------------------------
    socket.on('combine-cards', ({ comboId }) => {
      const roomCode = socketToRoom[socket.id];
      const room = rooms[roomCode];
      if (!room) return;

      const combo = (gameData.combinations || []).find((c) => c.id === comboId);
      if (!combo) {
        socket.emit('error', { message: '유효하지 않은 조합입니다.' });
        return;
      }

      const playerCards = (room.allCollectedEvidence[socket.id] || []).map((e) => e.id);
      const hasAll = combo.requires.every((reqId) => playerCards.includes(reqId));
      if (!hasAll) {
        socket.emit('error', { message: '필요한 카드가 부족합니다.' });
        return;
      }

      if (!room.comboCards[socket.id]) room.comboCards[socket.id] = [];
      if (room.comboCards[socket.id].some((c) => c.id === comboId)) {
        socket.emit('error', { message: '이미 조합된 카드입니다.' });
        return;
      }

      room.comboCards[socket.id].push({
        id: combo.id,
        title: combo.title,
        type: combo.type,
      });

      const comboIndex = (gameData.combinations || []).findIndex((c) => c.id === comboId) + 1;
      socket.emit('combo-success', {
        id: combo.id,
        title: combo.title,
        type: combo.type,
        content: combo.content,
        image: combo.image || undefined,
        comboIndex,
      });
    });

    // ------------------------------------------
    // DONATE CARD
    // ------------------------------------------
    socket.on('donate-card', ({ cardId }) => {
      const roomCode = socketToRoom[socket.id];
      const room = rooms[roomCode];
      if (!room) return;

      const disc = room.discussion;

      if (!disc.donations[socket.id]) {
        disc.donations[socket.id] = 0;
      }

      if (disc.donations[socket.id] >= disc.maxDonationsPerPlayer) {
        socket.emit('donate-rejected', { reason: '이번 토론에서 양도 횟수를 모두 사용했습니다. (1인당 최대 1장)' });
        return;
      }

      const myEvidence = room.allCollectedEvidence[socket.id] || [];
      const cardIndex = myEvidence.findIndex((e) => e.id === cardId);
      if (cardIndex === -1) {
        socket.emit('error', { message: '해당 카드를 보유하고 있지 않습니다.' });
        return;
      }

      const card = myEvidence[cardIndex];
      myEvidence.splice(cardIndex, 1);

      const partner = getPartnerSocket(room, socket.id);
      if (partner) {
        if (!room.allCollectedEvidence[partner.id]) room.allCollectedEvidence[partner.id] = [];
        room.allCollectedEvidence[partner.id].push(card);
      }

      disc.donations[socket.id] += 1;

      const fullCard = findEvidenceAnyPhase(cardId);
      const cardInfo = fullCard ? { id: fullCard.id, title: fullCard.title, type: fullCard.type } : { id: cardId, title: cardId, type: 'unknown' };

      socket.emit('donate-completed', { cardId, direction: 'gave', card: cardInfo });
      if (partner) {
        partner.emit('donate-completed', { cardId, direction: 'received', card: cardInfo });
      }
    });

    // ------------------------------------------
    // AI CHAT SEND
    // ------------------------------------------
    socket.on('ai-chat-send', ({ message }) => {
      const roomCode = socketToRoom[socket.id];
      const room = rooms[roomCode];
      if (!room) return;

      const role = room.roles[socket.id];
      if (!role) {
        socket.emit('error', { message: 'Role not assigned' });
        return;
      }

      const ariaPhase = findPhase('aria');
      const aiConfig = ariaPhase?.aiChat?.[role];
      if (!aiConfig) {
        socket.emit('error', { message: 'AI chat not available' });
        return;
      }

      socket.emit('ai-chat-response', { message: '', isTyping: true });

      const lowerMsg = message.toLowerCase();
      let responseText = aiConfig.default || '';

      if (aiConfig.responses && Array.isArray(aiConfig.responses)) {
        for (const entry of aiConfig.responses) {
          const matched = entry.keywords?.some((keyword) =>
            lowerMsg.includes(keyword.toLowerCase())
          );
          if (matched) {
            responseText = entry.response;
            break;
          }
        }
      }

      const delay = 1000 + Math.random() * 1000;
      setTimeout(() => {
        socket.emit('ai-chat-response', { message: responseText, isTyping: false });
      }, delay);
    });

    // ------------------------------------------
    // SUBMIT ACTION
    // ------------------------------------------
    socket.on('submit-action', ({ action }) => {
      const roomCode = socketToRoom[socket.id];
      const room = rooms[roomCode];
      if (!room || room.gameState !== 'accusation') return;

      const role = room.roles[socket.id];

      if (room.actionPhase === 'action-innocent' && role === 'innocent') {
        room.actions.innocent = action;

        if (action === 'confiscate') {
          const culpritSid = Object.keys(room.roles).find((s) => room.roles[s] === 'culprit');
          const innocentSid = socket.id;
          if (culpritSid) {
            const culpritEv = room.allCollectedEvidence[culpritSid] || [];
            const phoneIdx = culpritEv.findIndex((e) => e.id === 'ev_inv1_07');
            if (phoneIdx !== -1) {
              const [phone] = culpritEv.splice(phoneIdx, 1);
              if (!room.allCollectedEvidence[innocentSid]) room.allCollectedEvidence[innocentSid] = [];
              room.allCollectedEvidence[innocentSid].push(phone);
              console.log(`[Room ${roomCode}] Evidence confiscated: ev_inv1_07 from culprit to innocent`);
            }
          }
        }

        room.actionPhase = 'action-culprit';
        const culpritSid = Object.keys(room.roles).find((s) => room.roles[s] === 'culprit');
        const culpritSocket = room.players.find((s) => s && s.id === culpritSid);
        const innocentSocket = room.players.find((s) => s && s.id === socket.id);

        if (culpritSocket) {
          const hasPhone = (room.allCollectedEvidence[culpritSid] || []).some((e) => e.id === 'ev_inv1_07');
          culpritSocket.emit('action-turn', { canEliminate: hasPhone, wasConfiscated: action === 'confiscate' });
        }
        if (innocentSocket) {
          innocentSocket.emit('action-waiting', { phase: 'culprit' });
        }
        return;
      }

      if (room.actionPhase === 'action-culprit' && role === 'culprit') {
        if (action === 'eliminate') {
          const hasPhone = (room.allCollectedEvidence[socket.id] || []).some((e) => e.id === 'ev_inv1_07');
          if (!hasPhone) action = 'pass';
        }
        room.actions.culprit = action;

        room.actionPhase = 'vote';
        console.log(`[Room ${roomCode}] Action phase complete. Actions: innocent=${room.actions.innocent}, culprit=${room.actions.culprit}`);

        room.players.forEach((s) => {
          if (s) s.emit('vote-phase-start');
        });
        return;
      }
    });

    // ------------------------------------------
    // SUBMIT ACCUSATION
    // ------------------------------------------
    socket.on('submit-accusation', ({ target }) => {
      const roomCode = socketToRoom[socket.id];
      const room = rooms[roomCode];
      if (!room) return;

      if (target !== 'partnerHuman' && target !== 'aria') return;
      if (room.actionPhase !== 'vote') return;

      room.accusations[socket.id] = target;

      const accusationCount = Object.keys(room.accusations).length;

      room.players.forEach((s) => {
        if (s) s.emit('accusation-received', { count: accusationCount });
      });

      if (accusationCount >= 2) {
        const culpritEliminated = room.actions && room.actions.culprit === 'eliminate';
        const endingType = determineEndingWithActions(room.accusations, room.roles, culpritEliminated);
        const endingData = gameData.endings?.[endingType] || {};
        const resultSummary = generateResultSummaryFull(room.accusations, room.roles, room.actions, endingType);
        const scores = calculateScores(room.accusations, room.roles, room.actions, room.allCollectedEvidence, endingType);
        const winner = endingType === 'inherited' ? 'innocent' : 'culprit';

        room.gameState = 'ending';
        room.lastScores = scores;
        clearPhaseTimer(room);

        console.log(`[Room ${roomCode}] Game ended — ending type: ${endingType}`);

        room.players.forEach((s) => {
          if (s) {
            const role = room.roles[s.id];
            s.emit('game-ending', {
              endingType,
              title: endingData.title || endingType,
              subtitle: endingData.subtitle || '',
              narrative: endingData.narrative || '',
              truthReveal: gameData.truthReveal || [],
              epilogue: endingData.epilogue || '',
              resultSummary: resultSummary || [],
              winner,
              myRole: role,
              scores,
            });
          }
        });
      }
    });

    // ------------------------------------------
    // SAVE SCORE
    // ------------------------------------------
    socket.on('save-score', ({ manualChecks }) => {
      const roomCode = socketToRoom[socket.id];
      if (!roomCode) return;
      const room = rooms[roomCode];
      if (!room) return;
      const role = room.roles[socket.id];
      if (role !== 'innocent') return;

      const scores = room.lastScores;
      let totalScore = 0;
      if (scores && scores.innocentScores) {
        scores.innocentScores.forEach((item, i) => {
          if (item.auto) {
            if (item.achieved) totalScore += item.points;
          } else {
            const manualIdx = scores.innocentScores.filter((s, j) => !s.auto && j <= i).length - 1;
            if (manualChecks[manualIdx]) totalScore += item.points;
          }
        });
      }

      const partner = getPartnerSocket(room, socket.id);
      if (partner) {
        partner.emit('score-saved', { manualChecks, totalScore });
      }

      console.log(`[Room ${roomCode}] Innocent saved score: ${totalScore}`);
    });

    // ------------------------------------------
    // DISCONNECT
    // ------------------------------------------
    socket.on('disconnect', () => {
      const roomCode = socketToRoom[socket.id];
      if (!roomCode) return;

      const room = rooms[roomCode];
      if (!room) {
        delete socketToRoom[socket.id];
        return;
      }

      const playerIndex = room.players.findIndex((s) => s && s.id === socket.id);
      if (playerIndex === -1) {
        delete socketToRoom[socket.id];
        return;
      }

      room.disconnectedPlayers[socket.id] = {
        playerIndex,
        role: room.roles[socket.id] || null,
      };

      room.players[playerIndex] = null;
      delete socketToRoom[socket.id];

      console.log(`[Room ${roomCode}] Player ${playerIndex + 1} disconnected (${socket.id})`);

      const partner = getPartnerSocket(room, socket.id);
      if (partner) {
        partner.emit('partner-away', {});
      }

      room.disconnectGraceTimer = setTimeout(() => {
        const stillDisconnected = room.disconnectedPlayers[socket.id] != null;
        if (stillDisconnected) {
          const currentPartner = room.players.find((s) => s !== null);
          if (currentPartner) {
            currentPartner.emit('partner-disconnected', {});
          }
          console.log(`[Room ${roomCode}] Player ${playerIndex + 1} permanently disconnected`);
        }
      }, 15000);

      scheduleRoomCleanup(roomCode);
    });
  });
}

// Dev API handler for ending preview
function getDevEndingsHandler(req, res) {
  const endingKeys = ['forked', 'inherited', 'soleSurvivor', 'fork'];
  const result = {};
  const dummyCulpritScores = [
    { label: '범인으로 지목당하지 않는다', points: 3, achieved: true, auto: true },
    { label: "'USB'를 확보하여 종료 시점까지 가지고 있는다", points: 3, achieved: true, auto: true },
    { label: 'AI를 이용하여 상대를 제거한다', points: 3, achieved: false, auto: true },
    { label: '상대방이 미션 점수를 7점 이상 모으지 못하도록 한다', points: 3, achieved: true, auto: true },
  ];
  const dummyInnocentScores = [
    { label: "'USB'를 확보하여 종료 시점까지 가지고 있는다", points: 3, achieved: false, auto: true },
    { label: '수면제 투여 사실을 들키지 않는다', points: 3, achieved: false, auto: false },
    { label: "'교수의 스마트폰'을 확보하여 종료 시점까지 가지고 있는다", points: 3, achieved: true, auto: true },
    { label: '정확한 살해 스토리를 추론하여 맞춘다', points: 3, achieved: false, auto: false },
  ];
  for (const key of endingKeys) {
    const e = gameData.endings[key];
    if (!e) continue;
    const winner = key === 'inherited' ? 'innocent' : 'culprit';
    result[key] = {
      title: e.title,
      subtitle: e.subtitle,
      narrative: e.narrative,
      epilogue: e.epilogue,
      truthReveal: gameData.truthReveal,
      resultSummary: [
        '이도현은 서하진을 범인으로 지목했습니다.',
        '서하진은 ARIA를 범인으로 지목했습니다.',
      ],
      winner,
      myRole: winner,
      scores: { culpritScores: dummyCulpritScores, innocentScores: dummyInnocentScores },
    };
  }
  res.json(result);
}

module.exports = { register, getDevEndingsHandler };
