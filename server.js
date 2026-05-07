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
const PHASE_ORDER = ['discovery', 'scene', 'digital', 'aria', 'truth', 'verdict'];

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
  if (!phase || !phase.evidence || !phase.evidence[role]) return null;
  return phase.evidence[role].find((e) => e.id === evidenceId) || null;
}

// ---------------------------------------------------------------------------
// Helper: build the evidence *list* (without content) for a role in a phase
// ---------------------------------------------------------------------------
function buildEvidenceList(phaseId, role) {
  const phase = findPhase(phaseId);
  if (!phase || !phase.evidence || !phase.evidence[role]) return [];
  return phase.evidence[role].map((e) => ({
    id: e.id,
    title: e.title,
    type: e.type,
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

  room.players.forEach((socket) => {
    if (!socket) return;
    const role = room.roles[socket.id];
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
        // Alternate turns, assigning each player's remaining pool to their picked list
        let turnIdx = ec.currentTurnIndex;
        let hasRemaining = true;
        while (hasRemaining) {
          hasRemaining = false;
          for (let i = 0; i < ec.turnOrder.length; i++) {
            const idx = (turnIdx + i) % ec.turnOrder.length;
            const sid = ec.turnOrder[idx];
            if (ec.pools[sid] && ec.pools[sid].length > 0) {
              const item = ec.pools[sid].shift();
              ec.picked[sid].push(item.id);
              hasRemaining = true;
            }
          }
          turnIdx++;
        }
        ec.active = false;

        // Notify both players that collection is complete
        room.players.forEach((s) => {
          if (s) {
            s.emit('evidence-collection-complete', {
              collected: ec.picked[s.id] || [],
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
    pools: {},
    picked: {},
    active: false,
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
function determineEnding(accusations) {
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
        pools: {},             // socketId -> [{id, title, type}, ...] remaining evidence
        picked: {},            // socketId -> [evidenceId, ...] picked evidence IDs
        active: false,         // whether collection is in progress
      },
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
      socket.emit('game-start', { role, briefing, playerNum });

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

    // Broadcast which player is ready (so both can see dots light up)
    const playerIndex = room.players.indexOf(socket);
    const playerNum = playerIndex + 1;
    console.log(`[Room ${roomCode}] player-ready from socket ${socket.id}, playerIndex=${playerIndex}, playerNum=${playerNum}`);
    room.players.forEach((s) => {
      if (s) s.emit('ready-update', { playerNum });
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

    // Check if already taken by the other player
    const alreadyTaken = Object.values(room.characterSelections).includes(characterId);
    if (alreadyTaken) {
      socket.emit('character-taken', { characterId });
      return;
    }

    room.characterSelections[socket.id] = characterId;

    // Notify partner this character was claimed
    const partner = getPartnerSocket(room, socket.id);
    if (partner) {
      partner.emit('character-selected-by-other', { characterId });
    }

    // Confirm to this player
    socket.emit('character-confirmed', { characterId });

    // If both selected, assign roles and start
    const selectedCount = Object.keys(room.characterSelections).length;
    if (selectedCount >= 2) {
      const shuffled = [...room.players].filter(Boolean);
      const roleAssignment = Math.random() < 0.5
        ? ['culprit', 'innocent']
        : ['innocent', 'culprit'];

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
        s.emit('game-start', {
          role,
          briefing,
          playerNum: pIdx + 1,
          character: character || null,
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
  // REQUEST EVIDENCE
  // ------------------------------------------
  socket.on('request-evidence', ({ evidenceId }) => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];
    if (!room) return;

    const role = room.roles[socket.id];
    if (!role) {
      socket.emit('error', { message: 'Role not assigned' });
      return;
    }

    // Only allow viewing evidence the player has previously picked
    const pickedList = room.evidenceCollection.picked[socket.id];
    if (pickedList && !pickedList.includes(evidenceId)) {
      socket.emit('error', { message: 'You have not collected this evidence' });
      return;
    }

    const phaseId = room.gameState;
    const evidence = findEvidence(phaseId, role, evidenceId);

    if (!evidence) {
      socket.emit('error', { message: 'Evidence not found' });
      return;
    }

    socket.emit('evidence-detail', {
      id: evidence.id,
      title: evidence.title,
      type: evidence.type,
      content: evidence.content,
      metadata: evidence.metadata || undefined,
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
      ec.turnOrder = [ec.readyToCollect[0], ec.readyToCollect[1]];
      ec.currentTurnIndex = 0;
      ec.active = true;

      const phaseId = room.gameState;

      // Initialize pools and picked for each player
      ec.turnOrder.forEach((sid) => {
        const role = room.roles[sid];
        ec.pools[sid] = buildEvidenceList(phaseId, role);
        ec.picked[sid] = [];
      });

      // Emit initial state to both players
      const currentTurnSocketId = ec.turnOrder[ec.currentTurnIndex];
      room.players.forEach((s) => {
        if (!s) return;
        s.emit('evidence-collection-state', {
          pool: ec.pools[s.id] || [],
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

    // Find and remove the evidence from this player's pool
    const pool = ec.pools[socket.id];
    if (!pool) return;
    const itemIndex = pool.findIndex((e) => e.id === evidenceId);
    if (itemIndex === -1) return;
    pool.splice(itemIndex, 1);

    // Add to picked list
    ec.picked[socket.id].push(evidenceId);

    // Get full evidence content and send to the picking player
    const role = room.roles[socket.id];
    const phaseId = room.gameState;
    const fullEvidence = findEvidence(phaseId, role, evidenceId);
    if (fullEvidence) {
      socket.emit('evidence-picked', {
        id: fullEvidence.id,
        title: fullEvidence.title,
        type: fullEvidence.type,
        content: fullEvidence.content,
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

    // Check if BOTH pools are empty
    const allEmpty = ec.turnOrder.every(
      (sid) => !ec.pools[sid] || ec.pools[sid].length === 0
    );

    if (allEmpty) {
      ec.active = false;
      room.players.forEach((s) => {
        if (s) {
          s.emit('evidence-collection-complete', {
            collected: ec.picked[s.id] || [],
          });
        }
      });
    } else {
      // Send updated state to both players
      const nextTurnSocketId = ec.turnOrder[ec.currentTurnIndex];
      room.players.forEach((s) => {
        if (!s) return;
        s.emit('evidence-collection-state', {
          pool: ec.pools[s.id] || [],
          isYourTurn: nextTurnSocketId === s.id,
          pickedCount: (ec.picked[s.id] || []).length,
        });
      });
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
      const endingType = determineEnding(room.accusations);
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
