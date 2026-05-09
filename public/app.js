/**
 * app.js — Client-side JavaScript for a 2-player murder mystery web game.
 *
 * Single-page application driven by Socket.IO. All screens live in index.html
 * as div.screen elements; only one carries the .active class at any time.
 *
 * Sections:
 *   1. State & Constants
 *   2. Utility Helpers
 *   3. Screen Management
 *   4. Typewriter Effect
 *   5. Toast Notifications
 *   6. Ambient Sound (Web Audio API)
 *   7. Sound Effects (Synthesized)
 *   8. Timer Formatting
 *   9. Evidence Rendering
 *  10. AI Chat Rendering
 *  11. Ending Sequence
 *  12. Socket Event Handlers
 *  13. DOM Event Bindings
 *  14. Initialization
 */

/* ==========================================================================
   1. STATE & CONSTANTS
   ========================================================================== */

/**
 * Central application state — the single source of truth for all runtime data.
 */
const state = {
  roomCode: null,
  playerNum: null,
  role: null,          // 'culprit' | 'innocent'
  character: null,     // Selected character object
  characterId: null,   // Selected character ID
  currentPhase: null,  // Current phase ID string
  viewedEvidence: new Set(),
  isReady: false,
  hasAccused: false,
  ambientStarted: false,
  timerWarning: false,
  soundEnabled: true,  // Sound on/off toggle
  // Evidence collection
  collectionActive: false,
  isMyTurn: false,
  collectedEvidence: [],  // IDs of evidence this player picked
  hasEvidence: false,     // Whether current phase has evidence to collect
  // Tab system — persistent info across phases
  introNarrative: '',      // Intro story text for "사건 개요" tab
  briefingText: '',        // Secret briefing text
  phase1Evidence: [],      // [{id, title, type}] cards collected in investigation1
  phase2Evidence: [],      // [{id, title, type}] cards collected in investigation2
  allCollectedEvidence: [],// [{id, title, type, phase}] all cards across phases
  comboCards: [],          // [{id, title, type, content}] successfully combined cards
  reachedPhases: new Set(),// Phase IDs the player has entered
  currentEvidenceId: null, // ID of the evidence currently open in modal
  isDiscussion: false,     // Whether current phase is a discussion phase
};

/**
 * Map of evidence type identifiers to emoji icons.
 */
const EVIDENCE_ICONS = {
  observation: '\uD83D\uDD0D',  // magnifying glass
  physical:    '\uD83D\uDD2C',  // microscope
  digital:     '\uD83D\uDCBB',  // laptop
  document:    '\uD83D\uDCDD',  // memo
  device:      '\uD83D\uDCF1',  // mobile phone
  log:         '\uD83D\uDCCB',  // clipboard
  video:       '\uD83D\uDCF9',  // video camera
  data:        '\uD83D\uDCCA',  // bar chart
  fragment:    '\uD83E\uDDE9',  // puzzle piece
  report:      '\uD83D\uDCC4',  // page facing up
  personal:    '\uD83D\uDD10',  // lock with key
};

/** Default icon for unknown evidence types. */
const DEFAULT_EVIDENCE_ICON = '\uD83D\uDCCB'; // clipboard

/* ==========================================================================
   2. UTILITY HELPERS
   ========================================================================== */

/**
 * Shorthand for document.getElementById.
 * @param {string} id - Element ID (without '#').
 * @returns {HTMLElement|null}
 */
function $(id) {
  return document.getElementById(id);
}

/** Returns the character's given name suffix like '(하진)', or '' if unavailable. */
function charSuffix() {
  return state.character ? `(${state.character.name.slice(1)})` : '';
}

/**
 * Return a promise that resolves after `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a small random integer in [min, max] (inclusive).
 * Useful for adding human-feeling jitter to timings.
 */
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/* ==========================================================================
   3. SCREEN MANAGEMENT
   ========================================================================== */

/** ID of the currently visible screen (without '#'). */
let currentScreenId = 'screen-title';

/**
 * Transition from the current screen to the target screen.
 *
 * Approach:
 *   1. Remove .active from every .screen element.
 *   2. Brief black-out period (300 ms) for cinematic feel.
 *   3. Add .active to the target screen.
 *   4. Play a subtle whoosh sound effect.
 *
 * @param {string} screenId - The target screen's ID (without '#').
 */
function showScreen(screenId) {
  const allScreens = document.querySelectorAll('.screen');
  allScreens.forEach((s) => s.classList.remove('active'));

  // Brief blackout before the new screen fades in.
  setTimeout(() => {
    const target = $(screenId);
    if (target) {
      target.classList.add('active');
      currentScreenId = screenId;
      saveStateToSession();
    }
    // Play transition sound effect.
    SFX.whoosh();
  }, 300);
}

/* ==========================================================================
   3b. SESSION STATE PERSISTENCE
   ========================================================================== */

/**
 * Save critical game state to sessionStorage so a normal refresh
 * returns the player to the same screen. Cleared only when the
 * tab/window is closed.
 */
function saveStateToSession() {
  try {
    const data = {
      roomCode: state.roomCode,
      playerNum: state.playerNum,
      role: state.role,
      character: state.character,
      characterId: state.characterId,
      currentPhase: state.currentPhase,
      currentScreenId: currentScreenId,
      viewedEvidence: [...state.viewedEvidence],
      hasAccused: state.hasAccused,
      // Tab system persistence
      introNarrative: state.introNarrative,
      briefingText: state.briefingText,
      phase1Evidence: state.phase1Evidence,
      phase2Evidence: state.phase2Evidence,
      allCollectedEvidence: state.allCollectedEvidence,
      comboCards: state.comboCards,
      reachedPhases: [...state.reachedPhases],
    };
    sessionStorage.setItem('murmy_state', JSON.stringify(data));
  } catch (_) {
    // sessionStorage not available — fail silently.
  }
}

/**
 * Restore game state from sessionStorage after a normal page refresh.
 * Returns true if state was restored, false otherwise.
 */
function restoreStateFromSession() {
  try {
    const raw = sessionStorage.getItem('murmy_state');
    if (!raw) return false;

    const data = JSON.parse(raw);
    if (!data || !data.roomCode || !data.currentScreenId) return false;

    // Don't restore to the title or lobby screens — those are safe to restart from.
    if (data.currentScreenId === 'screen-title' || data.currentScreenId === 'screen-lobby') {
      return false;
    }

    state.roomCode = data.roomCode;
    state.playerNum = data.playerNum;
    state.role = data.role;
    state.character = data.character;
    state.characterId = data.characterId;
    state.currentPhase = data.currentPhase;
    state.hasAccused = data.hasAccused || false;
    if (data.viewedEvidence) {
      state.viewedEvidence = new Set(data.viewedEvidence);
    }
    // Restore tab system state
    state.introNarrative = data.introNarrative || '';
    state.briefingText = data.briefingText || '';
    state.phase1Evidence = data.phase1Evidence || [];
    state.phase2Evidence = data.phase2Evidence || [];
    state.allCollectedEvidence = data.allCollectedEvidence || [];
    state.comboCards = data.comboCards || [];
    if (data.reachedPhases) {
      state.reachedPhases = new Set(data.reachedPhases);
    }
    // Show tabs if game is in progress
    if (state.role) {
      showGameTabs();
      updateTabStates();
    }

    // Show the saved screen immediately (no blackout transition).
    const allScreens = document.querySelectorAll('.screen');
    allScreens.forEach((s) => s.classList.remove('active'));
    const target = $(data.currentScreenId);
    if (target) {
      target.classList.add('active');
      currentScreenId = data.currentScreenId;
    }

    return true;
  } catch (_) {
    return false;
  }
}

/* ==========================================================================
   4. TYPEWRITER EFFECT
   ========================================================================== */

/** Per-element AbortControllers so concurrent typewriters on different elements don't cancel each other. */
const typewriterAborts = new WeakMap();

/**
 * Reveal text inside an element one character at a time.
 *
 * @param {HTMLElement} element - Target DOM element.
 * @param {string} text - The full string to reveal.
 * @param {number} [speed=30] - Milliseconds per character.
 * @returns {Promise<void>} Resolves when the full text has been revealed or
 *   the effect has been aborted.
 */
async function typewriter(element, text, speed = 30) {
  // Cancel any in-progress typewriter on this element.
  const existing = typewriterAborts.get(element);
  if (existing) existing.abort();
  const controller = new AbortController();
  typewriterAborts.set(element, controller);

  element.textContent = '';

  for (const char of text) {
    if (controller.signal.aborted) return;
    element.textContent += char;
    await new Promise((resolve) => setTimeout(resolve, speed));
  }

  // Clear the controller reference when finished naturally.
  if (typewriterAborts.get(element) === controller) {
    typewriterAborts.delete(element);
  }
}

/**
 * Typewriter variant specifically for the terminal-style epilogue.
 * Uses monospace styling and appends a blinking cursor character.
 *
 * @param {HTMLElement} element
 * @param {string} text
 * @param {number} [speed=45]
 */
async function terminalTypewriter(element, text, speed = 45) {
  element.textContent = '';
  element.classList.add('terminal-text');

  for (let i = 0; i < text.length; i++) {
    element.textContent = text.slice(0, i + 1) + '\u2588'; // block cursor
    await sleep(speed + randomBetween(-5, 10));
  }

  // Replace the block cursor with a blinking one via CSS class.
  element.textContent = text;
  const cursor = document.createElement('span');
  cursor.classList.add('blink-cursor');
  cursor.textContent = '\u2588';
  element.appendChild(cursor);
}

/**
 * LLM-style streaming text display — word-by-word with a blinking cursor.
 * Splits text into paragraphs on \n\n, then streams words within each.
 *
 * @param {HTMLElement} element - Container to render into.
 * @param {string} text - Full text with \n\n paragraph breaks.
 * @param {Object} [opts]
 * @param {number} [opts.wordDelay=30] - ms between words.
 * @param {number} [opts.paragraphPause=300] - extra ms pause between paragraphs.
 * @param {string[]} [opts.dangerPhrases=[]] - Phrases to highlight in red.
 */
async function streamText(element, text, opts = {}) {
  const { wordDelay = 30, paragraphPause = 300, dangerPhrases = [] } = opts;

  const existing = typewriterAborts.get(element);
  if (existing) existing.abort();
  const controller = new AbortController();
  typewriterAborts.set(element, controller);

  element.innerHTML = '';

  // If text contains dialogue lines, show a reading guide at the top
  if (/^.{1,5}:\s*"/m.test(text)) {
    const guide = document.createElement('p');
    guide.className = 'dialogue-guide';
    guide.textContent = '파란색 대사는 각자 역할을 맡은 사람이 소리내어 읽어주세요.';
    element.appendChild(guide);
  }

  // Streaming cursor
  const cursor = document.createElement('span');
  cursor.className = 'stream-cursor';
  cursor.textContent = '\u258C';

  const paragraphs = text.split('\n\n');

  for (let pi = 0; pi < paragraphs.length; pi++) {
    if (controller.signal.aborted) return;

    const p = document.createElement('p');
    p.className = 'stream-paragraph';
    element.appendChild(p);

    // Check if this paragraph contains a danger phrase
    let isDanger = false;
    for (const phrase of dangerPhrases) {
      if (paragraphs[pi].includes(phrase)) {
        isDanger = true;
        break;
      }
    }
    if (isDanger) p.classList.add('text-danger');

    // Dialogue lines (e.g. '도현: "..."') get highlighted
    if (/^.{1,5}:\s*"/.test(paragraphs[pi])) {
      p.classList.add('text-dialogue');
    }

    // Split paragraph into lines (single \n) then words
    const lines = paragraphs[pi].split('\n');

    for (let li = 0; li < lines.length; li++) {
      if (controller.signal.aborted) return;
      if (li > 0) p.appendChild(document.createElement('br'));

      // Split line into segments: reading guides like (도현이 읽어주세요) get special styling
      const segments = lines[li].split(/(\([^)]*읽어주세요\))/);
      for (const seg of segments) {
        if (controller.signal.aborted) return;
        const isGuide = /^\([^)]*읽어주세요\)$/.test(seg);
        const words = seg.split(/(\s+)/);
        for (const word of words) {
          if (controller.signal.aborted) return;
          if (isGuide && word.trim()) {
            const span = document.createElement('span');
            span.className = 'text-reading-guide';
            span.textContent = word;
            p.appendChild(span);
          } else {
            p.appendChild(document.createTextNode(word));
          }
          p.appendChild(cursor);
          if (word.trim()) {
            await new Promise((r) => setTimeout(r, wordDelay));
          }
        }
      }
    }

    // Pause between paragraphs
    if (pi < paragraphs.length - 1) {
      await new Promise((r) => setTimeout(r, paragraphPause));
    }
  }

  // Remove cursor when done
  if (cursor.parentNode) cursor.remove();

  if (typewriterAborts.get(element) === controller) {
    typewriterAborts.delete(element);
  }
}

/* ==========================================================================
   5. TOAST NOTIFICATIONS
   ========================================================================== */

/**
 * Show a brief notification message that auto-dismisses.
 *
 * Creates a small floating element at the top of the viewport, fades it in,
 * then removes it after 3 seconds.
 *
 * @param {string} message - Text to display.
 * @param {'error'|'info'} [type='error'] - Visual style of the toast.
 */
function showToast(message, type = 'error', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger reflow so the transition actually fires.
  // eslint-disable-next-line no-unused-expressions
  toast.offsetHeight;
  toast.classList.add('toast-visible');

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    // Remove from DOM after fade-out transition completes.
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

/* ==========================================================================
   6. AMBIENT SOUND (Web Audio API)
   ========================================================================== */

/**
 * AmbientSound manages continuous background audio layers:
 *   - Rain (filtered brown noise)
 *   - Drone (low-frequency oscillator)
 *   - Hum (simulated fluorescent light buzz)
 *
 * All layers are kept at very low gain (0.02–0.05) so they create atmosphere
 * without overpowering the experience.
 */
class AmbientSound {
  constructor() {
    this.ctx = null;
    this.nodes = {};  // Stores references to audio nodes for cleanup.
    this.running = false;
    this.bgm = null;  // HTMLAudioElement for background music
  }

  /**
   * Lazily initialise the AudioContext (required after user gesture).
   * @returns {AudioContext}
   */
  _ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (browser autoplay policy).
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Start all ambient layers simultaneously.
   */
  start() {
    if (this.running) return;
    if (!state.soundEnabled) return;
    this._ensureContext();
    this.startRain();
    this.startDrone();
    this.running = true;
  }

  startBGM(fromBeginning) {
    if (!this.bgm) {
      this.bgm = new Audio('/assets/bgm.mp3');
      this.bgm.loop = true;
      this.bgm.volume = 0.3;
    }
    if (fromBeginning) {
      this.bgm.currentTime = 0;
    }
    const p = this.bgm.play();
    if (p) p.catch(() => {});
  }

  /**
   * Brown noise filtered through a low-pass filter to approximate rain.
   *
   * Technique: Fill an AudioBuffer with random samples, apply a low-pass
   * BiquadFilter at ~400 Hz, and loop the buffer at very low volume.
   */
  startRain() {
    const ctx = this.ctx;
    const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate brown noise (integrated white noise).
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (last + 0.02 * white) / 1.02;
      last = data[i];
      data[i] *= 3.5; // amplify slightly before filtering
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;

    const gain = ctx.createGain();
    gain.gain.value = 0.04;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();

    this.nodes.rain = { source, filter, gain };
  }

  /**
   * Low oscillator drone in the 40–60 Hz range with very low gain.
   * Creates a foreboding sub-bass rumble.
   */
  startDrone() {
    const ctx = this.ctx;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 48; // Sub-bass frequency

    const gain = ctx.createGain();
    gain.gain.value = 0.03;

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    this.nodes.drone = { osc, gain };
  }

  /**
   * Simulates a fluorescent light buzz at 120 Hz with subtle harmonics.
   */
  startHum() {
    const ctx = this.ctx;

    // Fundamental 120 Hz hum.
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 120;

    // Second harmonic at 240 Hz.
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 240;

    const gain1 = ctx.createGain();
    gain1.gain.value = 0.02;

    const gain2 = ctx.createGain();
    gain2.gain.value = 0.008;

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc1.start();
    osc2.start();

    this.nodes.hum = { osc1, osc2, gain1, gain2 };
  }

  /**
   * Immediately stop all ambient layers and BGM.
   */
  stop() {
    if (this.bgm) {
      this.bgm.pause();
    }

    // Cancel any pending cleanup from a previous stop call.
    if (this._stopTimer) {
      clearTimeout(this._stopTimer);
      this._stopTimer = null;
    }

    // Immediately stop and disconnect all Web Audio nodes.
    Object.values(this.nodes).forEach((group) => {
      Object.values(group).forEach((node) => {
        try { node.stop?.(); } catch (_) { /* already stopped */ }
        try { node.disconnect(); } catch (_) { /* ok */ }
      });
    });

    this.nodes = {};
    this.running = false;
  }
}

/** Singleton ambient sound controller. */
const ambient = new AmbientSound();

/* ==========================================================================
   7. SOUND EFFECTS (Synthesized)
   ========================================================================== */

/**
 * SFX provides short, synthesized sound effects for UI interactions.
 * All effects are self-contained — they create and dispose of their own
 * AudioContext nodes.
 */
const SFX = {
  /** Lazy AudioContext getter (shares with ambient if available). */
  _ctx: null,
  _getCtx() {
    if (!this._ctx) {
      this._ctx = ambient.ctx || new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
    return this._ctx;
  },

  /**
   * Subtle mechanical click for button presses.
   * Technique: Very short muted pulse — soft keyboard tap feel.
   */
  click() {
    if (!state.soundEnabled) return;
    try {
      const ctx = this._getCtx();
      const t = ctx.currentTime;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.04);
    } catch (_) {
      // Audio not available — fail silently.
    }
  },

  /**
   * Soft fade for screen transitions.
   * Technique: Gentle low-pass filtered noise, very quiet.
   */
  whoosh() {
    if (!state.soundEnabled) return;
    try {
      const ctx = this._getCtx();
      const t = ctx.currentTime;
      const bufferSize = ctx.sampleRate * 0.2;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      // Brown noise for softer texture
      let last = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (last + 0.02 * white) / 1.02;
        last = data[i];
        data[i] *= 3;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.03, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      source.start(t);
      source.stop(t + 0.2);
    } catch (_) {
      // Audio not available — fail silently.
    }
  },

  /**
   * Calm mechanical tap for evidence card interaction.
   * Technique: Short, muted square-wave pulse — like a soft relay click.
   */
  reveal() {
    if (!state.soundEnabled) return;
    try {
      const ctx = this._getCtx();
      const t = ctx.currentTime;

      // Short low-mid tap
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 280;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      filter.Q.value = 0.5;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.08);
    } catch (_) {
      // Audio not available — fail silently.
    }
  },
};

/* ==========================================================================
   8. TIMER FORMATTING
   ========================================================================== */

/**
 * Convert a number of seconds into an MM:SS display string.
 * @param {number} seconds - Total remaining seconds.
 * @returns {string} Formatted time string, e.g. "02:35".
 */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Update all visible timer elements with the current remaining time.
 * Adds a `.warning` class when under 60 seconds for visual urgency.
 *
 * @param {number} remaining - Seconds remaining.
 */
function updateTimers(remaining) {
  const formatted = formatTime(remaining);

  const phaseTimer = $('phase-timer');
  const aiTimer = $('ai-chat-timer');

  [phaseTimer, aiTimer].forEach((el) => {
    if (el) {
      el.textContent = formatted;
      if (remaining < 60) {
        el.classList.add('warning');
      } else {
        el.classList.remove('warning');
      }
    }
  });

  // When timer gets critically low, add a subtle screen pulse effect.
  if (remaining < 30 && remaining > 0) {
    document.body.classList.add('timer-critical');
  } else {
    document.body.classList.remove('timer-critical');
  }
}

/* ==========================================================================
   9. EVIDENCE RENDERING
   ========================================================================== */

/**
 * Render a list of evidence cards into the evidence grid.
 * Each card displays the evidence title, an appropriate icon, and a "NEW"
 * badge if the player hasn't viewed it yet.
 *
 * @param {Array<{id: string, title: string, type: string}>} evidenceList
 */
function renderEvidenceCards(evidenceList) {
  const grid = $('evidence-grid');
  if (!grid) return;

  grid.innerHTML = '';

  evidenceList.forEach((ev) => {
    const card = document.createElement('div');
    card.className = 'evidence-card';
    card.dataset.id = ev.id;

    // Mark as new if the player hasn't viewed this evidence yet.
    if (!state.viewedEvidence.has(ev.id)) {
      card.classList.add('new');
    }

    const icon = document.createElement('span');
    icon.className = 'evidence-icon';
    icon.textContent = EVIDENCE_ICONS[ev.type] || DEFAULT_EVIDENCE_ICON;

    const title = document.createElement('span');
    title.className = 'evidence-title';
    title.textContent = ev.title;

    card.appendChild(icon);
    card.appendChild(title);

    // Add "NEW" badge for unseen evidence.
    if (!state.viewedEvidence.has(ev.id)) {
      const badge = document.createElement('span');
      badge.className = 'evidence-badge';
      badge.textContent = 'NEW';
      card.appendChild(badge);
    }

    // Click handler: request full evidence details from the server.
    card.addEventListener('click', () => {
      openEvidenceModal(ev.id);
    });

    grid.appendChild(card);
  });
}

/**
 * Open the evidence detail modal for a given evidence ID.
 * Shows a loading state, emits a request to the server, and marks the
 * evidence as viewed.
 *
 * @param {string} evidenceId
 */
function openEvidenceModal(evidenceId) {
  const modal = $('evidence-modal');
  if (!modal) return;

  // Show modal with loading placeholder.
  modal.removeAttribute('hidden');
  modal.classList.add('active');
  $('evidence-modal-title').textContent = '...';
  $('evidence-modal-type').textContent = '';
  $('evidence-modal-content').textContent = '';
  const imgWrap = $('evidence-modal-image-wrap');
  if (imgWrap) imgWrap.hidden = true;
  const comboEl = $('evidence-modal-combo-hint');
  if (comboEl) comboEl.hidden = true;

  // Play a reveal sound.
  SFX.reveal();

  // Small dramatic delay before the content appears.
  setTimeout(() => {
    socket.emit('request-evidence', { evidenceId });
  }, 200);

  // Mark evidence as viewed in local state.
  state.viewedEvidence.add(evidenceId);

  // Update the card in the grid to remove "new" styling.
  const card = document.querySelector(`.evidence-card[data-id="${evidenceId}"]`);
  if (card) {
    card.classList.remove('new');
    const badge = card.querySelector('.evidence-badge');
    if (badge) badge.remove();
  }
}

/**
 * Close the evidence detail modal.
 */
function closeEvidenceModal() {
  const modal = $('evidence-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.setAttribute('hidden', '');
  }
}

/* ==========================================================================
   9b. EVIDENCE COLLECTION (Turn-Based)
   ========================================================================== */

/**
 * Reset all evidence collection UI elements to their initial state.
 */
function resetEvidenceUI() {
  const prompt = $('evidence-collect-prompt');
  const waiting = $('evidence-waiting-partner');
  const turnIndicator = $('evidence-turn-indicator');
  const grid = $('evidence-grid');
  const heading = $('evidence-heading');
  const btnCollect = $('btn-start-collection');

  if (prompt) { prompt.hidden = false; prompt.style.display = ''; }
  if (waiting) waiting.hidden = true;
  if (turnIndicator) turnIndicator.hidden = true;
  if (grid) { grid.innerHTML = ''; grid.classList.remove('disabled'); }
  if (heading) heading.textContent = '증거';
  if (btnCollect) btnCollect.disabled = false;
}

/**
 * Show the "Go collect evidence" prompt button.
 */
function showEvidenceCollectPrompt() {
  const prompt = $('evidence-collect-prompt');
  const waiting = $('evidence-waiting-partner');
  const turnIndicator = $('evidence-turn-indicator');
  const grid = $('evidence-grid');

  if (prompt) { prompt.hidden = false; prompt.style.display = ''; }
  if (waiting) waiting.hidden = true;
  if (turnIndicator) turnIndicator.hidden = true;
  if (grid) grid.innerHTML = '';
}

/**
 * Render the evidence pool for turn-based selection.
 * Cards are clickable only when it's the player's turn.
 *
 * @param {Array<{id: string, title: string, type: string}>} pool
 * @param {boolean} isMyTurn
 */
function renderEvidencePool(pool, isMyTurn) {
  const grid = $('evidence-grid');
  const prompt = $('evidence-collect-prompt');
  const waiting = $('evidence-waiting-partner');
  const turnIndicator = $('evidence-turn-indicator');
  const turnStatus = $('turn-status');
  const heading = $('evidence-heading');

  if (prompt) prompt.style.display = 'none';
  if (waiting) waiting.hidden = true;
  if (turnIndicator) turnIndicator.hidden = false;
  if (heading) heading.textContent = '증거 수집';

  if (turnStatus) {
    turnStatus.textContent = isMyTurn ? '당신의 차례입니다' : '상대방의 차례입니다...';
    turnStatus.className = 'turn-status' + (isMyTurn ? ' my-turn' : ' other-turn');
  }

  if (!grid) return;
  grid.innerHTML = '';
  grid.classList.toggle('disabled', !isMyTurn);

  pool.forEach((ev) => {
    const card = document.createElement('div');
    card.className = 'evidence-card' + (isMyTurn ? ' selectable' : ' locked');
    card.dataset.id = ev.id;

    const icon = document.createElement('span');
    icon.className = 'evidence-icon';
    icon.textContent = EVIDENCE_ICONS[ev.type] || DEFAULT_EVIDENCE_ICON;

    const title = document.createElement('span');
    title.className = 'evidence-title';
    title.textContent = ev.title;

    card.appendChild(icon);
    card.appendChild(title);

    if (isMyTurn) {
      card.addEventListener('click', () => {
        SFX.click();
        // Disable further clicks immediately.
        grid.classList.add('disabled');
        card.classList.add('picking');
        socket.emit('pick-evidence', { evidenceId: ev.id });
      });
    }

    grid.appendChild(card);
  });
}

/**
 * Render only the evidence the player has collected (review mode).
 *
 * @param {Array<string>} collectedIds - IDs of collected evidence.
 */
function renderCollectedEvidence(collectedIds) {
  const grid = $('evidence-grid');
  const turnIndicator = $('evidence-turn-indicator');
  const heading = $('evidence-heading');

  if (turnIndicator) turnIndicator.hidden = true;
  if (heading) heading.textContent = '수집된 증거';
  if (!grid) return;

  grid.innerHTML = '';
  grid.classList.remove('disabled');

  collectedIds.forEach((evId) => {
    const card = document.createElement('div');
    card.className = 'evidence-card collected';
    card.dataset.id = evId;

    const icon = document.createElement('span');
    icon.className = 'evidence-icon';
    icon.textContent = DEFAULT_EVIDENCE_ICON;

    const title = document.createElement('span');
    title.className = 'evidence-title';
    title.textContent = evId; // Will be replaced when detail is fetched

    card.appendChild(icon);
    card.appendChild(title);

    card.addEventListener('click', () => {
      openEvidenceModal(evId);
    });

    grid.appendChild(card);
  });
}

/* ==========================================================================
   10. AI CHAT RENDERING
   ========================================================================== */

/**
 * Append a message bubble to the AI chat window.
 *
 * @param {'user'|'ai'} sender - Who sent the message.
 * @param {string} text - The message content.
 * @param {boolean} [useTypewriter=false] - Whether to reveal text with
 *   typewriter effect (used for AI responses).
 * @returns {HTMLElement} The created message element.
 */
async function addChatMessage(sender, text, useTypewriter = false) {
  const container = $('ai-chat-messages');
  if (!container) return null;

  const bubble = document.createElement('div');
  bubble.className = `chat-message chat-${sender}`;

  const content = document.createElement('div');
  content.className = 'chat-content';

  if (useTypewriter) {
    content.textContent = '';
    bubble.appendChild(content);
    container.appendChild(bubble);
    scrollChatToBottom();
    // Typewriter with slight speed variation for natural feel.
    const speed = 20 + randomBetween(-5, 5);
    await typewriter(content, text, speed);
  } else {
    content.textContent = text;
    bubble.appendChild(content);
    container.appendChild(bubble);
  }

  scrollChatToBottom();
  return bubble;
}

/**
 * Show a "typing..." indicator in the AI chat.
 * @returns {HTMLElement} The typing indicator element (for later removal).
 */
function showTypingIndicator() {
  const container = $('ai-chat-messages');
  if (!container) return null;

  const indicator = document.createElement('div');
  indicator.className = 'chat-message chat-ai typing-indicator';
  indicator.id = 'ai-typing-indicator';

  const dots = document.createElement('div');
  dots.className = 'typing-dots';
  dots.innerHTML = '<span></span><span></span><span></span>';

  indicator.appendChild(dots);
  container.appendChild(indicator);
  scrollChatToBottom();
  return indicator;
}

/**
 * Remove the typing indicator from the chat.
 */
function removeTypingIndicator() {
  const indicator = $('ai-typing-indicator');
  if (indicator) {
    indicator.remove();
  }
}

/**
 * Scroll the chat messages container to the very bottom.
 * Uses smooth scrolling when supported.
 */
function scrollChatToBottom() {
  const container = $('ai-chat-messages');
  if (container) {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }
}

/* ==========================================================================
   11. ENDING SEQUENCE
   ========================================================================== */

/**
 * Orchestrate the ending screen reveal.
 *
 * Paragraphs are revealed one at a time with fade-in animations and pauses
 * between them. The epilogue is presented in a terminal-style typewriter.
 *
 * @param {{endingType: string, title: string, narrative: string[], epilogue: string}} data
 */
async function showEnding(data) {
  showScreen('screen-ending');

  // Wait for the screen transition to complete.
  await sleep(500);

  // --- Title ---
  const titleEl = $('ending-title');
  if (titleEl) {
    titleEl.textContent = (data.title || '') + charSuffix();
    titleEl.classList.add('fade-in');
  }

  await sleep(1500);

  // --- Narrative paragraphs (one at a time) ---
  const narrativeContainer = $('ending-narrative');
  if (narrativeContainer) {
    narrativeContainer.innerHTML = '';

    for (const paragraph of (data.narrative || [])) {
      const p = document.createElement('p');
      p.className = 'ending-paragraph';
      p.textContent = paragraph;
      narrativeContainer.appendChild(p);

      // Trigger reflow, then add class for CSS fade-in transition.
      // eslint-disable-next-line no-unused-expressions
      p.offsetHeight;
      p.classList.add('visible');

      // Pause between paragraphs for dramatic pacing.
      await sleep(randomBetween(2000, 3000));
    }
  }

  await sleep(1500);

  // --- Epilogue (terminal-style typewriter) ---
  const epilogueWrapper = $('ending-epilogue');
  const epilogueBody = $('epilogue-terminal-body');
  if (epilogueWrapper && epilogueBody && data.epilogue) {
    epilogueWrapper.classList.add('visible');
    epilogueBody.innerHTML = ''; // Clear any existing content
    await sleep(500);
    await terminalTypewriter(epilogueBody, data.epilogue, 40);
  }

  // --- Show restart button ---
  const restartBtn = $('btn-restart');
  if (restartBtn) {
    await sleep(2000);
    restartBtn.classList.add('visible');
  }
}

/* ==========================================================================
   12. DISCONNECTION OVERLAY
   ========================================================================== */

/**
 * Show a full-screen overlay indicating the connection has been lost.
 */
function showDisconnectOverlay() {
  let overlay = $('disconnect-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'disconnect-overlay';
    overlay.innerHTML = '<div class="disconnect-message">' +
      '\uC5F0\uACB0\uC774 \uB04A\uC5B4\uC84C\uC2B5\uB2C8\uB2E4. \uC7AC\uC811\uC18D \uC911...' +
      '</div>';
    document.body.appendChild(overlay);
  }
  overlay.classList.add('active');
}

/**
 * Hide the disconnection overlay.
 */
function hideDisconnectOverlay() {
  const overlay = $('disconnect-overlay');
  if (overlay) {
    overlay.classList.remove('active');
  }
}

/* ==========================================================================
   13. MOBILE SUPPORT
   ========================================================================== */

/**
 * Handle virtual keyboard appearance on mobile.
 * When the keyboard opens, the visual viewport shrinks. We adjust the
 * chat input so it stays visible.
 */
function setupMobileKeyboardHandling() {
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const vv = window.visualViewport;
      // If the viewport has shrunk significantly, the keyboard is open.
      const keyboardOpen = vv.height < window.innerHeight * 0.75;

      if (keyboardOpen && currentScreenId === 'screen-ai-chat') {
        const input = $('ai-chat-input');
        if (input) {
          // Ensure the input is scrolled into view.
          setTimeout(() => {
            input.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }, 100);
        }
      }
    });
  }
}

/* ==========================================================================
   14. PHASE PROGRESS DOTS
   ========================================================================== */

/**
 * Update the phase progress dots display.
 * Each dot represents a phase; the current one gets an 'active' class.
 *
 * @param {string} currentPhaseId - ID of the current phase.
 * @param {number} totalPhases - Total number of phases (default 3).
 */
function updatePhaseProgress(currentPhaseId, totalPhases = 3) {
  const container = $('phase-progress');
  if (!container) return;

  // Extract phase number from ID (e.g., "phase_2" -> 2).
  const match = currentPhaseId?.match(/(\d+)/);
  const currentNum = match ? parseInt(match[1], 10) : 1;

  container.innerHTML = '';
  for (let i = 1; i <= totalPhases; i++) {
    const dot = document.createElement('span');
    dot.className = 'phase-dot';
    if (i <= currentNum) {
      dot.classList.add('completed');
    }
    if (i === currentNum) {
      dot.classList.add('active');
    }
    container.appendChild(dot);
  }
}

/* ==========================================================================
   15. NARRATIVE TOGGLE
   ========================================================================== */

/** Whether the narrative panel is currently collapsed. */
let narrativeCollapsed = false;

/**
 * Toggle the investigation narrative between collapsed and expanded states.
 */
function toggleNarrative() {
  const narrative = $('phase-narrative');
  const btn = $('btn-toggle-narrative');
  if (!narrative) return;

  narrativeCollapsed = !narrativeCollapsed;
  narrative.classList.toggle('collapsed', narrativeCollapsed);
  if (btn) {
    btn.textContent = narrativeCollapsed ? '\u25BC' : '\u25B2'; // down/up arrow
  }
}

/* ==========================================================================
   15b. GAME TABS MANAGEMENT
   ========================================================================== */

/**
 * Show the persistent game tabs at the top of the screen.
 */
function showGameTabs() {
  const tabs = $('game-tabs');
  if (tabs) {
    tabs.hidden = false;
    document.body.classList.add('tabs-visible');
  }
}

/**
 * Hide the game tabs.
 */
function hideGameTabs() {
  const tabs = $('game-tabs');
  if (tabs) {
    tabs.hidden = true;
    document.body.classList.remove('tabs-visible');
  }
}

/**
 * Update which tabs are enabled/disabled based on game progress.
 */
function updateTabStates() {
  const tabIntro = $('tab-intro');
  const tabPhase1 = $('tab-phase1');
  const tabPhase2 = $('tab-phase2');
  const tabCombo = $('tab-combo');

  // Intro tab is always enabled after game starts
  if (tabIntro) tabIntro.disabled = false;

  // Phase 1 tab — enabled once investigation1 has been entered
  if (tabPhase1) {
    tabPhase1.disabled = !state.reachedPhases.has('investigation1');
  }

  // Phase 2 tab — enabled once investigation2 has been entered
  if (tabPhase2) {
    tabPhase2.disabled = !state.reachedPhases.has('investigation2');
  }

  // Combo tab — enabled once at least one combo card exists
  if (tabCombo) {
    tabCombo.disabled = state.comboCards.length === 0;
  }
}

/**
 * Open a tab panel overlay showing the specified tab content.
 * @param {'intro'|'phase1'|'phase2'|'combo'} tabId
 */
function openTabPanel(tabId) {
  const overlay = $('tab-panel-overlay');
  const title = $('tab-panel-title');
  const body = $('tab-panel-body');
  if (!overlay || !title || !body) return;

  body.innerHTML = '';

  switch (tabId) {
    case 'intro':
      title.textContent = '사건 개요';
      renderIntroTabContent(body);
      break;
    case 'phase1':
      title.textContent = '조사 단계 1: 현장 조사';
      renderEvidenceTabContent(body, state.phase1Evidence);
      break;
    case 'phase2':
      title.textContent = '조사 단계 2: 디지털 흔적';
      renderEvidenceTabContent(body, state.phase2Evidence);
      break;
    case 'combo':
      title.textContent = '조합 카드';
      renderComboTabContent(body);
      break;
    default:
      return;
  }

  overlay.removeAttribute('hidden');
  overlay.classList.add('active');

  // Highlight active tab
  document.querySelectorAll('.game-tab').forEach((t) => t.classList.remove('active'));
  const activeTab = document.querySelector(`.game-tab[data-tab="${tabId}"]`);
  if (activeTab) activeTab.classList.add('active');
}

/**
 * Close the tab panel overlay.
 */
function closeTabPanel() {
  const overlay = $('tab-panel-overlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.setAttribute('hidden', '');
  }
  document.querySelectorAll('.game-tab').forEach((t) => t.classList.remove('active'));
}

/**
 * Render the intro narrative content in the tab panel.
 */
function renderIntroTabContent(container) {
  if (!state.introNarrative) {
    container.innerHTML = '<p class="tab-panel-empty">아직 사건 개요를 확인하지 않았습니다.</p>';
    return;
  }
  const narrativeDiv = document.createElement('div');
  narrativeDiv.className = 'tab-panel-narrative';
  narrativeDiv.textContent = state.introNarrative;
  container.appendChild(narrativeDiv);

  if (state.briefingText) {
    const separator = document.createElement('hr');
    separator.style.borderColor = 'var(--border)';
    separator.style.margin = '20px 0';
    container.appendChild(separator);

    const briefingLabel = document.createElement('h4');
    briefingLabel.textContent = '비밀 지령';
    briefingLabel.style.color = 'var(--accent-red)';
    briefingLabel.style.marginBottom = '8px';
    briefingLabel.style.fontFamily = 'var(--font-display)';
    briefingLabel.style.fontSize = '18px';
    container.appendChild(briefingLabel);

    const briefingDiv = document.createElement('div');
    briefingDiv.className = 'tab-panel-narrative';
    briefingDiv.textContent = state.briefingText;
    container.appendChild(briefingDiv);
  }
}

/**
 * Render evidence cards for a tab panel (phase 1, phase 2).
 */
function renderEvidenceTabContent(container, evidenceList) {
  if (!evidenceList || evidenceList.length === 0) {
    container.innerHTML = '<p class="tab-panel-empty">수집된 증거가 없습니다.</p>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'evidence-grid';

  evidenceList.forEach((ev) => {
    const card = document.createElement('div');
    card.className = 'evidence-card collected';
    card.dataset.id = ev.id;

    const icon = document.createElement('span');
    icon.className = 'evidence-icon';
    icon.textContent = EVIDENCE_ICONS[ev.type] || DEFAULT_EVIDENCE_ICON;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'evidence-title';
    titleSpan.textContent = ev.title;

    card.appendChild(icon);
    card.appendChild(titleSpan);

    card.addEventListener('click', () => {
      openEvidenceModal(ev.id);
    });

    grid.appendChild(card);
  });

  container.appendChild(grid);
}

/**
 * Render combo cards in the tab panel.
 */
function renderComboTabContent(container) {
  if (!state.comboCards || state.comboCards.length === 0) {
    container.innerHTML = '<p class="tab-panel-empty">조합된 카드가 없습니다.</p>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'evidence-grid';

  state.comboCards.forEach((combo) => {
    const card = document.createElement('div');
    card.className = 'evidence-card collected combo-card';
    card.dataset.id = combo.id;

    const icon = document.createElement('span');
    icon.className = 'evidence-icon';
    icon.textContent = EVIDENCE_ICONS[combo.type] || DEFAULT_EVIDENCE_ICON;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'evidence-title';
    titleSpan.textContent = combo.title;

    card.appendChild(icon);
    card.appendChild(titleSpan);

    card.addEventListener('click', () => {
      openEvidenceModal(combo.id);
    });

    grid.appendChild(card);
  });

  container.appendChild(grid);
}

/* ==========================================================================
   15c. COMBO CARD MODAL
   ========================================================================== */

/**
 * Show the combo success modal with the newly combined card.
 */
function showComboSuccessModal(data) {
  const modal = $('combo-modal');
  const titleEl = $('combo-modal-title');
  const typeEl = $('combo-modal-type');
  const contentEl = $('combo-modal-content');

  if (!modal) return;

  if (titleEl) titleEl.textContent = data.title || '';
  if (typeEl) {
    const icon = EVIDENCE_ICONS[data.type] || DEFAULT_EVIDENCE_ICON;
    typeEl.textContent = `${icon} ${data.type || ''}`;
  }
  if (contentEl) contentEl.textContent = data.content || '';

  modal.removeAttribute('hidden');
  modal.classList.add('active');
}

/**
 * Close the combo success modal.
 */
function closeComboModal() {
  const modal = $('combo-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.setAttribute('hidden', '');
  }
}

/* ==========================================================================
   15d. TRADE PROPOSAL UI
   ========================================================================== */

/**
 * Show the trade proposal modal when partner proposes a trade.
 */
function showTradeProposalModal(data) {
  const modal = $('trade-proposal-modal');
  const cardInfo = $('trade-proposed-card-info');
  const myCardsGrid = $('trade-my-cards-grid');

  if (!modal || !cardInfo || !myCardsGrid) return;

  // Show proposed card info
  const icon = EVIDENCE_ICONS[data.card.type] || DEFAULT_EVIDENCE_ICON;
  cardInfo.textContent = `${icon} ${data.card.title}`;

  // Show my cards for selection
  myCardsGrid.innerHTML = '';
  state.allCollectedEvidence.forEach((ev) => {
    const card = document.createElement('button');
    card.className = 'trade-my-card';
    card.textContent = `${EVIDENCE_ICONS[ev.type] || DEFAULT_EVIDENCE_ICON} ${ev.title}`;
    card.addEventListener('click', () => {
      SFX.click();
      socket.emit('trade-accept', { myCardId: ev.id });
      closeTradeProposalModal();
    });
    myCardsGrid.appendChild(card);
  });

  modal.removeAttribute('hidden');
  modal.classList.add('active');
}

function closeTradeProposalModal() {
  const modal = $('trade-proposal-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.setAttribute('hidden', '');
  }
}

/* ==========================================================================
   16. SOCKET EVENT HANDLERS
   ========================================================================== */

/**
 * Establish the Socket.IO connection and register all event handlers.
 */
const socket = io();

// ---- Room Management ----

socket.on('room-created', (data) => {
  state.roomCode = data.roomCode;
  state.playerNum = 1;
  saveStateToSession();

  // Update lobby UI to show the generated room code.
  const codeDisplay = $('room-code-display');
  if (codeDisplay) codeDisplay.textContent = data.roomCode;

  const lobbyStatus = $('lobby-status');
  if (lobbyStatus) lobbyStatus.textContent = '\uC0C1\uB300 \uD50C\uB808\uC774\uC5B4\uB97C \uAE30\uB2E4\uB9AC\uB294 \uC911...'; // Waiting for the other player...

  // Show the room-created info panel and hide the lobby options.
  const roomInfo = $('room-created-info');
  if (roomInfo) roomInfo.hidden = false;

  const lobbyOptions = document.querySelector('.lobby-options');
  if (lobbyOptions) lobbyOptions.style.display = 'none';
});

socket.on('room-joined', (data) => {
  if (data.success) {
    state.playerNum = data.playerNum;
    saveStateToSession();
    showScreen('screen-waiting');

    // Display room code on the waiting screen.
    const waitingCode = $('waiting-room-code');
    if (waitingCode) waitingCode.textContent = state.roomCode;

    // Mark own indicator so the player can identify themselves.
    const myIndicator = $(`ready-indicator-${state.playerNum}`);
    if (myIndicator) myIndicator.classList.add('is-self');

    // Enable the ready button since both players are now connected.
    const btnReady = $('btn-ready');
    if (btnReady) btnReady.disabled = false;
  } else {
    // Room not found (e.g. server restarted) — clear stale state and go home.
    state.roomCode = null;
    try { sessionStorage.removeItem('murmy_state'); } catch (_) {}
    showScreen('screen-title');
  }
});

socket.on('player-joined', (data) => {
  // Another player has joined; transition to the waiting screen.
  showScreen('screen-waiting');

  const waitingCode = $('waiting-room-code');
  if (waitingCode) waitingCode.textContent = state.roomCode;

  // Mark own indicator so the player can identify themselves.
  const myIndicator = $(`ready-indicator-${state.playerNum}`);
  if (myIndicator) myIndicator.classList.add('is-self');

  const waitingStatus = $('waiting-status');
  if (waitingStatus) waitingStatus.textContent = '\uBAA8\uB450 \uC811\uC18D\uD588\uC2B5\uB2C8\uB2E4. \uC900\uBE44\uB97C \uB20C\uB7EC\uC8FC\uC138\uC694!'; // All connected. Press ready!

  // Enable the ready button since both players are now connected.
  const btnReady = $('btn-ready');
  if (btnReady) btnReady.disabled = false;
});

// ---- Ready State ----

socket.on('ready-update', (data) => {
  // Only light up the OTHER player's dot.
  // Our own dot is handled by the click handler for instant feedback.
  if (data.playerNum === state.playerNum) return;

  const indicator = $(`ready-indicator-${data.playerNum}`);
  if (indicator) {
    indicator.classList.add('is-ready');
  }
});

socket.on('phase-ready-count', (data) => {
  // Update ready count display on both investigation and AI chat screens.
  const phaseReadyCount = $('phase-ready-count');
  const aiReadyCount = $('ai-ready-count');
  if (phaseReadyCount) phaseReadyCount.textContent = `${data.count}/2`;
  if (aiReadyCount) aiReadyCount.textContent = `${data.count}/2`;
});

// ---- Character Selection ----

// Pencil-sketch-style character silhouettes.
// Uses an SVG turbulence filter for hand-drawn line wobble.
const SKETCH_FILTER = '<defs><filter id="pencil"><feTurbulence type="turbulence" baseFrequency="0.04" numOctaves="4" result="noise" seed="2"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" xChannelSelector="R" yChannelSelector="G"/></filter></defs>';
const SK = 'filter="url(#pencil)"'; // shorthand

const CHARACTER_SILHOUETTES = {
  hajin: '<img src="/assets/hajin.png" alt="서하진" />',
  dohyun: '<img src="/assets/dohyun.png" alt="이도현" />',
};

function renderCharacterCards(characters) {
  const container = $('character-cards');
  if (!container) return;
  container.innerHTML = '';

  for (const char of characters) {
    const card = document.createElement('button');
    card.className = 'character-card';
    card.dataset.characterId = char.id;
    card.innerHTML =
      '<div class="character-silhouette">' + (CHARACTER_SILHOUETTES[char.id] || '') + '</div>' +
      '<div class="character-info">' +
        '<h3 class="character-name">' + char.name + '</h3>' +
        '<span class="character-age">' + char.age + '\uC138</span>' +
        '<p class="character-desc">' + char.desc + '</p>' +
        '<span class="character-trait">' + char.trait + '</span>' +
      '</div>';
    card.addEventListener('click', () => {
      if (card.classList.contains('taken')) return;
      SFX.click();

      if (card.classList.contains('selected')) {
        // Deselect current selection
        card.classList.remove('selected');
        socket.emit('select-character', { characterId: char.id });
        return;
      }

      // Select (or switch to) this character
      container.querySelectorAll('.character-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      socket.emit('select-character', { characterId: char.id });
    });
    container.appendChild(card);
  }
}

socket.on('show-character-select', (data) => {
  showScreen('screen-character-select');
  renderCharacterCards(data.characters);
  // Reset waiting UI
  const waiting = $('character-waiting');
  if (waiting) waiting.hidden = true;
});

socket.on('character-selected-by-other', (data) => {
  const container = $('character-cards');
  if (!container) return;
  const card = container.querySelector('[data-character-id="' + data.characterId + '"]');
  if (card) card.classList.add('taken');
});

socket.on('character-freed-by-other', (data) => {
  const container = $('character-cards');
  if (!container) return;
  const card = container.querySelector('[data-character-id="' + data.characterId + '"]');
  if (card) card.classList.remove('taken');
});

socket.on('character-deselected', () => {
  state.characterId = null;
  const waiting = $('character-waiting');
  if (waiting) waiting.hidden = true;
});

socket.on('character-confirmed', (data) => {
  state.characterId = data.characterId;
  const waiting = $('character-waiting');
  if (waiting) waiting.hidden = false;
});

socket.on('character-taken', () => {
  showToast('\uC774\uBBF8 \uC120\uD0DD\uB41C \uC778\uBB3C\uC785\uB2C8\uB2E4.');
  const container = $('character-cards');
  if (container) {
    container.querySelectorAll('.character-card').forEach((c) => c.classList.remove('selected'));
  }
});

// ---- Game Start ----

socket.on('game-start', async (data) => {
  state.role = data.role;
  state.playerNum = data.playerNum;
  state.character = data.character || null;
  saveStateToSession();

  // Start ambient audio on game start (user has interacted by now).
  if (!state.ambientStarted) {
    ambient.start();
    state.ambientStarted = true;
  }

  // Show the intro screen with role and briefing.
  showScreen('screen-intro');

  // Show game tabs and enable intro tab
  showGameTabs();
  updateTabStates();

  // Append character name to intro title.
  const introTitle = document.querySelector('.intro-title');
  if (introTitle) introTitle.textContent = `사건 개요${charSuffix()}`;

  // Start BGM 3 seconds after entering the intro (사건 개요) screen.
  setTimeout(() => {
    if (state.soundEnabled) {
      ambient.startBGM(true);
      state.bgmStarted = true;
    }
  }, 3000);

  await sleep(500);

  // Display role label with character name.
  const roleEl = $('intro-role');
  if (roleEl) {
    const roleName = data.role === 'culprit' ? '\uC6A9\uC758\uC790' : '\uC870\uC0AC\uAD00';
    const charName = state.character ? state.character.name : '';
    roleEl.textContent = charName ? `${charName} \xB7 ${roleName}` : roleName;
    roleEl.classList.add('fade-in');
  }

  await sleep(800);

  // Dissolve-in for general narrative intro.
  const narrativeEl = $('intro-narrative');
  const introText =
    'S 대학교 인공지능학과 자율시스템 연구실.\n국내 최상위 AI 연구 그룹으로, 최근 \'실제 인간 수준의 가치판단과 자율성을 가진 AI 시스템\' 연구로 학계 안팎의 큰 주목을 받고 있다.\n그 연구의 중심에는 ARIA가 있다. 연구실이 자체 개발한 자율 추론 인공지능. 로봇 팔과 연결되어 물리적 세계에도 개입할 수 있는, embodied AI 시스템이다.'
    + '\n\n'
    + '간만에 찾아온 긴 연휴. 캠퍼스는 텅 비었다.\n대부분의 학생들은 떠났지만, 당신은 학교 근처 자취방에 남아 교수의 업무를 처리하고 있었다.'
    + '\n\n'
    + '오후 10시, 교수에게서 갑자기 전화가 왔다.\n"AI 시스템의 응답 패턴이 이상하니까, 얼른 연구실로 와서 점검을 좀 해봐라."'
    + '\n\n'
    + '어쩐 일로 일찍 퇴근을 시켜준다고 했더니만... 치밀어오르는 분노를 참고 부랴부랴 연구실로 출발하여 도착한 시간은 밤 11시 가량.'
    + '\n\n'
    + '연구실 안에는 불이 켜져 있었고, 문 앞에는 동료가 기다리고 있었다.'
    + '\n\n'
    + '도현: "형도 올 줄 알았어요. 저도 교수님이 오라고 하셔서 방금 도착했는데, 문이 잠겨있어서 기다리고 있었거든요. 열쇠 형한테 있죠?"'
    + '\n\n'
    + '하진: "응, 내가 가지고 있어."'
    + '\n\n'
    + '(도현이 읽어주세요) 문을 열고 들어간 곳에는, 교수가 AI 어시스턴트 화면이 켜진 컴퓨터 책상 옆에 쓰러져 있었다.';

  // Save intro text for tab access
  state.introNarrative = introText;
  state.briefingText = data.briefing || '';

  if (narrativeEl) {
    await streamText(narrativeEl, introText, { wordDelay: 30, paragraphPause: 400 });
  }

  // Show the secret briefing after a pause.
  const briefingEl = $('intro-briefing');
  const briefingContent = $('briefing-content');
  if (briefingEl && briefingContent && data.briefing) {
    await sleep(800);
    briefingEl.style.display = 'block';
    briefingEl.classList.add('visible');
    await sleep(300);
    await streamText(briefingContent, data.briefing, {
      wordDelay: 30,
      paragraphPause: 350,
      dangerPhrases: ['\uB2F9\uC2E0\uC740 \uBC94\uC778\uC785\uB2C8\uB2E4.'],
    });
  }
});

// ---- Phase Data (Investigation) ----

socket.on('phase-data', async (data) => {
  state.currentPhase = data.phaseId;
  state.isReady = false;
  state.isDiscussion = data.isDiscussion || false;
  state.reachedPhases.add(data.phaseId);
  saveStateToSession();

  // Update tab states based on game progress
  updateTabStates();

  // Determine which screen to show based on the phase.
  const isAiPhase = data.phaseId === 'aria';
  const isVerdictPhase = data.phaseId === 'accusation';

  if (isVerdictPhase) {
    showScreen('screen-verdict');
    // Append character name to verdict title.
    const verdictTitle = document.querySelector('.verdict-title');
    if (verdictTitle) verdictTitle.textContent = `최종 판결${charSuffix()}`;
    // Reset verdict UI
    const verdictButtons = $('verdict-buttons');
    const verdictWaiting = $('verdict-waiting');
    if (verdictButtons) verdictButtons.style.display = '';
    if (verdictWaiting) verdictWaiting.style.display = 'none';
    state.hasAccused = false;
    // Show the "ARIA에게 명령" button only for the culprit
    const btnEliminate = $('btn-eliminate-partner');
    if (btnEliminate) {
      btnEliminate.hidden = state.role !== 'culprit';
    }
    return;
  }

  if (isAiPhase) {
    showScreen('screen-ai-chat');

    // Append character name to AI chat header.
    const aiNameEl = document.querySelector('.ai-name');
    if (aiNameEl) {
      const label = `ARIA${charSuffix()}`;
      aiNameEl.textContent = label;
      aiNameEl.setAttribute('data-text', label);
    }

    await sleep(400);

    // Clear previous chat messages.
    const chatContainer = $('ai-chat-messages');
    if (chatContainer) chatContainer.innerHTML = '';

    // Reset input.
    const chatInput = $('ai-chat-input');
    if (chatInput) chatInput.value = '';

    // Reset ready state.
    const aiReadyBtn = $('btn-ai-ready');
    if (aiReadyBtn) {
      aiReadyBtn.disabled = false;
      aiReadyBtn.classList.remove('active');
    }

    const aiReadyCount = $('ai-ready-count');
    if (aiReadyCount) aiReadyCount.textContent = '0/2';
  } else {
    showScreen('screen-investigation');

    await sleep(400);

    // Update phase metadata.
    const titleEl = $('phase-title');
    if (titleEl) titleEl.textContent = (data.title || '') + charSuffix();

    const subtitleEl = $('phase-subtitle');
    if (subtitleEl) subtitleEl.textContent = data.subtitle || '';

    // Phase narrative with LLM-style streaming.
    const narrativeEl = $('phase-narrative');
    if (narrativeEl && data.narrative) {
      narrativeEl.classList.remove('collapsed');
      narrativeCollapsed = false;
      await streamText(narrativeEl, data.narrative, { wordDelay: 25, paragraphPause: 300 });
    }

    // Show turn order guidance for investigation2
    if (data.turnOrderGuidance) {
      showToast(data.turnOrderGuidance, 'info', 5000);
    }

    // Evidence collection setup.
    state.hasEvidence = data.hasEvidence || false;
    state.collectionActive = false;
    state.isMyTurn = false;
    state.collectedEvidence = [];
    resetEvidenceUI();

    if (data.isDiscussion && data.collectedEvidence && data.collectedEvidence.length > 0) {
      // Discussion phase: show collected evidence for review/trade/combine
      state.allCollectedEvidence = data.collectedEvidence;
      const heading = $('evidence-heading');
      if (heading) heading.textContent = '보유 중인 증거';
      const prompt = $('evidence-collect-prompt');
      if (prompt) prompt.style.display = 'none';
      renderEvidenceCards(data.collectedEvidence);
    } else if (data.hasEvidence) {
      // Show "go collect" button; cards will appear after collection starts.
      showEvidenceCollectPrompt();
    } else if (data.evidenceList && data.evidenceList.length > 0) {
      // Phases without turn-based collection (fallback).
      renderEvidenceCards(data.evidenceList);
    }

    // Reset ready button state.
    const readyBtn = $('btn-phase-ready');
    if (readyBtn) {
      readyBtn.disabled = false;
      readyBtn.classList.remove('active');
    }

    const readyCount = $('phase-ready-count');
    if (readyCount) readyCount.textContent = '0/2';

    // Update phase progress dots.
    updatePhaseProgress(data.phaseId);
  }
});

// ---- Evidence Detail ----

socket.on('evidence-detail', (data) => {
  const titleEl = $('evidence-modal-title');
  const typeEl = $('evidence-modal-type');
  const contentEl = $('evidence-modal-content');

  state.currentEvidenceId = data.id;

  if (titleEl) titleEl.textContent = data.title || '';
  if (typeEl) {
    const icon = EVIDENCE_ICONS[data.type] || DEFAULT_EVIDENCE_ICON;
    typeEl.textContent = `${icon} ${data.type || ''}`;
  }
  if (contentEl) contentEl.textContent = data.content || '';

  // Show evidence image if available
  const imgWrap = $('evidence-modal-image-wrap');
  const imgEl = $('evidence-modal-image');
  if (imgWrap && imgEl && data.image) {
    imgEl.src = `/assets/evidence/${data.image}`;
    imgEl.alt = data.title || '';
    imgWrap.hidden = false;
  } else if (imgWrap) {
    imgWrap.hidden = true;
  }

  // Show combo hint if available
  const comboEl = $('evidence-modal-combo-hint');
  if (comboEl && data.comboHint) {
    comboEl.textContent = data.comboHint;
    comboEl.hidden = false;
  } else if (comboEl) {
    comboEl.hidden = true;
  }

  // Show action buttons contextually
  const actionButtons = $('evidence-action-buttons');
  const btnDonate = $('btn-donate-card');
  const btnExchange = $('btn-exchange-card');
  const btnCombine = $('btn-combine-card');

  if (actionButtons && !data.isComboCard) {
    const showDonate = data.canDonate;
    const showExchange = data.canExchange;
    const showCombine = data.comboHint; // card has combo potential

    if (showDonate || showExchange || showCombine) {
      actionButtons.hidden = false;
      if (btnDonate) { btnDonate.hidden = !showDonate; btnDonate.disabled = false; }
      if (btnExchange) { btnExchange.hidden = !showExchange; btnExchange.disabled = false; }
      if (btnCombine) {
        btnCombine.hidden = !showCombine;
        btnCombine.disabled = !data.canCombine;
        btnCombine.dataset.comboId = data.comboId || '';
      }
    } else {
      actionButtons.hidden = true;
    }
  } else if (actionButtons) {
    actionButtons.hidden = true;
  }
});

// ---- Evidence Collection (Turn-Based) ----

socket.on('evidence-waiting', () => {
  // Player clicked "go collect" but partner hasn't yet.
  const prompt = $('evidence-collect-prompt');
  const waiting = $('evidence-waiting-partner');
  if (prompt) prompt.style.display = 'none';
  if (waiting) waiting.hidden = false;
});

socket.on('evidence-collection-state', (data) => {
  // Turn-based collection is active. Show the pool with turn info.
  state.collectionActive = true;
  state.isMyTurn = data.isYourTurn;
  renderEvidencePool(data.pool, data.isYourTurn);
});

socket.on('evidence-picked', (data) => {
  // This player successfully picked an evidence item. Show its content in modal.
  state.collectedEvidence.push(data.id);
  state.currentEvidenceId = data.id;

  const titleEl = $('evidence-modal-title');
  const typeEl = $('evidence-modal-type');
  const contentEl = $('evidence-modal-content');
  const modal = $('evidence-modal');

  if (modal) {
    modal.removeAttribute('hidden');
    modal.classList.add('active');
  }
  if (titleEl) titleEl.textContent = data.title || '';
  if (typeEl) {
    const icon = EVIDENCE_ICONS[data.type] || DEFAULT_EVIDENCE_ICON;
    typeEl.textContent = `${icon} ${data.type || ''}`;
  }
  if (contentEl) contentEl.textContent = data.content || '';

  // Show evidence image if available
  const imgWrap = $('evidence-modal-image-wrap');
  const imgEl = $('evidence-modal-image');
  if (imgWrap && imgEl && data.image) {
    imgEl.src = `/assets/evidence/${data.image}`;
    imgEl.alt = data.title || '';
    imgWrap.hidden = false;
  } else if (imgWrap) {
    imgWrap.hidden = true;
  }

  // Show combo hint if available
  const comboEl = $('evidence-modal-combo-hint');
  if (comboEl && data.comboHint) {
    comboEl.textContent = data.comboHint;
    comboEl.hidden = false;
  } else if (comboEl) {
    comboEl.hidden = true;
  }

  SFX.reveal();
});

socket.on('partner-picked', () => {
  // The partner picked their evidence. Just a notification.
  showToast('상대방이 증거를 수집했습니다.', 'info');
});

socket.on('evidence-collection-complete', (data) => {
  // All evidence has been collected. Show only what this player picked.
  state.collectionActive = false;
  state.collectedEvidence = data.collected || [];

  // Save full card info per phase for tab access
  const collectedFull = data.collectedFull || [];
  if (data.phase === 'investigation1') {
    state.phase1Evidence = collectedFull;
  } else if (data.phase === 'investigation2') {
    state.phase2Evidence = collectedFull;
  }
  // Update allCollectedEvidence
  state.allCollectedEvidence = [
    ...state.phase1Evidence,
    ...state.phase2Evidence,
  ];

  // Update tab states (phase1/phase2 tabs now have content)
  updateTabStates();

  renderCollectedEvidence(state.collectedEvidence);
  showToast('증거 수집이 완료되었습니다.', 'info');
});

// ---- Combo Success ----

socket.on('combo-success', (data) => {
  // Add to combo cards state
  state.comboCards.push({
    id: data.id,
    title: data.title,
    type: data.type,
    content: data.content,
  });

  // Update tab states (combo tab now active)
  updateTabStates();

  // Close evidence modal if open
  closeEvidenceModal();

  // Show combo success modal
  showComboSuccessModal(data);
});

// ---- Trade Proposal (received from partner) ----

socket.on('trade-proposal', (data) => {
  showTradeProposalModal(data);
});

socket.on('trade-proposed', () => {
  showToast('교환을 제안했습니다. 상대방의 응답을 기다리는 중...', 'info');
  closeEvidenceModal();
});

socket.on('trade-completed', (data) => {
  // Update local evidence lists
  if (data.gave && data.received) {
    // Remove the given card
    state.allCollectedEvidence = state.allCollectedEvidence.filter((e) => e.id !== data.gave.id);
    state.phase1Evidence = state.phase1Evidence.filter((e) => e.id !== data.gave.id);
    state.phase2Evidence = state.phase2Evidence.filter((e) => e.id !== data.gave.id);

    // Add the received card
    const receivedCard = { id: data.received.id, title: data.received.title, type: data.received.type };
    state.allCollectedEvidence.push(receivedCard);
    // Determine which phase list to add to based on ID prefix
    if (data.received.id.includes('inv1')) {
      state.phase1Evidence.push(receivedCard);
    } else if (data.received.id.includes('inv2')) {
      state.phase2Evidence.push(receivedCard);
    }
  }
  showToast(`교환 완료! "${data.received?.title || ''}" 카드를 받았습니다.`, 'info');

  // Re-render evidence if on discussion phase
  if (state.isDiscussion) {
    renderEvidenceCards(state.allCollectedEvidence);
  }
});

socket.on('trade-rejected', (data) => {
  showToast(data.reason || '교환이 거절되었습니다.', 'error');
});

socket.on('trade-reject-confirmed', () => {
  showToast('교환을 거절했습니다.', 'info');
});

// ---- Donate Completed ----

socket.on('donate-completed', (data) => {
  if (data.direction === 'gave') {
    // Remove from local evidence
    state.allCollectedEvidence = state.allCollectedEvidence.filter((e) => e.id !== data.cardId);
    state.phase1Evidence = state.phase1Evidence.filter((e) => e.id !== data.cardId);
    state.phase2Evidence = state.phase2Evidence.filter((e) => e.id !== data.cardId);
    showToast(`"${data.card?.title || ''}" 카드를 양도했습니다.`, 'info');
    closeEvidenceModal();
  } else {
    // Received a card
    const card = data.card || { id: data.cardId, title: data.cardId, type: 'unknown' };
    state.allCollectedEvidence.push(card);
    if (card.id.includes('inv1')) {
      state.phase1Evidence.push(card);
    } else if (card.id.includes('inv2')) {
      state.phase2Evidence.push(card);
    }
    showToast(`"${card.title}" 카드를 받았습니다!`, 'info');
  }

  // Re-render evidence if on discussion phase
  if (state.isDiscussion) {
    renderEvidenceCards(state.allCollectedEvidence);
  }
});

socket.on('donate-rejected', (data) => {
  showToast(data.reason || '양도가 거절되었습니다.', 'error');
});

// ---- AI Chat Responses ----

socket.on('ai-chat-response', async (data) => {
  if (data.isTyping) {
    // Show typing indicator.
    showTypingIndicator();
  } else {
    // Remove typing indicator and show the actual message.
    removeTypingIndicator();
    if (data.message) {
      await addChatMessage('ai', data.message, true);
    }
  }
});

// ---- Timer ----

socket.on('timer-update', (data) => {
  updateTimers(data.remaining);
});

// ---- Accusations ----

socket.on('accusation-received', (data) => {
  // Another accusation was received; update the waiting state if needed.
  const waitingEl = $('verdict-waiting');
  if (waitingEl && state.hasAccused) {
    waitingEl.textContent = `\uD310\uACB0 \uB300\uAE30 \uC911... (${data.count}/2)`; // Waiting for verdict...
  }
});

// ---- Game Ending ----

socket.on('game-ending', async (data) => {
  await showEnding(data);
});

// ---- Partner Disconnected ----

socket.on('partner-disconnected', () => {
  showToast('\uC0C1\uB300 \uD50C\uB808\uC774\uC5B4\uAC00 \uC5F0\uACB0\uC774 \uB04A\uC5B4\uC84C\uC2B5\uB2C8\uB2E4.', 'error'); // The other player disconnected.
});

// ---- Generic Error ----

socket.on('error', (data) => {
  showToast(data.message || '\uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.'); // An error occurred.
});

// ---- Connection Events ----

socket.on('disconnect', () => {
  showDisconnectOverlay();
});

socket.on('connect', () => {
  hideDisconnectOverlay();

  // If we were in a room, attempt to re-join on reconnect.
  if (state.roomCode) {
    socket.emit('join-room', { roomCode: state.roomCode });
  }
});

/* ==========================================================================
   17. DOM EVENT BINDINGS
   ========================================================================== */

/**
 * Bind all interactive elements once the DOM is ready.
 */
function bindEvents() {

  // ---- Game Tabs ----

  document.querySelectorAll('.game-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.disabled) return;
      SFX.click();
      const tabId = tab.dataset.tab;
      openTabPanel(tabId);
    });
  });

  const tabPanelClose = $('tab-panel-close');
  if (tabPanelClose) {
    tabPanelClose.addEventListener('click', () => {
      SFX.click();
      closeTabPanel();
    });
  }

  const tabPanelOverlay = $('tab-panel-overlay');
  if (tabPanelOverlay) {
    tabPanelOverlay.addEventListener('click', (e) => {
      if (e.target === tabPanelOverlay) closeTabPanel();
    });
  }

  // ---- Combo Modal ----

  const btnCloseCombo = $('btn-close-combo');
  if (btnCloseCombo) {
    btnCloseCombo.addEventListener('click', () => {
      SFX.click();
      closeComboModal();
    });
  }

  const comboModal = $('combo-modal');
  if (comboModal) {
    comboModal.addEventListener('click', (e) => {
      if (e.target === comboModal) closeComboModal();
    });
  }

  // ---- Trade Proposal Modal ----

  const btnTradeReject = $('btn-trade-reject');
  if (btnTradeReject) {
    btnTradeReject.addEventListener('click', () => {
      SFX.click();
      socket.emit('trade-reject', {});
      closeTradeProposalModal();
    });
  }

  const tradeProposalModal = $('trade-proposal-modal');
  if (tradeProposalModal) {
    tradeProposalModal.addEventListener('click', (e) => {
      if (e.target === tradeProposalModal) {
        socket.emit('trade-reject', {});
        closeTradeProposalModal();
      }
    });
  }

  // ---- Evidence Action Buttons ----

  const btnDonateCard = $('btn-donate-card');
  if (btnDonateCard) {
    btnDonateCard.addEventListener('click', () => {
      if (!state.currentEvidenceId) return;
      SFX.click();
      socket.emit('donate-card', { cardId: state.currentEvidenceId });
    });
  }

  const btnExchangeCard = $('btn-exchange-card');
  if (btnExchangeCard) {
    btnExchangeCard.addEventListener('click', () => {
      if (!state.currentEvidenceId) return;
      SFX.click();
      socket.emit('trade-propose', { cardId: state.currentEvidenceId });
    });
  }

  const btnCombineCard = $('btn-combine-card');
  if (btnCombineCard) {
    btnCombineCard.addEventListener('click', () => {
      if (btnCombineCard.disabled) return;
      const comboId = btnCombineCard.dataset.comboId;
      if (!comboId) return;
      SFX.click();
      socket.emit('combine-cards', { comboId });
    });
  }

  // ---- Sound Toggle ----

  const btnSoundToggle = $('btn-sound-toggle');
  const tabSoundToggle = $('tab-sound-toggle');

  function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    // Sync both buttons
    if (btnSoundToggle) btnSoundToggle.classList.toggle('sound-on', state.soundEnabled);
    if (tabSoundToggle) tabSoundToggle.classList.toggle('sound-on', state.soundEnabled);

    if (state.soundEnabled) {
      if (state.ambientStarted) ambient.start();
      if (state.bgmStarted) ambient.startBGM();
    } else {
      ambient.stop();
    }
  }

  if (btnSoundToggle) btnSoundToggle.addEventListener('click', toggleSound);
  if (tabSoundToggle) tabSoundToggle.addEventListener('click', toggleSound);

  // ---- Title Screen ----

  const btnStart = $('btn-start');
  if (btnStart) {
    btnStart.addEventListener('click', () => {
      SFX.click();
      // Start ambient on first user interaction (autoplay policy compliance).
      if (!state.ambientStarted) {
        ambient._ensureContext();
        ambient.startRain();
        ambient.startDrone();
        ambient.running = true;
        state.ambientStarted = true;
      }
      showScreen('screen-lobby');
    });
  }

  // ---- Lobby Screen ----

  const btnCreateRoom = $('btn-create-room');
  if (btnCreateRoom) {
    btnCreateRoom.addEventListener('click', () => {
      SFX.click();
      socket.emit('create-room', {});

      // Show the create section, hide the join section.
      const createSection = $('lobby-create-section');
      const joinSection = $('lobby-join-section');
      if (createSection) createSection.classList.add('active');
      if (joinSection) joinSection.classList.remove('active');
    });
  }

  const btnJoinRoom = $('btn-join-room');
  if (btnJoinRoom) {
    btnJoinRoom.addEventListener('click', () => {
      SFX.click();
      const input = $('input-room-code');
      const code = input ? input.value.trim().toUpperCase() : '';

      if (!code) {
        showToast('\uBC29 \uCF54\uB4DC\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694.'); // Please enter a room code.
        return;
      }

      state.roomCode = code;
      socket.emit('join-room', { roomCode: code });
    });
  }

  // Also allow pressing Enter in the room code input to join.
  const inputRoomCode = $('input-room-code');
  if (inputRoomCode) {
    inputRoomCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const btn = $('btn-join-room');
        if (btn) btn.click();
      }
    });
  }

  // ---- Waiting Screen ----

  const btnReady = $('btn-ready');
  if (btnReady) {
    btnReady.addEventListener('click', () => {
      SFX.click();
      state.isReady = true;
      btnReady.disabled = true;
      btnReady.classList.add('active');

      // Immediately fill own ready dot for instant feedback.
      const myIndicator = $(`ready-indicator-${state.playerNum}`);
      if (myIndicator) myIndicator.classList.add('is-ready');

      socket.emit('player-ready', {});
    });
  }

  // ---- Intro Screen ----

  const btnIntroNext = $('btn-intro-next');
  if (btnIntroNext) {
    btnIntroNext.addEventListener('click', () => {
      SFX.click();
      // The server will send phase-data to advance the game.
      // We signal readiness to move on.
      socket.emit('phase-ready', {});
    });
  }

  // ---- Investigation Screen ----

  const btnStartCollection = $('btn-start-collection');
  if (btnStartCollection) {
    btnStartCollection.addEventListener('click', () => {
      SFX.click();
      btnStartCollection.disabled = true;
      socket.emit('start-evidence-collection');
    });
  }

  const btnCloseEvidence = $('btn-close-evidence');
  if (btnCloseEvidence) {
    btnCloseEvidence.addEventListener('click', () => {
      SFX.click();
      closeEvidenceModal();
    });
  }

  // Also close evidence modal when clicking outside the content.
  const evidenceModal = $('evidence-modal');
  if (evidenceModal) {
    evidenceModal.addEventListener('click', (e) => {
      if (e.target === evidenceModal) {
        closeEvidenceModal();
      }
    });
  }

  const btnPhaseReady = $('btn-phase-ready');
  if (btnPhaseReady) {
    btnPhaseReady.addEventListener('click', () => {
      SFX.click();
      state.isReady = true;
      btnPhaseReady.disabled = true;
      btnPhaseReady.classList.add('active');
      socket.emit('phase-ready', {});
    });
  }

  const btnToggleNarrative = $('btn-toggle-narrative');
  if (btnToggleNarrative) {
    btnToggleNarrative.addEventListener('click', () => {
      toggleNarrative();
    });
  }

  // ---- AI Chat Screen ----

  const btnAiSend = $('btn-ai-send');
  if (btnAiSend) {
    btnAiSend.addEventListener('click', () => {
      sendAiMessage();
    });
  }

  const aiChatInput = $('ai-chat-input');
  if (aiChatInput) {
    aiChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAiMessage();
      }
    });
  }

  const btnAiReady = $('btn-ai-ready');
  if (btnAiReady) {
    btnAiReady.addEventListener('click', () => {
      SFX.click();
      btnAiReady.disabled = true;
      btnAiReady.classList.add('active');
      socket.emit('phase-ready', {});
    });
  }

  // ---- Verdict Screen ----

  const btnAccusePartner = $('btn-accuse-partner');
  if (btnAccusePartner) {
    btnAccusePartner.addEventListener('click', () => {
      submitAccusation('partnerHuman');
    });
  }

  const btnAccuseAi = $('btn-accuse-ai');
  if (btnAccuseAi) {
    btnAccuseAi.addEventListener('click', () => {
      submitAccusation('aria');
    });
  }

  const btnAccuseSelf = $('btn-accuse-self');
  if (btnAccuseSelf) {
    btnAccuseSelf.addEventListener('click', () => {
      submitAccusation('self');
    });
  }

  const btnEliminatePartner = $('btn-eliminate-partner');
  if (btnEliminatePartner) {
    btnEliminatePartner.addEventListener('click', () => {
      submitAccusation('eliminatePartner');
    });
  }

  // ---- Ending Screen ----

  const btnRestart = $('btn-restart');
  if (btnRestart) {
    btnRestart.addEventListener('click', () => {
      SFX.click();
      resetGameState();
      showScreen('screen-title');
    });
  }
}

/**
 * Send the player's message in the AI chat.
 * Validates that the input is non-empty, emits the message, and immediately
 * renders it in the chat window.
 */
function sendAiMessage() {
  const input = $('ai-chat-input');
  if (!input) return;

  const message = input.value.trim();
  if (!message) return;

  SFX.click();

  // Emit to server.
  socket.emit('ai-chat-send', { message });

  // Show the user's own message immediately.
  addChatMessage('user', message, false);

  // Clear the input.
  input.value = '';
  input.focus();
}

/**
 * Submit the player's accusation and update the verdict UI.
 *
 * @param {'partnerHuman'|'aria'|'self'} target - Who the player is accusing.
 */
function submitAccusation(target) {
  if (state.hasAccused) return;

  SFX.click();
  state.hasAccused = true;

  socket.emit('submit-accusation', { target });

  // Disable all accusation buttons.
  const buttonsContainer = $('verdict-buttons');
  if (buttonsContainer) {
    buttonsContainer.classList.add('hidden');
  }

  // Show waiting message.
  const waitingEl = $('verdict-waiting');
  if (waitingEl) {
    waitingEl.classList.remove('hidden');
    waitingEl.textContent = '\uC0C1\uB300 \uD50C\uB808\uC774\uC5B4\uC758 \uD310\uACB0\uC744 \uAE30\uB2E4\uB9AC\uB294 \uC911...'; // Waiting for the other player's verdict...
  }
}

/**
 * Reset all local game state to initial values so a fresh game can start.
 */
function resetGameState() {
  state.roomCode = null;
  state.playerNum = null;
  state.role = null;
  state.character = null;
  state.characterId = null;
  state.currentPhase = null;
  state.viewedEvidence = new Set();
  state.isReady = false;
  state.hasAccused = false;
  // Reset tab system state
  state.introNarrative = '';
  state.briefingText = '';
  state.phase1Evidence = [];
  state.phase2Evidence = [];
  state.allCollectedEvidence = [];
  state.comboCards = [];
  state.reachedPhases = new Set();
  state.currentEvidenceId = null;
  state.isDiscussion = false;

  // Clear saved session so refresh goes to title screen.
  try { sessionStorage.removeItem('murmy_state'); } catch (_) {}

  // Reset any lingering UI states.
  narrativeCollapsed = false;
  document.body.classList.remove('timer-critical');

  // Hide game tabs
  hideGameTabs();

  // Restore lobby UI for next game.
  const lobbyOptions = document.querySelector('.lobby-options');
  if (lobbyOptions) lobbyOptions.style.display = '';

  const roomInfo = $('room-created-info');
  if (roomInfo) roomInfo.hidden = true;

  const btnReady = $('btn-ready');
  if (btnReady) {
    btnReady.disabled = true;
    btnReady.classList.remove('active');
  }

  // Reset ready indicators.
  for (let i = 1; i <= 2; i++) {
    const ind = $(`ready-indicator-${i}`);
    if (ind) {
      ind.classList.remove('is-ready', 'is-self');
    }
  }
}

/* ==========================================================================
   18. INITIALIZATION
   ========================================================================== */

/**
 * Boot the application once the DOM is fully loaded.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Bind all event listeners.
  bindEvents();

  // Set up mobile keyboard handling.
  setupMobileKeyboardHandling();

  // Initialize sound toggle button state.
  const soundBtn = $('btn-sound-toggle');
  if (soundBtn) soundBtn.classList.toggle('sound-on', state.soundEnabled);
  const tabSoundBtn = $('tab-sound-toggle');
  if (tabSoundBtn) tabSoundBtn.classList.toggle('sound-on', state.soundEnabled);

  // Inject minimal toast and overlay styles if not already present.
  injectDynamicStyles();

  // Try to restore session state (normal refresh). If no saved state,
  // show the title screen as usual.
  const restored = restoreStateFromSession();
  if (!restored) {
    showScreen('screen-title');
  } else {
    // Reconnect to room — the socket 'connect' handler will re-join.
    console.log('[murmy] Session restored. Reconnecting to room:', state.roomCode);
  }

  console.log('[murmy] Client initialized.');
});

/**
 * Inject a small set of dynamic CSS rules that are tightly coupled to the
 * JavaScript behavior (toasts, overlays, animations). These are injected
 * here rather than in an external stylesheet because they only make sense
 * in the context of this script.
 */
function injectDynamicStyles() {
  // Avoid double injection.
  if ($('murmy-dynamic-styles')) return;

  const style = document.createElement('style');
  style.id = 'murmy-dynamic-styles';
  style.textContent = `
    /* ---- Toast Notifications ---- */
    .toast {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(-20px);
      padding: 12px 24px;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      z-index: 10000;
      opacity: 0;
      transition: opacity 0.3s ease, transform 0.3s ease;
      pointer-events: none;
      max-width: 90vw;
      text-align: center;
    }
    .toast-error {
      background: rgba(200, 40, 40, 0.92);
    }
    .toast-info {
      background: rgba(40, 100, 200, 0.92);
    }
    .toast-visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    /* ---- Disconnect Overlay ---- */
    #disconnect-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.4s ease;
    }
    #disconnect-overlay.active {
      opacity: 1;
      pointer-events: auto;
    }
    .disconnect-message {
      color: #ccc;
      font-size: 16px;
      text-align: center;
      animation: pulse-text 2s ease-in-out infinite;
    }

    /* ---- Timer Warning ---- */
    .warning {
      color: #ff4444 !important;
      animation: timer-pulse 1s ease-in-out infinite;
    }

    /* ---- Timer Critical Screen Effect ---- */
    body.timer-critical {
      animation: screen-shake 0.5s ease-in-out infinite;
    }

    /* ---- Typing Indicator Dots ---- */
    .typing-dots {
      display: flex;
      gap: 4px;
      padding: 8px 12px;
    }
    .typing-dots span {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #888;
      animation: typing-bounce 1.4s ease-in-out infinite;
    }
    .typing-dots span:nth-child(2) {
      animation-delay: 0.2s;
    }
    .typing-dots span:nth-child(3) {
      animation-delay: 0.4s;
    }

    /* ---- Terminal Blinking Cursor ---- */
    .blink-cursor {
      animation: blink 1s step-end infinite;
    }

    /* ---- Ending Paragraph Reveal ---- */
    .ending-paragraph {
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.8s ease, transform 0.8s ease;
    }
    .ending-paragraph.visible {
      opacity: 1;
      transform: translateY(0);
    }

    /* ---- Fade-in Utility ---- */
    .fade-in {
      animation: fade-in 0.8s ease forwards;
    }

    /* ---- Evidence Card New Badge ---- */
    .evidence-card.new {
      border-color: #4a9eff;
    }
    .evidence-badge {
      font-size: 10px;
      font-weight: bold;
      color: #4a9eff;
      text-transform: uppercase;
    }

    /* ---- Keyframe Animations ---- */
    @keyframes pulse-text {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    @keyframes timer-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    @keyframes screen-shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-1px); }
      75% { transform: translateX(1px); }
    }

    @keyframes typing-bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-6px); }
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }

    @keyframes fade-in {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ---- Terminal Text ---- */
    .terminal-text {
      font-family: 'Courier New', monospace;
      color: #00ff88;
      line-height: 1.6;
      white-space: pre-wrap;
    }
  `;
  document.head.appendChild(style);
}
