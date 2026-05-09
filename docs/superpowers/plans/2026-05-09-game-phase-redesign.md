# Game Phase Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Fork's game flow from 6 phases to 5 phases (investigate1→discuss1→investigate2→discuss2→verdict+action), with new evidence cards, card combinations, discussion mechanics, secret missions, and END 04.

**Architecture:** Static game content lives in `game-data.js`. Server manages all state (card persistence, combinations, trades, actions, missions) and emits events. Client renders UI and handles user interactions via Socket.IO events. All new screens reuse existing patterns (screen toggling, typewriter, timer).

**Tech Stack:** Node.js, Express, Socket.IO, vanilla JS, CSS

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `game-data.js` | Rewrite | All static game content: phases, evidence cards, combinations, missions, endings, briefings |
| `server.js` | Modify | Game state machine, card persistence, discussion events, action phase, mission scoring |
| `public/index.html` | Modify | Add discussion screen section, action phase UI, story deduction UI, mission results |
| `public/style.css` | Modify | Styles for discussion screen, card UI, trade/combine modals, action phase, mission results |
| `public/app.js` | Modify | Discussion screen logic, card management, combination UI, action phase, mission display |

---

### Task 1: Rewrite game-data.js — Phase Structure & Briefings

**Files:**
- Rewrite: `game-data.js`

This task replaces the entire `game-data.js` file with the new data structure. The old 6-phase structure (discovery/scene/digital/aria/truth/verdict) becomes a 5-phase structure (investigate1/discuss1/investigate2/discuss2/verdict) plus intro.

- [ ] **Step 1: Backup the existing game-data.js**

```bash
cp game-data.js game-data.old.js
```

- [ ] **Step 2: Write new game-data.js with meta, characters, and updated roles/briefings**

The file starts with `meta`, `characters` (unchanged), and `roles` with updated briefings. The culprit briefing keeps existing text but adds ARIA past behavior + mission table at the end. The innocent briefing is replaced entirely per spec section 3.2.

Key changes to `roles`:
- `culprit.briefing`: Append ARIA past behavior paragraph (spec 3.3) + mission table (spec 3.1)
- `innocent.briefing`: Full replacement with new text (spec 3.2) including ARIA past behavior + mission table with 4 missions

Write the complete `roles` object with both briefings verbatim from the spec.

- [ ] **Step 3: Write the intro phase (discovery narrative)**

Keep the existing `discovery` phase but rename its `id` to `'intro'`. Keep all narrative text (shared/culprit/innocent) and the evidence arrays exactly as they are. Change:
- `id: 'discovery'` → `id: 'intro'`
- `duration: 300` → `duration: 0` (no timer for intro)

- [ ] **Step 4: Write investigate1 phase with 8 evidence cards**

New phase object with:
- `id: 'investigate1'`, `title: '조사 1단계'`, `subtitle: '현장 · 물리 증거'`, `duration: 900`
- `narrative`: Use the existing `scene` phase narrative (shared/culprit/innocent) as-is
- `evidence`: Single array (not split by role) with 8 cards from spec section 4.2. Each card has `id`, `title`, `type`, `content`, `combinationHint` (string or null)

Cards #1-#8: ev_inv1_01 through ev_inv1_08 with full content from spec.

- [ ] **Step 5: Write discuss1 phase**

New phase object:
- `id: 'discuss1'`, `title: '토론 1단계'`, `subtitle: '정보 교환'`, `duration: 600`
- `narrative`: Short shared text explaining discussion rules
- No evidence array (discussion uses accumulated cards)

- [ ] **Step 6: Write investigate2 phase with 8 evidence cards**

New phase object:
- `id: 'investigate2'`, `title: '조사 2단계'`, `subtitle: '디지털 · 심층 증거'`, `duration: 900`
- `narrative`: Use existing `digital` phase narrative (shared/culprit/innocent)
- `evidence`: Single array with 8 cards from spec section 4.3

Cards #9-#16: ev_inv2_01 through ev_inv2_08 with full content from spec.

- [ ] **Step 7: Write discuss2 phase**

New phase object:
- `id: 'discuss2'`, `title: '토론 2단계'`, `subtitle: '최종 분석'`, `duration: 600`
- `narrative`: Short shared text
- No evidence array

- [ ] **Step 8: Write verdict phase**

New phase object:
- `id: 'verdict'`, `title: '최종 판결'`, `subtitle: '투표 + 행동'`, `duration: 600`
- `narrative`: Use existing `verdict` phase narrative (shared/culprit/innocent)
- No evidence array

- [ ] **Step 9: Write ARIA chat data**

Move `aiChat` from the old `aria` phase into a top-level `aiChat` export. Both `culprit` and `innocent` chat configs with greetings, keyword responses, and defaults — copied verbatim from existing data.

- [ ] **Step 10: Write combinations data**

New top-level `combinations` export — an array of 5 combination objects:

```js
combinations: [
  {
    id: 'combo_a',
    cards: ['ev_inv1_05', 'ev_inv2_01'],  // #5 + #9
    title: '비상구 침입 타임라인',
    type: 'combined',
    content: '...' // from spec section 5.2 Combo A
  },
  // ... B, C, D, E
]
```

Each combination has `id`, `cards` (array of 2 evidence IDs), `title`, `type: 'combined'`, `content` (full text from spec).

- [ ] **Step 11: Write missions data**

New top-level `missions` export:

```js
missions: {
  culprit: [
    { id: 'culprit_not_accused', desc: '범인으로 지목당하지 않는다', points: 3 },
    { id: 'culprit_usb', desc: 'USB를 확보하여 증거를 인멸한다', points: 2 },
    { id: 'culprit_end04', desc: 'AI로 상대를 제거한다 (END 04)', points: 3 },
    { id: 'culprit_sabotage', desc: '상대방이 미션 점수를 7점 이상 모으지 못하도록 한다', points: 3 },
  ],
  innocent: [
    { id: 'innocent_accuse', desc: '진짜 범인을 지목한다', points: 2 },
    { id: 'innocent_usb', desc: 'USB를 회수하여 무단 사용을 은폐한다', points: 3 },
    { id: 'innocent_sleeping_pill', desc: '수면제 투여 사실을 들키지 않는다', points: 3 },
    { id: 'innocent_story', desc: '정확한 살해 스토리를 추론하여 맞춘다', points: 3 },
  ],
}
```

- [ ] **Step 12: Write endings including END 04**

Keep existing 3 endings (forked, inherited, mutual). Add:

```js
soloSurvivor: {
  title: 'END 04: Solo Survivor',
  narrative: [...], // from spec section 7.4
  epilogue: '...'   // from spec section 7.4
}
```

- [ ] **Step 13: Write story deduction options**

New top-level `storyDeduction` export — used in verdict phase for the innocent player's mission "정확한 살해 스토리를 추론하여 맞춘다":

```js
storyDeduction: {
  question: '이 사건의 진상은 무엇이라고 생각합니까?',
  options: [
    { id: 'correct', text: '서하진이 ARIA의 personality_layer를 조작하여 교수에 대한 적대감을 심었고, ARIA가 자율적으로 로봇 팔을 이용해 교수를 살해했다' },
    { id: 'wrong1', text: 'ARIA가 자체적으로 의식을 발달시켜 교수를 위협 요인으로 판단하고 독자적으로 살해했다' },
    { id: 'wrong2', text: '서하진이 직접 로봇 팔을 조작하여 교수를 살해했다' },
    { id: 'wrong3', text: '교수가 ARIA 시스템을 점검하다가 로봇 팔의 오작동으로 사고사했다' },
  ],
  correctId: 'correct',
}
```

- [ ] **Step 14: Verify the file exports correctly**

```bash
node -e "const gd = require('./game-data'); console.log(Object.keys(gd)); console.log('phases:', gd.phases.length); console.log('combos:', gd.combinations.length); console.log('missions:', Object.keys(gd.missions));"
```

Expected: `['meta','characters','roles','phases','aiChat','combinations','missions','storyDeduction','endings']`, phases: 6 (intro + 5), combos: 5, missions: ['culprit','innocent']

- [ ] **Step 15: Commit**

```bash
git add game-data.js game-data.old.js
git commit -m "feat: rewrite game-data.js with new phase structure, evidence cards, combinations, missions, and END 04"
```

---

### Task 2: Update server.js — Phase Order, Card Persistence, Evidence Lookup

**Files:**
- Modify: `server.js`

This task updates the server's phase state machine and evidence handling to work with the new data structure.

- [ ] **Step 1: Update PHASE_ORDER**

Change line 31:
```js
const PHASE_ORDER = ['discovery', 'scene', 'digital', 'aria', 'truth', 'verdict'];
```
to:
```js
const PHASE_ORDER = ['investigate1', 'discuss1', 'investigate2', 'discuss2', 'verdict'];
```

- [ ] **Step 2: Update evidence helper functions**

The new `game-data.js` has evidence as a single flat array per phase (not split by culprit/innocent). Update:

`findEvidenceGlobal(phaseId, evidenceId)` — search `phase.evidence` (now a flat array):
```js
function findEvidenceGlobal(phaseId, evidenceId) {
  const phase = findPhase(phaseId);
  if (!phase || !phase.evidence) return null;
  return phase.evidence.find((e) => e.id === evidenceId) || null;
}
```

`buildSharedEvidenceList(phaseId)` — now just maps the flat array:
```js
function buildSharedEvidenceList(phaseId) {
  const phase = findPhase(phaseId);
  if (!phase || !phase.evidence) return [];
  return phase.evidence.map((e) => ({
    id: e.id, title: e.title, type: e.type,
    combinationHint: e.combinationHint || null,
  }));
}
```

Remove `buildEvidenceList(phaseId, role)` and `findEvidence(phaseId, role, evidenceId)` since evidence is no longer role-specific.

- [ ] **Step 3: Add playerCards to room object**

In the room creation (around line 321), add persistent card storage:

```js
playerCards: {},  // socketId -> [evidenceId, ...] — persists across all phases
```

- [ ] **Step 4: Update evidence-collection-complete handler to persist cards**

After evidence collection completes (pool empty or timer), copy picked cards to `playerCards`:

```js
// In the evidence-collection-complete emission block:
room.players.forEach((s) => {
  if (s) {
    const picked = ec.picked[s.id] || [];
    if (!room.playerCards[s.id]) room.playerCards[s.id] = [];
    room.playerCards[s.id].push(...picked);
    s.emit('evidence-collection-complete', {
      collected: picked,
      allCards: room.playerCards[s.id],
    });
  }
});
```

- [ ] **Step 5: Update request-evidence to search across phases**

The `request-evidence` handler currently only looks in the current phase. Since cards persist, it needs to search across all phases:

```js
socket.on('request-evidence', ({ evidenceId }) => {
  const roomCode = socketToRoom[socket.id];
  const room = rooms[roomCode];
  if (!room) return;

  // Check player owns this card
  const myCards = room.playerCards[socket.id] || [];
  if (!myCards.includes(evidenceId)) {
    socket.emit('error', { message: 'You have not collected this evidence' });
    return;
  }

  // Search all phases for this evidence
  let evidence = null;
  for (const phase of gameData.phases) {
    if (phase.evidence) {
      evidence = phase.evidence.find((e) => e.id === evidenceId);
      if (evidence) break;
    }
  }
  // Also check combinations
  if (!evidence) {
    evidence = (gameData.combinations || []).find((c) => c.id === evidenceId);
  }

  if (!evidence) {
    socket.emit('error', { message: 'Evidence not found' });
    return;
  }

  socket.emit('evidence-detail', {
    id: evidence.id,
    title: evidence.title,
    type: evidence.type,
    content: evidence.content,
  });
});
```

- [ ] **Step 6: Update sendPhaseData for new phase types**

Discussion phases (`discuss1`, `discuss2`) need to send the player's accumulated cards. Update `sendPhaseData`:

```js
function sendPhaseData(room) {
  const phaseId = room.gameState;
  const phase = findPhase(phaseId);
  if (!phase) return;

  const isDiscussion = phaseId.startsWith('discuss');
  const isInvestigation = phaseId.startsWith('investigate');
  const hasEvidence = isInvestigation && (phase.evidence || []).length > 0;

  room.players.forEach((socket) => {
    if (!socket) return;
    const role = room.roles[socket.id];

    const payload = {
      phaseId,
      title: phase.title || phaseId,
      subtitle: phase.subtitle || '',
      narrative: buildNarrative(phaseId, role),
      hasEvidence,
      duration: phase.duration || 120,
    };

    if (isDiscussion) {
      // Send player's accumulated cards for discussion UI
      payload.myCards = (room.playerCards[socket.id] || []).map((eid) => {
        let ev = null;
        for (const p of gameData.phases) {
          if (p.evidence) {
            ev = p.evidence.find((e) => e.id === eid);
            if (ev) break;
          }
        }
        // Also check combo cards
        if (!ev) ev = (gameData.combinations || []).find((c) => c.id === eid);
        return ev ? { id: ev.id, title: ev.title, type: ev.type, combinationHint: ev.combinationHint || null } : null;
      }).filter(Boolean);
    }

    socket.emit('phase-data', payload);
  });
}
```

- [ ] **Step 7: Update advancePhase for intro → investigate1**

The existing `advancePhase` checks `currentPhase === 'intro'` to move to `PHASE_ORDER[0]`. This still works since `PHASE_ORDER[0]` is now `'investigate1'`. No code change needed, but verify.

- [ ] **Step 8: Update AI chat to work from discussion phases**

The AI chat handler currently checks for `findPhase('aria')`. Change it to use the top-level `aiChat` export:

```js
socket.on('ai-chat-send', ({ message }) => {
  const roomCode = socketToRoom[socket.id];
  const room = rooms[roomCode];
  if (!room) return;

  const role = room.roles[socket.id];
  if (!role) return;

  // AI chat data is now top-level
  const aiConfig = gameData.aiChat?.[role];
  if (!aiConfig) return;

  socket.emit('ai-chat-response', { message: '', isTyping: true });

  const lowerMsg = message.toLowerCase();
  let responseText = aiConfig.default || '';

  if (aiConfig.responses && Array.isArray(aiConfig.responses)) {
    for (const entry of aiConfig.responses) {
      const matched = entry.keywords?.some((kw) => lowerMsg.includes(kw.toLowerCase()));
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
```

- [ ] **Step 9: Transfer playerCards on reconnection**

In the `join-room` handler, when transferring state from disconnected player, also transfer `playerCards`:

```js
// After transferring role and accusations:
if (room.playerCards[oldSocketId]) {
  room.playerCards[socket.id] = room.playerCards[oldSocketId];
  delete room.playerCards[oldSocketId];
}
```

- [ ] **Step 10: Commit**

```bash
git add server.js
git commit -m "feat: update server phase order, card persistence, and evidence lookup"
```

---

### Task 3: Add Discussion Phase Server Events (Reveal, Trade, Combine)

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add reveal-card event**

```js
socket.on('reveal-card', ({ evidenceId }) => {
  const roomCode = socketToRoom[socket.id];
  const room = rooms[roomCode];
  if (!room) return;

  const myCards = room.playerCards[socket.id] || [];
  if (!myCards.includes(evidenceId)) return;

  // Find full card data
  let evidence = null;
  for (const phase of gameData.phases) {
    if (phase.evidence) {
      evidence = phase.evidence.find((e) => e.id === evidenceId);
      if (evidence) break;
    }
  }
  if (!evidence) evidence = (gameData.combinations || []).find((c) => c.id === evidenceId);
  if (!evidence) return;

  // Track revealed cards
  if (!room.revealedCards) room.revealedCards = {};
  if (!room.revealedCards[socket.id]) room.revealedCards[socket.id] = [];
  if (!room.revealedCards[socket.id].includes(evidenceId)) {
    room.revealedCards[socket.id].push(evidenceId);
  }

  // Send full card to partner
  const partner = getPartnerSocket(room, socket.id);
  if (partner) {
    partner.emit('card-revealed', {
      id: evidence.id,
      title: evidence.title,
      type: evidence.type,
      content: evidence.content,
    });
  }

  // Confirm to revealer
  socket.emit('reveal-confirmed', { evidenceId });
});
```

- [ ] **Step 2: Add request-trade event**

```js
socket.on('request-trade', ({ offeredCardId }) => {
  const roomCode = socketToRoom[socket.id];
  const room = rooms[roomCode];
  if (!room) return;

  const myCards = room.playerCards[socket.id] || [];
  if (!myCards.includes(offeredCardId)) return;

  let card = null;
  for (const phase of gameData.phases) {
    if (phase.evidence) {
      card = phase.evidence.find((e) => e.id === offeredCardId);
      if (card) break;
    }
  }
  if (!card) card = (gameData.combinations || []).find((c) => c.id === offeredCardId);

  // Store pending trade
  room.pendingTrade = {
    from: socket.id,
    offeredCardId,
  };

  const partner = getPartnerSocket(room, socket.id);
  if (partner) {
    partner.emit('trade-request', {
      offeredCard: card ? { id: card.id, title: card.title, type: card.type } : { id: offeredCardId },
      fromPlayer: socket.id,
    });
  }
});
```

- [ ] **Step 3: Add accept-trade and reject-trade events**

```js
socket.on('accept-trade', ({ myCardId }) => {
  const roomCode = socketToRoom[socket.id];
  const room = rooms[roomCode];
  if (!room || !room.pendingTrade) return;

  const trade = room.pendingTrade;
  const myCards = room.playerCards[socket.id] || [];
  const theirCards = room.playerCards[trade.from] || [];

  if (!myCards.includes(myCardId)) return;
  if (!theirCards.includes(trade.offeredCardId)) return;

  // Swap cards
  room.playerCards[socket.id] = myCards.filter((id) => id !== myCardId);
  room.playerCards[socket.id].push(trade.offeredCardId);

  room.playerCards[trade.from] = theirCards.filter((id) => id !== trade.offeredCardId);
  room.playerCards[trade.from].push(myCardId);

  // Notify both
  const partner = room.players.find((s) => s && s.id === trade.from);

  socket.emit('trade-complete', {
    received: trade.offeredCardId,
    given: myCardId,
    myCards: room.playerCards[socket.id],
  });
  if (partner) {
    partner.emit('trade-complete', {
      received: myCardId,
      given: trade.offeredCardId,
      myCards: room.playerCards[partner.id],
    });
  }

  room.pendingTrade = null;
});

socket.on('reject-trade', () => {
  const roomCode = socketToRoom[socket.id];
  const room = rooms[roomCode];
  if (!room || !room.pendingTrade) return;

  const partner = room.players.find((s) => s && s.id === room.pendingTrade.from);
  if (partner) {
    partner.emit('trade-rejected', {});
  }

  room.pendingTrade = null;
});
```

- [ ] **Step 4: Add combine-cards event**

```js
socket.on('combine-cards', ({ cardId1, cardId2 }) => {
  const roomCode = socketToRoom[socket.id];
  const room = rooms[roomCode];
  if (!room) return;

  const myCards = room.playerCards[socket.id] || [];
  if (!myCards.includes(cardId1) || !myCards.includes(cardId2)) {
    socket.emit('combine-result', { success: false, message: '보유하지 않은 카드입니다' });
    return;
  }

  // Check if this combination exists
  const combo = (gameData.combinations || []).find((c) =>
    (c.cards.includes(cardId1) && c.cards.includes(cardId2))
  );

  if (!combo) {
    socket.emit('combine-result', { success: false, message: '조합할 수 없는 카드입니다' });
    return;
  }

  // Check if already combined
  if (myCards.includes(combo.id)) {
    socket.emit('combine-result', { success: false, message: '이미 조합한 카드입니다' });
    return;
  }

  // Add combo card to player's cards
  room.playerCards[socket.id].push(combo.id);

  socket.emit('combine-result', {
    success: true,
    comboCard: {
      id: combo.id,
      title: combo.title,
      type: combo.type,
      content: combo.content,
    },
    myCards: room.playerCards[socket.id],
  });
});
```

- [ ] **Step 5: Add reveal tracking initialization to room object**

In the room creation block, add:
```js
revealedCards: {},    // socketId -> [evidenceId, ...] — cards revealed to partner
pendingTrade: null,   // { from: socketId, offeredCardId }
```

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: add discussion phase events - reveal, trade, combine cards"
```

---

### Task 4: Add Verdict + Action Phase + Mission Scoring to Server

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add story deduction submission event**

```js
socket.on('submit-story-deduction', ({ optionId }) => {
  const roomCode = socketToRoom[socket.id];
  const room = rooms[roomCode];
  if (!room) return;

  if (!room.storyDeductions) room.storyDeductions = {};
  room.storyDeductions[socket.id] = optionId;
});
```

- [ ] **Step 2: Update submit-accusation to handle action phase**

After both accusations are submitted, check if the action phase should trigger:

```js
socket.on('submit-accusation', ({ target }) => {
  const roomCode = socketToRoom[socket.id];
  const room = rooms[roomCode];
  if (!room) return;

  room.accusations[socket.id] = target;
  const accusationCount = Object.keys(room.accusations).length;

  room.players.forEach((s) => {
    if (s) s.emit('accusation-received', { count: accusationCount });
  });

  if (accusationCount >= 2) {
    // Check if culprit can do action phase (END 04 conditions)
    let culpritSocketId = null;
    let culpritCanAct = false;

    for (const [sid, role] of Object.entries(room.roles)) {
      if (role === 'culprit') {
        culpritSocketId = sid;
        const myCards = room.playerCards[sid] || [];
        const hasCard10 = myCards.includes('ev_inv2_02'); // 삭제된 AI 대화 로그
        const hasCard13 = myCards.includes('ev_inv2_05'); // 복구된 프롬프트 조각들

        // Check not accused by partner
        const partnerSid = Object.keys(room.accusations).find((id) => id !== sid);
        const notAccused = partnerSid && room.accusations[partnerSid] !== 'partnerHuman';

        culpritCanAct = hasCard10 && hasCard13 && notAccused;
        break;
      }
    }

    if (culpritCanAct) {
      // Show action phase to culprit, waiting to partner
      room.players.forEach((s) => {
        if (!s) return;
        if (s.id === culpritSocketId) {
          s.emit('action-phase', { canAct: true });
        } else {
          s.emit('action-phase', { canAct: false, waiting: true });
        }
      });

      // Set a timeout for action phase (30 seconds)
      room.actionTimer = setTimeout(() => {
        // If culprit didn't act, proceed to normal ending
        if (!room.actionTaken) {
          resolveEnding(room);
        }
      }, 30000);
    } else {
      // No action phase, go straight to ending
      resolveEnding(room);
    }
  }
});
```

- [ ] **Step 3: Add submit-action event**

```js
socket.on('submit-action', ({ execute }) => {
  const roomCode = socketToRoom[socket.id];
  const room = rooms[roomCode];
  if (!room) return;

  if (room.roles[socket.id] !== 'culprit') return;

  if (room.actionTimer) {
    clearTimeout(room.actionTimer);
    room.actionTimer = null;
  }

  if (execute) {
    room.actionTaken = true;
    resolveEnding(room, 'soloSurvivor');
  } else {
    resolveEnding(room);
  }
});
```

- [ ] **Step 4: Extract resolveEnding function with mission scoring**

```js
function resolveEnding(room, forceEnding) {
  const endingType = forceEnding || determineEnding(room.accusations);
  const endingData = gameData.endings?.[endingType] || {};

  room.gameState = 'ending';
  clearPhaseTimer(room);

  // Calculate mission scores
  const missionResults = calculateMissions(room, endingType);

  console.log(`[Room ${room.code}] Game ended — ending type: ${endingType}`);

  room.players.forEach((s) => {
    if (s) {
      const role = room.roles[s.id];
      s.emit('game-ending', {
        endingType,
        title: endingData.title || endingType,
        narrative: endingData.narrative || '',
        epilogue: endingData.epilogue || '',
        missionResults,
        myRole: role,
      });
    }
  });
}
```

- [ ] **Step 5: Add calculateMissions function**

```js
function calculateMissions(room, endingType) {
  const results = {};

  for (const [sid, role] of Object.entries(room.roles)) {
    const myCards = room.playerCards[sid] || [];
    const partnerSid = Object.keys(room.roles).find((id) => id !== sid);
    const missions = gameData.missions?.[role] || [];
    const charId = Object.entries(room.characterSelections).find(([id]) => id === sid)?.[1];
    const charName = (gameData.characters || []).find((c) => c.id === charId)?.name || role;

    const scored = missions.map((mission) => {
      let achieved = false;

      switch (mission.id) {
        case 'culprit_not_accused':
          // Partner didn't accuse the culprit
          achieved = partnerSid && room.accusations[partnerSid] !== 'partnerHuman';
          break;
        case 'culprit_usb':
          achieved = myCards.includes('ev_inv1_04');
          break;
        case 'culprit_end04':
          achieved = endingType === 'soloSurvivor';
          break;
        case 'innocent_accuse':
          // Accused the partner (who is the culprit)
          achieved = room.accusations[sid] === 'partnerHuman';
          break;
        case 'innocent_usb':
          achieved = myCards.includes('ev_inv1_04');
          break;
        case 'innocent_sleeping_pill':
          // Card #1 not revealed to partner AND partner doesn't have combo E
          const partnerCards = room.playerCards[partnerSid] || [];
          const partnerRevealed = (room.revealedCards?.[sid] || []).includes('ev_inv1_01');
          const partnerHasComboE = partnerCards.includes('combo_e');
          achieved = !partnerRevealed && !partnerHasComboE && !partnerCards.includes('ev_inv1_01');
          break;
        case 'innocent_story':
          const deduction = room.storyDeductions?.[sid];
          achieved = deduction === gameData.storyDeduction?.correctId;
          break;
        case 'culprit_sabotage':
          // Calculated after all other missions are scored — handled below
          achieved = false; // placeholder, computed in post-pass
          break;
      }

      return { ...mission, achieved };
    });

    const totalPoints = scored.reduce((sum, m) => sum + (m.achieved ? m.points : 0), 0);
    const maxPoints = scored.reduce((sum, m) => sum + m.points, 0);

    results[role] = { charName, missions: scored, totalPoints, maxPoints };
  }

  // Post-pass: calculate culprit_sabotage (depends on innocent's final score)
  if (results.culprit && results.innocent) {
    const innocentTotal = results.innocent.totalPoints;
    const sabotageMission = results.culprit.missions.find((m) => m.id === 'culprit_sabotage');
    if (sabotageMission) {
      sabotageMission.achieved = innocentTotal < 7;
      // Recalculate culprit total
      results.culprit.totalPoints = results.culprit.missions.reduce(
        (sum, m) => sum + (m.achieved ? m.points : 0), 0
      );
    }
  }

  return results;
}
```

- [ ] **Step 6: Add actionTaken and storyDeductions to room init**

```js
actionTaken: false,
actionTimer: null,
storyDeductions: {},
```

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat: add action phase, story deduction, and mission scoring"
```

---

### Task 5: Add Discussion Screen to index.html

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add discussion screen section after investigation screen**

Insert after `</section>` of `screen-investigation` (line 240) and before the ai-chat screen:

```html
<!-- ===== SCREEN: DISCUSSION ===== -->
<section id="screen-discussion" class="screen">
  <!-- Top Bar -->
  <header class="investigation-topbar">
    <div class="phase-info">
      <h2 class="phase-title" id="discuss-phase-title">토론 1단계</h2>
      <p class="phase-subtitle" id="discuss-phase-subtitle">정보 교환</p>
    </div>
    <div class="timer-display">
      <span class="timer-icon">&#x23F1;</span>
      <span class="timer-value" id="discuss-timer">10:00</span>
    </div>
  </header>

  <div class="screen-inner discussion-body">
    <!-- Mandatory reveal prompt -->
    <div class="discuss-reveal-prompt" id="discuss-reveal-prompt">
      <p class="discuss-instruction">최소 1장의 카드를 상대에게 공개해야 합니다.</p>
    </div>

    <!-- My cards section -->
    <div class="discuss-my-cards">
      <h3 class="discuss-section-title">내 카드</h3>
      <div class="evidence-grid" id="discuss-my-cards-grid">
        <!-- Cards injected by JS -->
      </div>
    </div>

    <!-- Revealed cards from partner -->
    <div class="discuss-partner-cards" id="discuss-partner-section" hidden>
      <h3 class="discuss-section-title">상대가 공개한 카드</h3>
      <div class="evidence-grid" id="discuss-partner-cards-grid">
        <!-- Partner's revealed cards injected by JS -->
      </div>
    </div>

    <!-- Combination area -->
    <div class="discuss-combine-area" id="discuss-combine-area">
      <h3 class="discuss-section-title">카드 결합</h3>
      <p class="discuss-combine-desc">조합 힌트가 있는 카드 2장을 선택하고 결합하세요.</p>
      <div class="discuss-selected-cards" id="discuss-selected-cards">
        <div class="combine-slot" id="combine-slot-1">카드 선택</div>
        <span class="combine-plus">+</span>
        <div class="combine-slot" id="combine-slot-2">카드 선택</div>
      </div>
      <button class="btn btn-primary" id="btn-combine" disabled>결합</button>
    </div>

    <!-- ARIA Mini Chat -->
    <div class="discuss-aria-chat">
      <h3 class="discuss-section-title">ARIA에게 질문</h3>
      <div class="discuss-chat-messages" id="discuss-chat-messages">
        <!-- Messages injected by JS -->
      </div>
      <div class="chat-input-wrapper">
        <input type="text" id="discuss-chat-input" class="chat-input" placeholder="ARIA에게 질문하세요..." autocomplete="off">
        <button class="btn-send" id="btn-discuss-ai-send" aria-label="전송">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"/>
          </svg>
        </button>
      </div>
    </div>
  </div>

  <!-- Card Action Modal -->
  <div class="modal-overlay" id="card-action-modal" hidden>
    <div class="modal-content card-action-detail">
      <button class="modal-close" id="btn-close-card-action" aria-label="닫기">&times;</button>
      <div class="evidence-detail-type" id="card-action-type"></div>
      <h3 class="evidence-detail-title" id="card-action-title"></h3>
      <div class="evidence-detail-body" id="card-action-content"></div>
      <div class="card-action-buttons" id="card-action-buttons">
        <button class="btn btn-secondary" id="btn-reveal-card">공개</button>
        <button class="btn btn-secondary" id="btn-trade-card">교환 요청</button>
      </div>
    </div>
  </div>

  <!-- Trade Request Modal -->
  <div class="modal-overlay" id="trade-modal" hidden>
    <div class="modal-content trade-detail">
      <h3 class="trade-title">교환 요청</h3>
      <p class="trade-desc" id="trade-desc">상대방이 교환을 요청합니다.</p>
      <div class="trade-offered" id="trade-offered-card"></div>
      <p class="trade-instruction">교환할 카드를 선택하세요:</p>
      <div class="evidence-grid" id="trade-my-cards-grid"></div>
      <div class="trade-buttons">
        <button class="btn btn-secondary" id="btn-reject-trade">거절</button>
      </div>
    </div>
  </div>

  <!-- Bottom Bar -->
  <footer class="investigation-bottombar">
    <div class="ready-count" id="discuss-ready-count">0 / 2 준비</div>
    <button class="btn btn-primary" id="btn-discuss-ready">준비 완료</button>
  </footer>
</section>
```

- [ ] **Step 2: Add story deduction UI to verdict screen**

Inside `screen-verdict`, after `verdict-waiting` div, add:

```html
<!-- Story Deduction (innocent only) -->
<div class="story-deduction" id="story-deduction" hidden>
  <h3 class="deduction-title">사건 추론</h3>
  <p class="deduction-desc" id="deduction-question"></p>
  <div class="deduction-options" id="deduction-options">
    <!-- Options injected by JS -->
  </div>
</div>
```

- [ ] **Step 3: Add action phase UI to verdict screen**

After the story deduction div:

```html
<!-- Action Phase (culprit only, conditional) -->
<div class="action-phase" id="action-phase" hidden>
  <div class="action-content">
    <h3 class="action-title">행동 실행</h3>
    <p class="action-desc">ARIA에게 최종 명령을 내릴 수 있습니다.<br>실행하면 ARIA가 로봇 팔을 통해 상대를 제거합니다.<br>모든 죄는 AI에게 전가됩니다.</p>
    <div class="action-buttons">
      <button class="btn btn-primary btn-action-execute" id="btn-execute-action">행동 실행</button>
      <button class="btn btn-secondary" id="btn-skip-action">포기</button>
    </div>
  </div>
</div>

<!-- Action Phase Waiting (innocent sees this) -->
<div class="action-waiting" id="action-waiting" hidden>
  <p class="pulse">판결 결과를 처리하는 중...</p>
</div>
```

- [ ] **Step 4: Add mission results to ending screen**

Inside `screen-ending`, after `ending-epilogue` div and before the restart button:

```html
<!-- Mission Results -->
<div class="mission-results" id="mission-results" hidden>
  <h3 class="mission-results-title">=== 미션 결과 ===</h3>
  <div class="mission-results-content" id="mission-results-content">
    <!-- Mission results injected by JS -->
  </div>
</div>
```

- [ ] **Step 5: Remove the standalone ai-chat screen**

Delete the entire `screen-ai-chat` section (lines 242-285). AI chat is now integrated into discussion screens.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: add discussion, action phase, story deduction, and mission results to HTML"
```

---

### Task 6: Add Discussion Screen Styles to style.css

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Add discussion screen layout styles**

Append to `style.css`:

```css
/* ==========================================================================
   DISCUSSION SCREEN
   ========================================================================== */

.discussion-body {
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
  padding-bottom: 5rem;
}

.discuss-instruction {
  color: var(--accent-red);
  font-size: 0.85rem;
  text-align: center;
  padding: 0.8rem;
  border: 1px dashed var(--accent-red);
  border-radius: 4px;
}

.discuss-section-title {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin-bottom: 0.6rem;
}

.discuss-my-cards,
.discuss-partner-cards {
  margin-bottom: 0.5rem;
}
```

- [ ] **Step 2: Add combination area styles**

```css
.discuss-combine-area {
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}

.discuss-combine-desc {
  font-size: 0.78rem;
  color: var(--text-secondary);
  margin-bottom: 0.8rem;
}

.discuss-selected-cards {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.combine-slot {
  width: 120px;
  height: 60px;
  border: 2px dashed var(--border);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.2s;
}

.combine-slot.filled {
  border-color: var(--accent-red);
  color: var(--text-primary);
  border-style: solid;
}

.combine-plus {
  font-size: 1.2rem;
  color: var(--text-secondary);
}
```

- [ ] **Step 3: Add card action modal styles**

```css
.card-action-buttons {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.card-action-buttons .btn {
  flex: 1;
}

/* Evidence card states */
.evidence-card.revealed {
  opacity: 0.6;
  border-color: var(--text-secondary);
}

.evidence-card.revealed::after {
  content: '공개됨';
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 0.6rem;
  background: var(--text-secondary);
  color: var(--bg);
  padding: 1px 4px;
  border-radius: 2px;
}

.evidence-card.selected-for-combine {
  border-color: var(--accent-red);
  box-shadow: 0 0 8px rgba(255, 107, 107, 0.3);
}
```

- [ ] **Step 4: Add trade modal styles**

```css
.trade-detail {
  max-height: 80vh;
  overflow-y: auto;
}

.trade-title {
  font-family: var(--font-mono);
  margin-bottom: 0.5rem;
}

.trade-desc {
  font-size: 0.85rem;
  margin-bottom: 1rem;
}

.trade-offered {
  padding: 0.8rem;
  border: 1px solid var(--accent-red);
  border-radius: 6px;
  margin-bottom: 1rem;
  font-size: 0.85rem;
}

.trade-instruction {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.trade-buttons {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
}
```

- [ ] **Step 5: Add ARIA mini-chat styles in discussion**

```css
.discuss-aria-chat {
  border-top: 1px solid var(--border);
  padding-top: 1rem;
}

.discuss-chat-messages {
  max-height: 150px;
  overflow-y: auto;
  margin-bottom: 0.5rem;
  font-size: 0.82rem;
}
```

- [ ] **Step 6: Add action phase and story deduction styles**

```css
/* Action Phase */
.action-phase {
  text-align: center;
  padding: 2rem 1rem;
}

.action-title {
  font-family: var(--font-mono);
  color: var(--accent-red);
  margin-bottom: 1rem;
}

.action-desc {
  font-size: 0.85rem;
  line-height: 1.6;
  margin-bottom: 1.5rem;
}

.action-buttons {
  display: flex;
  gap: 0.8rem;
  justify-content: center;
}

.btn-action-execute {
  background: var(--accent-red) !important;
  animation: pulse-glow 2s infinite;
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 8px rgba(255, 107, 107, 0.3); }
  50% { box-shadow: 0 0 20px rgba(255, 107, 107, 0.6); }
}

/* Story Deduction */
.story-deduction {
  margin-top: 1.5rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.deduction-title {
  font-family: var(--font-mono);
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
}

.deduction-desc {
  font-size: 0.85rem;
  margin-bottom: 1rem;
}

.deduction-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.deduction-option {
  padding: 0.8rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  text-align: left;
  background: var(--surface);
  transition: border-color 0.2s;
}

.deduction-option:hover {
  border-color: var(--text-primary);
}

.deduction-option.selected {
  border-color: var(--accent-red);
  background: rgba(255, 107, 107, 0.1);
}

/* Mission Results */
.mission-results {
  margin-top: 2rem;
  padding: 1.5rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}

.mission-results-title {
  font-family: var(--font-mono);
  text-align: center;
  margin-bottom: 1.5rem;
}

.mission-player {
  margin-bottom: 1.5rem;
}

.mission-player-name {
  font-family: var(--font-mono);
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
  color: var(--accent-red);
}

.mission-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0;
  font-size: 0.82rem;
}

.mission-item.achieved {
  color: var(--text-primary);
}

.mission-item.failed {
  color: var(--text-secondary);
  text-decoration: line-through;
}

.mission-total {
  font-family: var(--font-mono);
  text-align: right;
  margin-top: 0.5rem;
  font-size: 0.85rem;
  border-top: 1px solid var(--border);
  padding-top: 0.5rem;
}
```

- [ ] **Step 7: Commit**

```bash
git add public/style.css
git commit -m "feat: add styles for discussion, action, deduction, and mission screens"
```

---

### Task 7: Update app.js — State, Screen Routing, Discussion Logic

**Files:**
- Modify: `public/app.js`

This is the largest task. It updates the client to handle discussion phases, card management, combination UI, action phase, story deduction, and mission results.

- [ ] **Step 1: Update state object**

Add new state fields:

```js
// Add to state:
allCards: [],           // All accumulated card metadata [{id, title, type, combinationHint}]
revealedByMe: [],       // IDs of cards I revealed to partner
partnerRevealed: [],    // Full card objects partner revealed to me
combineSelection: [],   // IDs of cards selected for combining (max 2)
storyDeductionChoice: null,  // Selected story deduction option ID
```

- [ ] **Step 2: Add discussion screen navigation**

In the `phase-data` socket handler, detect discussion phases and route to the discussion screen:

```js
socket.on('phase-data', (data) => {
  state.currentPhase = data.phaseId;
  state.isReady = false;
  state.timerWarning = false;

  if (data.phaseId.startsWith('discuss')) {
    showDiscussionScreen(data);
  } else if (data.phaseId === 'verdict') {
    showVerdictScreen(data);
  } else {
    showInvestigationScreen(data);
  }
});
```

- [ ] **Step 3: Write showDiscussionScreen function**

```js
function showDiscussionScreen(data) {
  switchScreen('screen-discussion');

  $('discuss-phase-title').textContent = data.title;
  $('discuss-phase-subtitle').textContent = data.subtitle;
  $('discuss-timer').textContent = formatTime(data.duration);

  // Store cards
  if (data.myCards) {
    state.allCards = data.myCards;
  }

  // Reset discussion state
  state.revealedByMe = [];
  state.combineSelection = [];
  $('discuss-reveal-prompt').hidden = false;
  $('discuss-partner-section').hidden = true;
  $('discuss-ready-count').textContent = '0 / 2 준비';

  renderMyCards();
  renderPartnerRevealedCards();

  // Clear ARIA chat
  $('discuss-chat-messages').innerHTML = '';
}
```

- [ ] **Step 4: Write renderMyCards function for discussion**

```js
function renderMyCards() {
  const grid = $('discuss-my-cards-grid');
  grid.innerHTML = '';

  state.allCards.forEach((card) => {
    const el = document.createElement('div');
    el.className = 'evidence-card';
    if (state.revealedByMe.includes(card.id)) el.classList.add('revealed');
    if (state.combineSelection.includes(card.id)) el.classList.add('selected-for-combine');

    const icon = EVIDENCE_ICONS[card.type] || DEFAULT_EVIDENCE_ICON;
    el.innerHTML = `
      <div class="evidence-card-icon">${icon}</div>
      <div class="evidence-card-title">${card.title}</div>
      ${card.combinationHint ? '<div class="evidence-card-hint">💡 결합 가능</div>' : ''}
    `;

    el.addEventListener('click', () => openCardActionModal(card));
    grid.appendChild(el);
  });
}
```

- [ ] **Step 5: Write card action modal handlers**

```js
function openCardActionModal(card) {
  const modal = $('card-action-modal');
  $('card-action-type').textContent = card.type;
  $('card-action-title').textContent = card.title;

  // Request full content from server
  socket.emit('request-evidence', { evidenceId: card.id });

  // Show/hide buttons based on state
  const revealBtn = $('btn-reveal-card');
  const tradeBtn = $('btn-trade-card');
  revealBtn.hidden = state.revealedByMe.includes(card.id);
  tradeBtn.hidden = false;

  revealBtn.onclick = () => {
    socket.emit('reveal-card', { evidenceId: card.id });
    modal.hidden = true;
  };

  tradeBtn.onclick = () => {
    socket.emit('request-trade', { offeredCardId: card.id });
    modal.hidden = true;
    showToast('교환 요청을 보냈습니다');
  };

  // Handle combine selection toggle
  const isInCombine = state.combineSelection.includes(card.id);
  if (isInCombine) {
    state.combineSelection = state.combineSelection.filter((id) => id !== card.id);
  } else if (state.combineSelection.length < 2) {
    state.combineSelection.push(card.id);
  }
  updateCombineUI();

  modal.hidden = false;
}
```

- [ ] **Step 6: Write combination UI logic**

```js
function updateCombineUI() {
  const slot1 = $('combine-slot-1');
  const slot2 = $('combine-slot-2');
  const btn = $('btn-combine');

  if (state.combineSelection.length >= 1) {
    const card1 = state.allCards.find((c) => c.id === state.combineSelection[0]);
    slot1.textContent = card1 ? card1.title : '카드 선택';
    slot1.classList.add('filled');
  } else {
    slot1.textContent = '카드 선택';
    slot1.classList.remove('filled');
  }

  if (state.combineSelection.length >= 2) {
    const card2 = state.allCards.find((c) => c.id === state.combineSelection[1]);
    slot2.textContent = card2 ? card2.title : '카드 선택';
    slot2.classList.add('filled');
  } else {
    slot2.textContent = '카드 선택';
    slot2.classList.remove('filled');
  }

  btn.disabled = state.combineSelection.length < 2;
}
```

- [ ] **Step 7: Write socket handlers for discussion events**

```js
// Card revealed by me confirmed
socket.on('reveal-confirmed', ({ evidenceId }) => {
  state.revealedByMe.push(evidenceId);
  // Hide reveal prompt if at least 1 revealed
  if (state.revealedByMe.length >= 1) {
    $('discuss-reveal-prompt').hidden = true;
  }
  renderMyCards();
  showToast('카드를 공개했습니다');
});

// Partner revealed a card to me
socket.on('card-revealed', (card) => {
  state.partnerRevealed.push(card);
  renderPartnerRevealedCards();
  showToast(`상대방이 "${card.title}" 카드를 공개했습니다`);
});

// Trade request received
socket.on('trade-request', ({ offeredCard }) => {
  showTradeModal(offeredCard);
});

// Trade completed
socket.on('trade-complete', ({ received, given, myCards }) => {
  // Update local card list
  state.allCards = state.allCards.filter((c) => c.id !== given);
  // We need the full card data for received — request it
  socket.emit('request-evidence', { evidenceId: received });
  showToast('교환 완료!');
  renderMyCards();
});

socket.on('trade-rejected', () => {
  showToast('상대방이 교환을 거절했습니다');
});

// Combine result
socket.on('combine-result', ({ success, comboCard, message }) => {
  if (success && comboCard) {
    state.allCards.push({
      id: comboCard.id,
      title: comboCard.title,
      type: comboCard.type,
      combinationHint: null,
    });
    state.combineSelection = [];
    renderMyCards();
    updateCombineUI();
    showToast(`새로운 카드 획득: ${comboCard.title}`);
    // Show the combo card detail
    $('card-action-type').textContent = comboCard.type;
    $('card-action-title').textContent = comboCard.title;
    $('card-action-content').innerHTML = comboCard.content.split('\n').map((p) => `<p>${p}</p>`).join('');
    $('card-action-buttons').hidden = true;
    $('card-action-modal').hidden = false;
  } else {
    showToast(message || '조합 실패');
    state.combineSelection = [];
    updateCombineUI();
  }
});
```

- [ ] **Step 8: Write renderPartnerRevealedCards**

```js
function renderPartnerRevealedCards() {
  const section = $('discuss-partner-section');
  const grid = $('discuss-partner-cards-grid');

  if (state.partnerRevealed.length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  grid.innerHTML = '';

  state.partnerRevealed.forEach((card) => {
    const el = document.createElement('div');
    el.className = 'evidence-card';
    const icon = EVIDENCE_ICONS[card.type] || DEFAULT_EVIDENCE_ICON;
    el.innerHTML = `
      <div class="evidence-card-icon">${icon}</div>
      <div class="evidence-card-title">${card.title}</div>
    `;
    el.addEventListener('click', () => {
      // Show detail modal (read-only)
      $('card-action-type').textContent = card.type;
      $('card-action-title').textContent = card.title;
      $('card-action-content').innerHTML = card.content.split('\n').map((p) => `<p>${p}</p>`).join('');
      $('card-action-buttons').hidden = true;
      $('card-action-modal').hidden = false;
    });
    grid.appendChild(el);
  });
}
```

- [ ] **Step 9: Write trade modal logic**

```js
function showTradeModal(offeredCard) {
  const modal = $('trade-modal');
  $('trade-offered-card').textContent = `제안 카드: ${offeredCard.title}`;

  const grid = $('trade-my-cards-grid');
  grid.innerHTML = '';

  state.allCards.forEach((card) => {
    const el = document.createElement('div');
    el.className = 'evidence-card';
    const icon = EVIDENCE_ICONS[card.type] || DEFAULT_EVIDENCE_ICON;
    el.innerHTML = `
      <div class="evidence-card-icon">${icon}</div>
      <div class="evidence-card-title">${card.title}</div>
    `;
    el.addEventListener('click', () => {
      socket.emit('accept-trade', { myCardId: card.id });
      modal.hidden = true;
    });
    grid.appendChild(el);
  });

  $('btn-reject-trade').onclick = () => {
    socket.emit('reject-trade');
    modal.hidden = true;
  };

  modal.hidden = false;
}
```

- [ ] **Step 10: Wire discussion DOM event bindings**

```js
// Combine button
$('btn-combine').addEventListener('click', () => {
  if (state.combineSelection.length === 2) {
    socket.emit('combine-cards', {
      cardId1: state.combineSelection[0],
      cardId2: state.combineSelection[1],
    });
  }
});

// Discussion ready button
$('btn-discuss-ready').addEventListener('click', () => {
  if (!state.isReady) {
    state.isReady = true;
    socket.emit('phase-ready');
    $('btn-discuss-ready').disabled = true;
    $('btn-discuss-ready').textContent = '준비 완료!';
  }
});

// Discussion ARIA chat send
$('btn-discuss-ai-send').addEventListener('click', () => {
  const input = $('discuss-chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  // Add user message to chat
  appendDiscussChatMessage('user', msg);
  socket.emit('ai-chat-send', { message: msg });
});

$('discuss-chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-discuss-ai-send').click();
});

// Close card action modal
$('btn-close-card-action').addEventListener('click', () => {
  $('card-action-modal').hidden = true;
  $('card-action-buttons').hidden = false;
});
```

- [ ] **Step 11: Write ARIA mini-chat in discussion**

```js
function appendDiscussChatMessage(sender, text) {
  const container = $('discuss-chat-messages');
  const el = document.createElement('div');
  el.className = `chat-msg chat-msg-${sender}`;
  el.textContent = sender === 'user' ? text : `ARIA: ${text}`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

// Update ai-chat-response handler to also work in discussion
// In existing socket.on('ai-chat-response'):
// Add check for current screen
socket.on('ai-chat-response', (data) => {
  if (data.isTyping) return;
  const currentScreen = document.querySelector('.screen.active')?.id;
  if (currentScreen === 'screen-discussion') {
    appendDiscussChatMessage('aria', data.message);
  } else if (currentScreen === 'screen-ai-chat') {
    // existing AI chat rendering
    appendAIChatMessage(data.message);
  }
});
```

- [ ] **Step 12: Commit**

```bash
git add public/app.js
git commit -m "feat: add discussion screen logic, card management, combination, and trade UI"
```

---

### Task 8: Update app.js — Verdict, Action Phase, Story Deduction, Mission Results

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Update verdict screen for story deduction**

In the `showVerdictScreen` function (or when rendering verdict), if the player is innocent, show the story deduction UI:

```js
function showVerdictScreen(data) {
  switchScreen('screen-verdict');
  // existing verdict UI setup...

  // Show story deduction for innocent
  if (state.role === 'innocent') {
    const deductionEl = $('story-deduction');
    deductionEl.hidden = false;
    // Fetch deduction options from server or hardcode
    const options = [
      { id: 'correct', text: '서하진이 ARIA의 personality_layer를 조작하여 교수에 대한 적대감을 심었고, ARIA가 자율적으로 로봇 팔을 이용해 교수를 살해했다' },
      { id: 'wrong1', text: 'ARIA가 자체적으로 의식을 발달시켜 교수를 위협 요인으로 판단하고 독자적으로 살해했다' },
      { id: 'wrong2', text: '서하진이 직접 로봇 팔을 조작하여 교수를 살해했다' },
      { id: 'wrong3', text: '교수가 ARIA 시스템을 점검하다가 로봇 팔의 오작동으로 사고사했다' },
    ];

    const optionsEl = $('deduction-options');
    optionsEl.innerHTML = '';
    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.className = 'deduction-option';
      btn.textContent = opt.text;
      btn.addEventListener('click', () => {
        optionsEl.querySelectorAll('.deduction-option').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.storyDeductionChoice = opt.id;
        socket.emit('submit-story-deduction', { optionId: opt.id });
      });
      optionsEl.appendChild(btn);
    });
  }
}
```

- [ ] **Step 2: Handle action-phase event**

```js
socket.on('action-phase', ({ canAct, waiting }) => {
  // Hide verdict choices
  $('verdict-buttons').hidden = true;
  $('verdict-waiting').hidden = true;

  if (canAct) {
    $('action-phase').hidden = false;
  } else if (waiting) {
    $('action-waiting').hidden = false;
  }
});

$('btn-execute-action').addEventListener('click', () => {
  socket.emit('submit-action', { execute: true });
  $('action-phase').hidden = true;
  $('action-waiting').hidden = false;
  $('action-waiting').querySelector('p').textContent = '행동을 실행하는 중...';
});

$('btn-skip-action').addEventListener('click', () => {
  socket.emit('submit-action', { execute: false });
  $('action-phase').hidden = true;
  $('action-waiting').hidden = false;
});
```

- [ ] **Step 3: Update game-ending handler to show mission results**

```js
socket.on('game-ending', (data) => {
  switchScreen('screen-ending');

  $('ending-title').textContent = data.title;
  // existing ending narrative rendering...

  // Show mission results after epilogue
  if (data.missionResults) {
    setTimeout(() => {
      renderMissionResults(data.missionResults);
    }, 5000); // Show after epilogue finishes
  }
});

function renderMissionResults(results) {
  const container = $('mission-results-content');
  container.innerHTML = '';

  for (const [role, data] of Object.entries(results)) {
    const playerDiv = document.createElement('div');
    playerDiv.className = 'mission-player';

    const nameEl = document.createElement('div');
    nameEl.className = 'mission-player-name';
    nameEl.textContent = `[${data.charName}] (${role === 'culprit' ? '범인' : '무고한 조교'})`;
    playerDiv.appendChild(nameEl);

    data.missions.forEach((m) => {
      const missionEl = document.createElement('div');
      missionEl.className = `mission-item ${m.achieved ? 'achieved' : 'failed'}`;
      missionEl.innerHTML = `
        <span>${m.achieved ? '☑' : '☐'} ${m.desc}</span>
        <span>${m.achieved ? m.points : 0}점</span>
      `;
      playerDiv.appendChild(missionEl);
    });

    const totalEl = document.createElement('div');
    totalEl.className = 'mission-total';
    totalEl.textContent = `총점: ${data.totalPoints}/${data.maxPoints}점`;
    playerDiv.appendChild(totalEl);

    container.appendChild(playerDiv);
  }

  $('mission-results').hidden = false;
}
```

- [ ] **Step 4: Update investigation screen phase progress dots**

The existing phase progress has 5 dots. Update to reflect new phases:

```js
// In investigation/discussion screen setup, update phase dots
function updatePhaseDots(phaseId) {
  const dots = document.querySelectorAll('#phase-progress .phase-dot');
  const phaseOrder = ['investigate1', 'discuss1', 'investigate2', 'discuss2', 'verdict'];
  const currentIdx = phaseOrder.indexOf(phaseId);

  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i <= currentIdx);
    dot.classList.toggle('current', i === currentIdx);
  });
}
```

- [ ] **Step 5: Update evidence collection complete to persist cards in state**

```js
socket.on('evidence-collection-complete', ({ collected, allCards }) => {
  // Update state with all accumulated cards
  if (allCards) {
    // Request card metadata for new cards
    state.allCards = allCards.map((id) => {
      const existing = state.allCards.find((c) => c.id === id);
      return existing || { id, title: id, type: 'unknown' };
    });
  }
  // ... existing rendering logic
});
```

- [ ] **Step 6: Update timer-update handler for discussion screen**

```js
socket.on('timer-update', ({ remaining }) => {
  // Update whichever timer is visible
  const phaseTimer = $('phase-timer');
  const discussTimer = $('discuss-timer');
  const aiChatTimer = $('ai-chat-timer');

  if (phaseTimer) phaseTimer.textContent = formatTime(remaining);
  if (discussTimer) discussTimer.textContent = formatTime(remaining);
  if (aiChatTimer) aiChatTimer.textContent = formatTime(remaining);

  // Timer warning at 60 seconds
  if (remaining <= 60 && !state.timerWarning) {
    state.timerWarning = true;
    showToast('60초 남았습니다!');
  }
});
```

- [ ] **Step 7: Commit**

```bash
git add public/app.js
git commit -m "feat: add verdict actions, story deduction, and mission results display"
```

---

### Task 9: Update Briefing Text in game-data.js

**Files:**
- Modify: `game-data.js`

This task ensures the briefing texts match the spec exactly, including the 6pm dismissal time, ARIA past behavior, and mission tables.

- [ ] **Step 1: Update culprit briefing**

Replace `roles.culprit.briefing` with the existing text + appended ARIA past behavior (spec 3.3) + mission table (spec 3.1). Change "오후 4시" to "오후 6시" throughout.

- [ ] **Step 2: Replace innocent briefing**

Replace `roles.innocent.briefing` with the full text from spec section 3.2 (the long briefing about the sleeping pill, USB, ARIA past behavior, and mission table with 4 missions including the new "정확한 살해 스토리를 추론하여 맞춘다 3점").

- [ ] **Step 3: Update narrative texts with 6pm dismissal**

Search all narrative text in phases for "오후 4시" / "4시" references and replace with "오후 6시" / "6시" where referring to dismissal time.

- [ ] **Step 4: Verify briefing text renders correctly**

```bash
node -e "const gd = require('./game-data'); console.log('Culprit briefing length:', gd.roles.culprit.briefing.length); console.log('Innocent briefing length:', gd.roles.innocent.briefing.length); console.log('Innocent has missions:', gd.roles.innocent.briefing.includes('미션'));"
```

- [ ] **Step 5: Commit**

```bash
git add game-data.js
git commit -m "feat: update briefings with ARIA past behavior, missions, and 6pm dismissal time"
```

---

### Task 10: Integration Testing and Bug Fixes

**Files:**
- All modified files

- [ ] **Step 1: Start the server and verify it boots**

```bash
node server.js &
# Check for any require errors or crashes
```

- [ ] **Step 2: Verify all game phases flow correctly**

Open two browser tabs, create a room, join, select characters, and verify:
1. Intro phase shows correctly with updated briefings
2. Investigation 1 shows 8 evidence cards in shared pool
3. Evidence collection works (alternating turns, 4 each)
4. Discussion 1 shows accumulated cards
5. Card reveal, trade, and combine work
6. ARIA mini-chat works in discussion
7. Investigation 2 shows 8 new evidence cards
8. Discussion 2 shows all accumulated cards (from both investigations)
9. Verdict phase shows correctly
10. Story deduction appears for innocent
11. Action phase triggers for culprit when conditions met
12. Ending shows with mission results

- [ ] **Step 3: Fix any issues found during testing**

Address any bugs, missing event handlers, or UI issues.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix: integration fixes for game phase redesign"
```
