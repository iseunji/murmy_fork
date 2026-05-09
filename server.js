const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const gameData = require('./game-data');

// ---------------------------------------------------------------------------
// Express + HTTP + Socket.io setup
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 4567;

// Serve static files from ./public
app.use(express.static(path.join(__dirname, 'public')));

// SPA catch-all: serve index.html for every route
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
  // Support flat array (shared pool) or role-based object
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
  // Support flat array (shared pool) or role-based object
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
  // Also check combinations
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

    // Build turn order guidance for investigation2
    let turnOrderGuidance = null;
    if (phaseId === 'investigation2' && room.firstCollectorPhase1) {
      const firstInPhase1 = room.firstCollectorPhase1;
      const isThisPlayerFirst = firstInPhase1 === socket.id;
      turnOrderGuidance = isThisPlayerFirst
        ? '이번 조사에서는 상대방이 먼저 조사를 시작합니다.'
        : '이번 조사에서는 당신이 먼저 조사를 시작합니다.';
    }

    // Build discussion rules for discussion phases
    let discussionRules = null;
    if (phaseId === 'discussion1' || phaseId === 'discussion2') {
      discussionRules = {
        maxTrades: 2,
        maxDonationsPerPlayer: 1,
      };
    }

    // For discussion phases, send collected evidence so players can review/trade/combine
    const isDiscussion = phaseId === 'discussion1' || phaseId === 'discussion2';
    const collectedEvidence = isDiscussion
      ? (room.allCollectedEvidence[socket.id] || []).map((e) => ({ id: e.id, title: e.title, type: e.type }))
      : [];

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
    });

    // Auto-send AI greeting when entering the aria (AI chat) phase
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
  // Clear any existing timer
  clearPhaseTimer(room);

  const phaseId = room.gameState;
  const phase = findPhase(phaseId);
  if (!phase || !phase.duration) return;

  room.timerRemaining = phase.duration;

  room.timerInterval = setInterval(() => {
    room.timerRemaining -= 1;

    // Broadcast remaining time to all players in room
    room.players.forEach((socket) => {
      if (socket) {
        socket.emit('timer-update', { remaining: room.timerRemaining });
      }
    });

    if (room.timerRemaining <= 0) {
      clearPhaseTimer(room);

      // Auto-assign remaining evidence if collection is still active
      const ec = room.evidenceCollection;
      if (ec.active) {
        // Alternate turns, distributing shared pool items between players
        let turnIdx = ec.currentTurnIndex;
        const autoPhaseId = room.gameState;
        while (ec.sharedPool.length > 0) {
          const sid = ec.turnOrder[turnIdx % ec.turnOrder.length];
          const item = ec.sharedPool.shift();
          ec.picked[sid].push(item.id);
          // Track in allCollectedEvidence
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

        // Notify both players that collection is complete
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

  // Reset evidence collection state for the new phase
  room.evidenceCollection = {
    readyToCollect: [],
    turnOrder: [],
    currentTurnIndex: 0,
    sharedPool: [],
    picked: {},
    active: false,
  };

  // Reset discussion state for new discussion phases
  room.discussion = {
    tradeCount: 0,
    maxTrades: 2,
    donations: {},
    maxDonationsPerPlayer: 1,
  };

  const currentPhase = room.gameState;

  if (currentPhase === 'intro') {
    // Move from intro to first investigation phase
    room.gameState = PHASE_ORDER[0];
    console.log(`[Room ${room.code}] Phase transition: intro -> ${room.gameState}`);
    sendPhaseData(room);
    startPhaseTimer(room);
    return;
  }

  const idx = PHASE_ORDER.indexOf(currentPhase);
  if (idx === -1) return; // Unknown state, do nothing

  if (idx < PHASE_ORDER.length - 1) {
    // Move to next phase
    room.gameState = PHASE_ORDER[idx + 1];
    console.log(`[Room ${room.code}] Phase transition: ${currentPhase} -> ${room.gameState}`);
    sendPhaseData(room);
    startPhaseTimer(room);
  } else {
    // After the last phase (verdict), move to ending
    // Ending is triggered by accusations, not by timer, so this is a fallback
    room.gameState = 'ending';
    console.log(`[Room ${room.code}] Phase transition: ${currentPhase} -> ending`);
  }
}

// ---------------------------------------------------------------------------
// Helper: determine ending from accusations
// ---------------------------------------------------------------------------
function determineEnding(accusations, roles) {
  const accEntries = Object.entries(accusations);

  // Check if the culprit chose to eliminate their partner via ARIA
  const culpritEntry = accEntries.find(([sid]) => roles[sid] === 'culprit');
  if (culpritEntry && culpritEntry[1] === 'eliminatePartner') {
    return 'soleSurvivor';
  }

  const accValues = Object.values(accusations);

  // Both accuse AI
  if (accValues.every((a) => a === 'aria')) {
    return 'forked';
  }

  // Both accuse their partner (the other human)
  if (accValues.every((a) => a === 'partnerHuman')) {
    return 'mutual';
  }

  // Anyone accuses a human (partner or self)
  if (accValues.some((a) => a === 'partnerHuman' || a === 'self')) {
    return 'inherited';
  }

  // Fallback (should not normally be reached)
  return 'inherited';
}

// ---------------------------------------------------------------------------
// Helper: schedule room cleanup after disconnect
// ---------------------------------------------------------------------------
function scheduleRoomCleanup(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  room.cleanupTimer = setTimeout(() => {
    // Check if room is still missing a player
    const connectedCount = room.players.filter((s) => s !== null).length;
    if (connectedCount === 0) {
      clearPhaseTimer(room);
      delete rooms[roomCode];
      console.log(`[Room ${roomCode}] Cleaned up (no players reconnected within 60s)`);
    }
  }, 60000);
}

// ---------------------------------------------------------------------------
// Socket.io connection handler
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  // ------------------------------------------
  // CREATE ROOM
  // ------------------------------------------
  socket.on('create-room', () => {
    const roomCode = generateRoomCode();

    const room = {
      code: roomCode,
      players: [socket, null], // index 0 = Player 1, index 1 = Player 2
      gameState: 'lobby',
      roles: {},
      readyCount: 0,
      characterSelections: {},
      accusations: {},
      timerInterval: null,
      timerRemaining: 0,
      cleanupTimer: null,
      disconnectedPlayers: {}, // socketId -> { playerIndex, role }
      evidenceCollection: {
        readyToCollect: [],    // socket.ids of players who clicked "go collect"
        turnOrder: [],         // [socketId1, socketId2]
        currentTurnIndex: 0,   // index into turnOrder
        sharedPool: [],        // [{id, title, type}, ...] single shared pool for both players
        picked: {},            // socketId -> [evidenceId, ...] picked evidence IDs
        active: false,         // whether collection is in progress
      },
      firstCollectorPhase1: null, // socketId of the player who started first in investigation1
      discussion: {
        tradeCount: 0,         // number of card exchanges performed in current discussion
        maxTrades: 2,          // max card exchanges per discussion phase
        donations: {},         // socketId -> number of cards donated this discussion
        maxDonationsPerPlayer: 1, // max cards a player can donate per discussion phase
      },
      allCollectedEvidence: {},  // socketId -> [{id, title, type, phase}] — persists across phases
      comboCards: {},             // socketId -> [{id, title, type}]
      pendingTrade: null,        // { from: socketId, cardId: string } or null
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

    // Check if this is a reconnection
    const disconnectedEntry = Object.entries(room.disconnectedPlayers).find(
      ([, info]) => info !== null
    );

    // Check if room is full (both player slots occupied by connected sockets)
    const connectedCount = room.players.filter((s) => s !== null).length;
    if (connectedCount >= 2) {
      socket.emit('room-joined', { success: false, error: 'Room is full' });
      return;
    }

    // Find the empty slot
    let playerIndex = room.players.indexOf(null);
    let role = null;

    // If there is a disconnected player entry, use their slot and role
    if (disconnectedEntry) {
      const [oldSocketId, info] = disconnectedEntry;
      playerIndex = info.playerIndex;
      role = info.role;

      // Transfer role mapping to new socket
      if (role) {
        delete room.roles[oldSocketId];
        room.roles[socket.id] = role;
      }

      // Transfer accusation if one was stored
      if (room.accusations[oldSocketId] !== undefined) {
        room.accusations[socket.id] = room.accusations[oldSocketId];
        delete room.accusations[oldSocketId];
      }

      delete room.disconnectedPlayers[oldSocketId];

      // Cancel cleanup timer
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

    // Notify the other player
    const partner = getPartnerSocket(room, socket.id);
    if (partner) {
      partner.emit('player-joined', { playerNum });
    }

    // If this is a reconnection mid-game, restore state
    if (role && room.gameState !== 'lobby') {
      // Re-send game-start info
      const briefing = gameData.roles?.[role]?.briefing || '';
      const prologueNarrative = buildNarrative('prologue', role);
      socket.emit('game-start', { role, briefing, playerNum, prologueNarrative });

      // Re-send current phase data if applicable
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
          // Send current timer state
          if (room.timerRemaining > 0) {
            socket.emit('timer-update', { remaining: room.timerRemaining });
          }

          // If evidence collection is active, re-send state to reconnected player
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
    if (!room) {
      console.log(`[player-ready] No room found for socket ${socket.id}`);
      return;
    }

    room.readyCount += 1;

    // Notify the OTHER player which dot to light up.
    // The player who pressed ready already has instant feedback from their click handler.
    const playerIndex = room.players.findIndex((s) => s && s.id === socket.id);
    const playerNum = playerIndex + 1;
    console.log(`[Room ${roomCode}] player-ready from socket ${socket.id}, playerIndex=${playerIndex}, playerNum=${playerNum}`);
    room.players.forEach((s) => {
      if (s && s.id !== socket.id) s.emit('ready-update', { playerNum });
    });

    // Need both players connected and ready
    const connectedCount = room.players.filter((s) => s !== null).length;
    if (room.readyCount >= 2 && connectedCount >= 2) {
      // Transition to character selection
      room.gameState = 'character-select';
      room.characterSelections = {};
      room.readyCount = 0;
      console.log(`[Room ${roomCode}] Both ready — showing character select`);

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

    // Toggle: clicking the same character deselects it
    if (previousSelection === characterId) {
      delete room.characterSelections[socket.id];
      socket.emit('character-deselected', { characterId });
      if (partner) {
        partner.emit('character-freed-by-other', { characterId });
      }
      return;
    }

    // Check if already taken by the other player
    const otherPlayerId = Object.keys(room.characterSelections).find(id => id !== socket.id);
    if (otherPlayerId && room.characterSelections[otherPlayerId] === characterId) {
      socket.emit('character-taken', { characterId });
      return;
    }

    // Free previous selection if switching characters
    if (previousSelection && partner) {
      partner.emit('character-freed-by-other', { characterId: previousSelection });
    }

    room.characterSelections[socket.id] = characterId;

    // Notify partner this character was claimed
    if (partner) {
      partner.emit('character-selected-by-other', { characterId });
    }

    // Confirm to this player
    socket.emit('character-confirmed', { characterId });

    // If both selected, assign roles and start
    const selectedCount = Object.keys(room.characterSelections).length;
    if (selectedCount >= 2) {
      const shuffled = [...room.players].filter(Boolean);
      // 하진(hajin)을 선택한 플레이어가 항상 범인
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
        const prologueNarrative = buildNarrative('prologue', role);
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

    // Broadcast ready count to all in room
    room.players.forEach((s) => {
      if (s) s.emit('phase-ready-count', { count: room.readyCount });
    });

    const connectedCount = room.players.filter((s) => s !== null).length;
    if (room.readyCount >= 2 && connectedCount >= 2) {
      advancePhase(room);
    }
  });

  // ------------------------------------------
  // REQUEST EVIDENCE (searches all phases globally)
  // ------------------------------------------
  socket.on('request-evidence', ({ evidenceId }) => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];
    if (!room) return;

    // Check if player has this evidence (in allCollectedEvidence or comboCards)
    const hasInCollected = (room.allCollectedEvidence[socket.id] || []).some((e) => e.id === evidenceId);
    const hasInCombo = (room.comboCards[socket.id] || []).some((c) => c.id === evidenceId);
    // Also allow during active collection (current phase picked list)
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

    // Check if this card can be combined
    const comboInfo = (gameData.combinations || []).find((c) => c.requires.includes(evidenceId));
    let canCombine = false;
    let comboId = undefined;
    if (comboInfo) {
      comboId = comboInfo.id;
      const playerCards = (room.allCollectedEvidence[socket.id] || []).map((e) => e.id);
      canCombine = comboInfo.requires.every((reqId) => playerCards.includes(reqId));
      // Don't allow if already combined
      const alreadyCombined = (room.comboCards[socket.id] || []).some((c) => c.id === comboInfo.id);
      if (alreadyCombined) canCombine = false;
    }

    // Check if donate/exchange are available (discussion phases only)
    const isDiscussion = room.gameState === 'discussion1' || room.gameState === 'discussion2';
    const disc = room.discussion;
    const canDonate = isDiscussion && (disc.donations[socket.id] || 0) < disc.maxDonationsPerPlayer;
    const canExchange = isDiscussion && disc.tradeCount < disc.maxTrades;

    socket.emit('evidence-detail', {
      id: evidence.id,
      title: evidence.title,
      type: evidence.type,
      content: evidence.content,
      image: evidence.image || undefined,
      comboHint: evidence.comboHint || undefined,
      canCombine,
      comboId,
      canDonate,
      canExchange,
      isComboCard: hasInCombo,
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

    // Ignore if collection already active or player already clicked
    if (ec.active) return;
    if (ec.readyToCollect.includes(socket.id)) return;

    ec.readyToCollect.push(socket.id);

    if (ec.readyToCollect.length === 1) {
      // Only one player ready so far — tell them to wait
      socket.emit('evidence-waiting', {});
    } else if (ec.readyToCollect.length >= 2) {
      // Both players are ready — start the collection
      const phaseId = room.gameState;

      // Determine turn order: in investigation2, swap from investigation1's order
      if (phaseId === 'investigation2' && room.firstCollectorPhase1) {
        // The player who did NOT go first in investigation1 goes first now
        const secondPlayer = ec.readyToCollect.find((sid) => sid !== room.firstCollectorPhase1)
          || ec.readyToCollect[1];
        const firstPlayer = ec.readyToCollect.find((sid) => sid !== secondPlayer)
          || ec.readyToCollect[0];
        ec.turnOrder = [secondPlayer, firstPlayer];
      } else {
        ec.turnOrder = [ec.readyToCollect[0], ec.readyToCollect[1]];
      }

      // Track who goes first in investigation1 for future swap
      if (phaseId === 'investigation1') {
        room.firstCollectorPhase1 = ec.turnOrder[0];
      }

      ec.currentTurnIndex = 0;
      ec.active = true;

      // Build a single shared pool from both roles' evidence
      ec.sharedPool = buildSharedEvidenceList(phaseId);
      ec.turnOrder.forEach((sid) => {
        ec.picked[sid] = [];
      });

      // Emit initial state — both players see the same shared pool
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

    // Validate: collection must be active and it must be this player's turn
    if (!ec.active) return;
    const currentTurnSocketId = ec.turnOrder[ec.currentTurnIndex];
    if (currentTurnSocketId !== socket.id) return;

    // Find and remove the evidence from the shared pool
    const itemIndex = ec.sharedPool.findIndex((e) => e.id === evidenceId);
    if (itemIndex === -1) return;
    ec.sharedPool.splice(itemIndex, 1);

    // Add to this player's picked list
    ec.picked[socket.id].push(evidenceId);

    // Get full evidence content (search across all roles) and send to the picking player
    const phaseId = room.gameState;
    const fullEvidence = findEvidenceGlobal(phaseId, evidenceId);

    // Also track in allCollectedEvidence (persists across phases)
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
        comboHint: fullEvidence.comboHint || undefined,
        metadata: fullEvidence.metadata || undefined,
      });
    }

    // Notify the other player
    const partner = getPartnerSocket(room, socket.id);
    if (partner) {
      partner.emit('partner-picked', {});
    }

    // Advance turn
    ec.currentTurnIndex = (ec.currentTurnIndex + 1) % 2;

    // Check if shared pool is empty
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
      // Send updated shared pool to both players
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
  // TRADE PROPOSE (discussion phase — propose a card exchange)
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

    // Verify the card exists in player's collection
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
  // TRADE ACCEPT (partner accepts and offers their card)
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

    // Swap cards in allCollectedEvidence
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

    // Swap
    proposerEvidence.splice(pIdx, 1);
    accepterEvidence.splice(aIdx, 1);
    proposerEvidence.push(aCard);
    accepterEvidence.push(pCard);

    disc.tradeCount += 1;
    room.pendingTrade = null;

    // Notify both
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

    // Check if player has all required cards
    const playerCards = (room.allCollectedEvidence[socket.id] || []).map((e) => e.id);
    const hasAll = combo.requires.every((reqId) => playerCards.includes(reqId));
    if (!hasAll) {
      socket.emit('error', { message: '필요한 카드가 부족합니다.' });
      return;
    }

    // Check if already combined
    if (!room.comboCards[socket.id]) room.comboCards[socket.id] = [];
    if (room.comboCards[socket.id].some((c) => c.id === comboId)) {
      socket.emit('error', { message: '이미 조합된 카드입니다.' });
      return;
    }

    // Add combo card
    room.comboCards[socket.id].push({
      id: combo.id,
      title: combo.title,
      type: combo.type,
    });

    // Send combo card details
    socket.emit('combo-success', {
      id: combo.id,
      title: combo.title,
      type: combo.type,
      content: combo.content,
      image: combo.image || undefined,
    });
  });

  // ------------------------------------------
  // DONATE CARD (discussion phase — one-way transfer)
  // ------------------------------------------
  socket.on('donate-card', ({ cardId }) => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];
    if (!room) return;

    const disc = room.discussion;

    // Initialize donation count for this player
    if (!disc.donations[socket.id]) {
      disc.donations[socket.id] = 0;
    }

    // Validate donation limit
    if (disc.donations[socket.id] >= disc.maxDonationsPerPlayer) {
      socket.emit('donate-rejected', { reason: '이번 토론에서 양도 횟수를 모두 사용했습니다. (1인당 최대 1장)' });
      return;
    }

    // Find and move the card in allCollectedEvidence
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

    // Get full card info for notification
    const fullCard = findEvidenceAnyPhase(cardId);
    const cardInfo = fullCard ? { id: fullCard.id, title: fullCard.title, type: fullCard.type } : { id: cardId, title: cardId, type: 'unknown' };

    // Notify both players of the donation
    socket.emit('donate-completed', { cardId, direction: 'gave', card: cardInfo });
    if (partner) {
      partner.emit('donate-completed', { cardId, direction: 'received', card: cardInfo });
    }
  });

  // ------------------------------------------
  // AI CHAT SEND (aria phase)
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

    // AI chat data is inside the 'aria' phase
    const ariaPhase = findPhase('aria');
    const aiConfig = ariaPhase?.aiChat?.[role];
    if (!aiConfig) {
      socket.emit('error', { message: 'AI chat not available' });
      return;
    }

    // Send typing indicator immediately
    socket.emit('ai-chat-response', { message: '', isTyping: true });

    // Find matching response by keyword
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

    // Artificial delay of 1-2 seconds before sending the actual response
    const delay = 1000 + Math.random() * 1000;
    setTimeout(() => {
      socket.emit('ai-chat-response', { message: responseText, isTyping: false });
    }, delay);
  });

  // ------------------------------------------
  // SUBMIT ACCUSATION (verdict phase)
  // ------------------------------------------
  socket.on('submit-accusation', ({ target }) => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];
    if (!room) return;

    // Store accusation
    room.accusations[socket.id] = target;

    const accusationCount = Object.keys(room.accusations).length;

    // Broadcast accusation count
    room.players.forEach((s) => {
      if (s) s.emit('accusation-received', { count: accusationCount });
    });

    // When both have submitted, determine ending
    if (accusationCount >= 2) {
      const endingType = determineEnding(room.accusations, room.roles);
      const endingData = gameData.endings?.[endingType] || {};

      room.gameState = 'ending';
      clearPhaseTimer(room);

      console.log(`[Room ${roomCode}] Game ended — ending type: ${endingType}`);

      room.players.forEach((s) => {
        if (s) {
          s.emit('game-ending', {
            endingType,
            title: endingData.title || endingType,
            narrative: endingData.narrative || '',
            epilogue: endingData.epilogue || '',
          });
        }
      });
    }
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

    // Find which player slot this socket occupied
    const playerIndex = room.players.findIndex((s) => s && s.id === socket.id);
    if (playerIndex === -1) {
      delete socketToRoom[socket.id];
      return;
    }

    // Store disconnected player info for potential reconnection
    room.disconnectedPlayers[socket.id] = {
      playerIndex,
      role: room.roles[socket.id] || null,
    };

    // Vacate the player slot
    room.players[playerIndex] = null;
    delete socketToRoom[socket.id];

    console.log(`[Room ${roomCode}] Player ${playerIndex + 1} disconnected (${socket.id})`);

    // Notify partner
    const partner = getPartnerSocket(room, socket.id);
    if (partner) {
      partner.emit('partner-disconnected', {});
    }

    // Schedule cleanup if no one reconnects within 60 seconds
    scheduleRoomCleanup(roomCode);
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`[Server] Murder mystery game running on http://localhost:${PORT}`);
});
