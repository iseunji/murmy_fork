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
let devMode = false;

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
  phase1Narrative: '',     // Investigation1 narrative text for tab review
  phase2Narrative: '',     // Investigation2 narrative text for tab review
  allCollectedEvidence: [],// [{id, title, type, phase}] all cards across phases
  comboCards: [],          // [{id, title, type, content}] successfully combined cards
  unseenComboCount: 0,     // Number of new combo cards not yet viewed in combo tab
  reachedPhases: new Set(),// Phase IDs the player has entered
  completedPhases: new Set(),// Phase IDs that have been completed
  currentEvidenceId: null, // ID of the evidence currently open in modal
  currentEvidenceTitle: '', // Title of the evidence currently open in modal
  currentComboPartnerTitle: '', // Title of the partner card for combo
  isDiscussion: false,     // Whether current phase is a discussion phase
  allCharacters: [],       // All character objects for "인물 정보" tab
  phaseDuration: 0,        // Total duration (seconds) for the current phase
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

  // Screen capture protection: active on all game screens except title/lobby/waiting
  const unprotectedScreens = ['screen-title', 'screen-lobby', 'screen-waiting'];
  document.body.classList.toggle('capture-protected', !unprotectedScreens.includes(screenId));

  // Tabs should only be visible on in-game screens (not lobby/title/waiting/character-select)
  const tabScreens = ['screen-intro', 'screen-investigation', 'screen-ai-chat', 'screen-verdict', 'screen-ending'];
  if (tabScreens.includes(screenId)) {
    showGameTabs();
    updateTabStates();
  } else {
    hideGameTabs();
  }

  // Brief blackout before the new screen fades in.
  setTimeout(() => {
    const target = $(screenId);
    if (target) {
      target.classList.add('active');
      target.scrollTop = 0;
      currentScreenId = screenId;
      saveStateToSession();
    }
    // Highlight 사건 개요 tab when on screen-intro
    document.querySelectorAll('.game-tab').forEach((t) => t.classList.remove('active'));
    if (screenId === 'screen-intro') {
      const introTab = $('tab-intro');
      if (introTab) introTab.classList.add('active');
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
      phase1Narrative: state.phase1Narrative,
      phase2Narrative: state.phase2Narrative,
      allCollectedEvidence: state.allCollectedEvidence,
      comboCards: state.comboCards,
      reachedPhases: [...state.reachedPhases],
      completedPhases: [...state.completedPhases],
      allCharacters: state.allCharacters,
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
    state.phase1Narrative = data.phase1Narrative || '';
    state.phase2Narrative = data.phase2Narrative || '';
    state.allCollectedEvidence = data.allCollectedEvidence || [];
    state.comboCards = data.comboCards || [];
    state.allCharacters = data.allCharacters || [];
    if (data.reachedPhases) {
      state.reachedPhases = new Set(data.reachedPhases);
    }
    if (data.completedPhases) {
      state.completedPhases = new Set(data.completedPhases);
    }
    // Show tabs only if game is on a screen where tabs should be visible
    // (사건 개요 이후 화면에서만 탭 표시)
    const tabScreens = ['screen-intro', 'screen-investigation', 'screen-ai-chat', 'screen-verdict', 'screen-ending'];
    if (state.role && tabScreens.includes(data.currentScreenId)) {
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

    // Highlight 사건 개요 tab when restoring to screen-intro
    if (data.currentScreenId === 'screen-intro') {
      document.querySelectorAll('.game-tab').forEach((t) => t.classList.remove('active'));
      const introTab = $('tab-intro');
      if (introTab) introTab.classList.add('active');
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
  const { dangerPhrases = [] } = opts;

  element.innerHTML = '';

  // If text contains dialogue lines, show a reading guide at the top
  if (/^.{1,5}:\s*"/m.test(text)) {
    const guide = document.createElement('p');
    guide.className = 'dialogue-guide';
    guide.textContent = '파란색 대사는 각자 역할을 맡은 사람이 소리내어 읽어주세요.';
    element.appendChild(guide);
  }

  // Filter out ---RED---/---WHITE--- markers and track zone boundaries
  const rawParagraphs = text.split('\n\n');
  const paragraphs = [];
  let redStartIndex = -1;
  let whiteStartIndex = -1;
  for (let i = 0; i < rawParagraphs.length; i++) {
    if (rawParagraphs[i].trim() === '---RED---') {
      redStartIndex = paragraphs.length;
    } else if (rawParagraphs[i].trim() === '---WHITE---') {
      whiteStartIndex = paragraphs.length;
    } else {
      paragraphs.push(rawParagraphs[i]);
    }
  }

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const p = document.createElement('p');
    p.className = 'stream-paragraph';
    element.appendChild(p);

    // Apply red styling for paragraphs after ---RED--- but before ---WHITE---
    if (redStartIndex >= 0 && pi >= redStartIndex && (whiteStartIndex < 0 || pi < whiteStartIndex)) {
      p.classList.add('text-danger');
    }

    // ※ notice paragraphs get yellow highlight
    if (paragraphs[pi].startsWith('※')) {
      p.classList.add('text-notice');
    }

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

    // Split paragraph into lines (single \n)
    const lines = paragraphs[pi].split('\n');

    for (let li = 0; li < lines.length; li++) {
      if (li > 0) p.appendChild(document.createElement('br'));

      // Split line into segments: reading guides, <<condition>> highlights, and [section headers]
      const segments = lines[li].split(/(\([^)]*읽어주세요\)|<<.+?>>|\[[^\]]+\])/);
      for (const seg of segments) {
        if (/^\([^)]*읽어주세요\)$/.test(seg)) {
          const span = document.createElement('span');
          span.className = 'text-reading-guide';
          span.textContent = seg;
          p.appendChild(span);
        } else if (/^<<.+>>$/.test(seg)) {
          const span = document.createElement('span');
          span.className = 'text-highlight-condition';
          span.textContent = seg.slice(2, -2);
          p.appendChild(span);
        } else if (/^\[.+\]$/.test(seg)) {
          const span = document.createElement('span');
          span.className = 'text-section-header';
          span.textContent = seg;
          p.appendChild(span);
        } else {
          p.appendChild(document.createTextNode(seg));
        }
      }
    }
  }

  // Fade in the entire element
  element.classList.add('fade-in-text');
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
/**
 * Show a center-screen announcement overlay that auto-dismisses.
 */
function showCenterAnnouncement(title, subtitle, onDismiss, duration = 2000) {
  const overlay = document.createElement('div');
  overlay.className = 'center-announcement';
  overlay.innerHTML =
    '<div class="center-announcement-box">' +
      '<h3 class="center-announcement-title">' + title + '</h3>' +
      (subtitle ? '<p class="center-announcement-sub">' + subtitle + '</p>' : '') +
    '</div>';
  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay.classList.add('visible'));

  setTimeout(() => {
    overlay.classList.remove('visible');
    setTimeout(() => {
      overlay.remove();
      if (onDismiss) onDismiss();
    }, 400);
  }, duration);
}

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
  const total = state.phaseDuration ? ` / ${formatTime(state.phaseDuration)}` : '';

  const phaseTimer = $('phase-timer');
  const aiTimer = $('ai-chat-timer');
  const verdictTimer = $('verdict-timer');

  [phaseTimer, aiTimer, verdictTimer].forEach((el) => {
    if (el) {
      el.textContent = formatted + total;
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

    // Add trade/donate tag if present.
    if (ev.tag) {
      const tag = document.createElement('span');
      tag.className = 'evidence-tag';
      tag.textContent = ev.tag;
      card.appendChild(tag);
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

  // Request evidence detail from server (modal opens when response arrives).
  socket.emit('request-evidence', { evidenceId });

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
  resetImageZoom();
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
 * @param {Array<{id: string, title: string, type: string}>} collectedList - Full evidence objects.
 */
function renderCollectedEvidence(collectedList) {
  const grid = $('evidence-grid');
  const turnIndicator = $('evidence-turn-indicator');
  const heading = $('evidence-heading');

  if (turnIndicator) turnIndicator.hidden = true;
  if (heading) heading.textContent = '수집된 증거';
  if (!grid) return;

  grid.innerHTML = '';
  grid.classList.remove('disabled');

  collectedList.forEach((ev) => {
    const card = document.createElement('div');
    card.className = 'evidence-card collected';
    card.dataset.id = ev.id;

    const icon = document.createElement('span');
    icon.className = 'evidence-icon';
    icon.textContent = EVIDENCE_ICONS[ev.type] || DEFAULT_EVIDENCE_ICON;

    const title = document.createElement('span');
    title.className = 'evidence-title';
    title.textContent = ev.title;

    card.appendChild(icon);
    card.appendChild(title);

    if (ev.tag) {
      const tag = document.createElement('span');
      tag.className = 'evidence-tag';
      tag.textContent = ev.tag;
      card.appendChild(tag);
    }

    card.addEventListener('click', () => {
      openEvidenceModal(ev.id);
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

  content.textContent = text;
  if (useTypewriter) {
    content.classList.add('fade-in-text');
  }
  bubble.appendChild(content);
  container.appendChild(bubble);

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
 * Flow: Title → Narrative → Truth Reveal (사건의 전말) → Epilogue → Restart
 *
 * @param {{endingType: string, title: string, subtitle: string, narrative: string[], truthReveal: string[], epilogue: string}} data
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

  // --- Subtitle ---
  const subtitleEl = $('ending-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = data.subtitle || '';
  }

  await sleep(1500);

  // --- Narrative paragraphs (all at once, fade in) ---
  const narrativeContainer = $('ending-narrative');
  if (narrativeContainer) {
    narrativeContainer.innerHTML = '';

    for (const paragraph of (data.narrative || [])) {
      const p = document.createElement('p');
      p.className = 'ending-paragraph visible';

      // [읽어주세요] guide lines → blue
      if (/^\[.*읽어주세요.*\]$/.test(paragraph)) {
        p.classList.add('ending-reading-guide');
        p.textContent = paragraph;
      // Lines containing "dialogue" → highlight quoted parts in blue
      } else if (/\u201c.*\u201d/.test(paragraph) || /".+?"/.test(paragraph)) {
        // Split on "..." or \u201c...\u201d patterns
        const parts = paragraph.split(/(\u201c[^\u201d]*\u201d|"[^"]*?")/);
        for (const part of parts) {
          if (/^\u201c[^\u201d]*\u201d$/.test(part) || /^"[^"]*?"$/.test(part)) {
            const span = document.createElement('span');
            span.className = 'ending-dialogue';
            span.textContent = part;
            p.appendChild(span);
          } else {
            p.appendChild(document.createTextNode(part));
          }
        }
      } else {
        p.textContent = paragraph;
      }

      narrativeContainer.appendChild(p);
    }
    narrativeContainer.classList.add('fade-in-text');
  }

  await sleep(2000);

  // --- Truth Reveal (사건의 전말) ---
  const truthRevealWrapper = $('truth-reveal');
  const truthRevealInner = $('truth-reveal-inner');
  if (truthRevealWrapper && truthRevealInner && data.truthReveal && data.truthReveal.length > 0) {
    truthRevealInner.innerHTML = '';

    for (const paragraph of data.truthReveal) {
      const p = document.createElement('p');
      // Apply special styling for header lines (━━ ... ━━)
      if (paragraph.startsWith('\u2501\u2501')) {
        if (paragraph.includes('\uACB0\uB860')) {
          p.className = 'truth-conclusion-header';
        } else {
          p.className = 'truth-header';
        }
      } else if (data.truthReveal.indexOf(paragraph) === data.truthReveal.length - 1) {
        // Last paragraph is the conclusion text
        p.className = 'truth-conclusion';
      }
      p.textContent = paragraph;
      truthRevealInner.appendChild(p);
    }

    truthRevealWrapper.classList.add('visible');
    await sleep(2000);
  }

  await sleep(1500);

  // --- Epilogue (terminal-style typewriter) ---
  const epilogueWrapper = $('ending-epilogue');
  const epilogueBody = $('epilogue-terminal-body');
  if (epilogueWrapper && epilogueBody && data.epilogue) {
    epilogueWrapper.classList.add('visible');
    epilogueBody.innerHTML = '';
    await sleep(500);
    epilogueBody.classList.add('terminal-text');
    epilogueBody.textContent = data.epilogue;
    epilogueBody.classList.add('fade-in-text');
  }

  // --- Result Summary ---
  const summaryEl = $('result-summary');
  if (summaryEl && data.resultSummary && data.resultSummary.length > 0) {
    summaryEl.innerHTML = '';
    for (let i = 0; i < data.resultSummary.length; i++) {
      const p = document.createElement('p');
      p.textContent = data.resultSummary[i];
      // Last line is the winner announcement
      if (i === data.resultSummary.length - 1) {
        p.className = 'result-winner';
      }
      summaryEl.appendChild(p);
    }
    await sleep(1500);
    summaryEl.classList.add('visible');
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

/**
 * Scroll the narrative panel down by roughly one visible page.
 */
function scrollNarrativeDown() {
  const narrative = $('phase-narrative');
  if (!narrative) return;
  narrative.scrollBy({ top: narrative.clientHeight * 0.85, behavior: 'smooth' });
}

/**
 * Update the scroll-down indicator: pulse when more content is below,
 * hide when fully scrolled.
 */
function updateNarrativeScrollHint() {
  const narrative = $('phase-narrative');
  const btn = $('btn-toggle-narrative');
  if (!narrative || !btn) return;
  const hasMore = narrative.scrollHeight - narrative.scrollTop - narrative.clientHeight > 5;
  btn.classList.toggle('has-more', hasMore);
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
  const soundBar = $('game-sound-bar');
  if (soundBar) soundBar.hidden = false;
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
  const soundBar = $('game-sound-bar');
  if (soundBar) soundBar.hidden = true;
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

  // Phase 1 tab — enabled only after investigation1 has been completed
  if (tabPhase1) {
    tabPhase1.disabled = !state.completedPhases.has('investigation1');
  }

  // Phase 2 tab — enabled only after investigation2 has been completed
  if (tabPhase2) {
    tabPhase2.disabled = !state.completedPhases.has('investigation2');
  }

  // Combo tab — enabled once at least one combo card exists
  if (tabCombo) {
    tabCombo.disabled = state.comboCards.length === 0;
  }
}

/**
 * Update the red badge on the combo tab showing unseen combo card count.
 */
function updateComboBadge() {
  const badge = $('combo-badge');
  if (!badge) return;
  if (state.unseenComboCount > 0) {
    badge.textContent = state.unseenComboCount;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

/** Screen ID that was active before opening a tab page. */
let _previousScreenId = null;

/**
 * Open a tab panel as a full-screen page.
 * @param {'intro'|'characters'|'phase1'|'phase2'|'combo'} tabId
 */
function openTabPanel(tabId) {
  // 'intro' tab maps directly to screen-intro
  if (tabId === 'intro') {
    if (currentScreenId === 'screen-intro') return; // already there
    // Remember the real game screen (not another tab) so we can return to it
    if (!_previousScreenId) {
      _previousScreenId = currentScreenId;
    }
    const allScreens = document.querySelectorAll('.screen');
    allScreens.forEach((s) => s.classList.remove('active'));
    const introScreen = $('screen-intro');
    if (introScreen) {
      introScreen.classList.add('active');
      introScreen.scrollTop = 0;
    }
    currentScreenId = 'screen-intro';
    // Show back button and hide the ready bar (reviewing from tab)
    const backBtn = $('btn-intro-back');
    if (backBtn) backBtn.hidden = false;
    const readyBar = document.querySelector('.intro-ready-bar');
    if (readyBar) readyBar.hidden = true;
    // Highlight active tab
    document.querySelectorAll('.game-tab').forEach((t) => t.classList.remove('active'));
    const introTab = $('tab-intro');
    if (introTab) introTab.classList.add('active');
    return;
  }

  const title = $('tab-panel-title');
  const body = $('tab-panel-body');
  if (!title || !body) return;

  body.innerHTML = '';

  switch (tabId) {
    case 'characters':
      title.textContent = '인물/목표';
      renderCharacterInfoTab(body);
      break;
    case 'phase1':
      title.textContent = '조사 단계 1';
      renderEvidenceTabContent(body, state.phase1Evidence, state.phase1Narrative);
      break;
    case 'phase2':
      title.textContent = '조사 단계 2';
      renderEvidenceTabContent(body, state.phase2Evidence, state.phase2Narrative);
      break;
    case 'combo':
      title.textContent = '조합 카드';
      renderComboTabContent(body);
      // Clear unseen badge when viewing combo tab
      state.unseenComboCount = 0;
      updateComboBadge();
      break;
    default:
      return;
  }

  // Remember the real game screen (not another tab) so we can return to it
  if (!_previousScreenId) {
    _previousScreenId = currentScreenId;
  }

  // Show the tab panel as a full-screen page
  const allScreens = document.querySelectorAll('.screen');
  allScreens.forEach((s) => s.classList.remove('active'));
  const tabScreen = $('tab-panel-screen');
  if (tabScreen) {
    tabScreen.classList.add('active');
    tabScreen.scrollTop = 0;
  }
  currentScreenId = 'tab-panel-screen';

  // Highlight active tab
  document.querySelectorAll('.game-tab').forEach((t) => t.classList.remove('active'));
  const activeTab = document.querySelector(`.game-tab[data-tab="${tabId}"]`);
  if (activeTab) activeTab.classList.add('active');
}

/**
 * Close the tab panel page and return to the previous screen.
 */
function closeTabPanel() {
  const tabScreen = $('tab-panel-screen');
  if (tabScreen) tabScreen.classList.remove('active');

  // Restore the previous screen
  if (_previousScreenId) {
    const prev = $(_previousScreenId);
    if (prev) prev.classList.add('active');
    currentScreenId = _previousScreenId;
  }
  _previousScreenId = null;

  document.querySelectorAll('.game-tab').forEach((t) => t.classList.remove('active'));
}

/**
 * Append text to a parent element, parsing <<...>> markers into highlighted spans.
 */
/* ==========================================================================
   EVIDENCE IMAGE ZOOM & PAN
   ========================================================================== */

const imageZoom = { scale: 1, x: 0, y: 0, minScale: 1, maxScale: 4 };
let _zoomHintShown = false;

function resetImageZoom() {
  imageZoom.scale = 1;
  imageZoom.x = 0;
  imageZoom.y = 0;
  const img = $('evidence-modal-image');
  if (img) {
    img.style.transform = 'none';
    img.style.transition = 'transform 0.15s ease';
  }
  const wrap = $('evidence-modal-image-wrap');
  if (wrap) wrap.classList.remove('is-dragging');
}

function applyImageZoom(animate) {
  const img = $('evidence-modal-image');
  if (!img) return;
  img.style.transition = animate ? 'transform 0.15s ease' : 'none';
  if (imageZoom.scale <= 1) {
    imageZoom.x = 0;
    imageZoom.y = 0;
    img.style.transform = 'none';
  } else {
    clampPan();
    img.style.transform = `translate(${imageZoom.x}px, ${imageZoom.y}px) scale(${imageZoom.scale})`;
  }
}

function clampPan() {
  const wrap = $('evidence-modal-image-wrap');
  if (!wrap) return;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  const maxX = (imageZoom.scale - 1) * w;
  const maxY = (imageZoom.scale - 1) * h;
  imageZoom.x = Math.max(-maxX, Math.min(0, imageZoom.x));
  imageZoom.y = Math.max(-maxY, Math.min(0, imageZoom.y));
}

function zoomAt(delta, cx, cy) {
  const wrap = $('evidence-modal-image-wrap');
  if (!wrap) return;
  const prev = imageZoom.scale;
  imageZoom.scale = Math.max(imageZoom.minScale, Math.min(imageZoom.maxScale, prev + delta));
  if (imageZoom.scale === prev) return;
  // Adjust pan so the zoom centers on (cx, cy) within the wrap
  const ratio = imageZoom.scale / prev;
  imageZoom.x = cx - ratio * (cx - imageZoom.x);
  imageZoom.y = cy - ratio * (cy - imageZoom.y);
  applyImageZoom(false);
}

function showZoomHint() {
  if (_zoomHintShown) return;
  _zoomHintShown = true;
  const hint = $('image-zoom-hint');
  if (!hint) return;
  hint.classList.add('visible');
  setTimeout(() => hint.classList.remove('visible'), 2500);
}

function initImageZoom() {
  const wrap = $('evidence-modal-image-wrap');
  if (!wrap || wrap._zoomInit) return;
  wrap._zoomInit = true;

  // --- Pinch to zoom (touch) ---
  let touches0 = null;
  let startDist = 0;
  let startScale = 1;
  let panStartX = 0, panStartY = 0, panStartTx = 0, panStartTy = 0;
  let isPinching = false;

  wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      isPinching = true;
      touches0 = Array.from(e.touches);
      startDist = Math.hypot(
        touches0[1].clientX - touches0[0].clientX,
        touches0[1].clientY - touches0[0].clientY
      );
      startScale = imageZoom.scale;
      e.preventDefault();
    } else if (e.touches.length === 1 && imageZoom.scale > 1) {
      isPinching = false;
      panStartX = e.touches[0].clientX;
      panStartY = e.touches[0].clientY;
      panStartTx = imageZoom.x;
      panStartTy = imageZoom.y;
      wrap.classList.add('is-dragging');
      e.preventDefault();
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && touches0) {
      const dist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      const rect = wrap.getBoundingClientRect();
      const cx = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
      const cy = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
      const newScale = Math.max(imageZoom.minScale, Math.min(imageZoom.maxScale, startScale * (dist / startDist)));
      const ratio = newScale / imageZoom.scale;
      imageZoom.scale = newScale;
      imageZoom.x = cx - ratio * (cx - imageZoom.x);
      imageZoom.y = cy - ratio * (cy - imageZoom.y);
      applyImageZoom(false);
      e.preventDefault();
    } else if (e.touches.length === 1 && imageZoom.scale > 1 && !isPinching) {
      imageZoom.x = panStartTx + (e.touches[0].clientX - panStartX);
      imageZoom.y = panStartTy + (e.touches[0].clientY - panStartY);
      applyImageZoom(false);
      e.preventDefault();
    }
  }, { passive: false });

  wrap.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      touches0 = null;
      isPinching = false;
    }
    wrap.classList.remove('is-dragging');
  });

  // --- Mouse wheel zoom ---
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? -0.3 : 0.3;
    zoomAt(delta, cx, cy);
  }, { passive: false });

  // --- Mouse drag to pan ---
  let mouseDown = false, msx = 0, msy = 0, mstx = 0, msty = 0;

  wrap.addEventListener('mousedown', (e) => {
    if (imageZoom.scale <= 1) return;
    mouseDown = true;
    msx = e.clientX;
    msy = e.clientY;
    mstx = imageZoom.x;
    msty = imageZoom.y;
    wrap.classList.add('is-dragging');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!mouseDown) return;
    imageZoom.x = mstx + (e.clientX - msx);
    imageZoom.y = msty + (e.clientY - msy);
    applyImageZoom(false);
  });

  window.addEventListener('mouseup', () => {
    mouseDown = false;
    wrap.classList.remove('is-dragging');
  });

  // --- Zoom buttons ---
  const btnIn = $('btn-zoom-in');
  const btnOut = $('btn-zoom-out');
  if (btnIn) {
    btnIn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = wrap.getBoundingClientRect();
      zoomAt(0.5, rect.width / 2, rect.height / 2);
    });
  }
  if (btnOut) {
    btnOut.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = wrap.getBoundingClientRect();
      zoomAt(-0.5, rect.width / 2, rect.height / 2);
    });
  }
}

/**
 * Render evidence content into an element, highlighting time entries in amber.
 */
function renderEvidenceContent(el, text) {
  el.innerHTML = '';
  // First split by <<...>> markers for amber-highlighted blocks
  const blocks = text.split(/(<<[\s\S]+?>>)/g);
  for (const block of blocks) {
    if (/^<<[\s\S]+>>$/.test(block)) {
      const span = document.createElement('span');
      span.style.color = 'var(--accent-amber)';
      span.textContent = block.slice(2, -2);
      el.appendChild(span);
    } else {
      // Within normal blocks, highlight HH:MM time entries
      const parts = block.split(/(\d{2}:\d{2}\s+[^\s/]+(?:\([^)]*\))?)/g);
      for (const part of parts) {
        if (/^\d{2}:\d{2}\s+/.test(part)) {
          const span = document.createElement('span');
          span.style.color = 'var(--accent-amber)';
          span.textContent = part;
          el.appendChild(span);
        } else {
          el.appendChild(document.createTextNode(part));
        }
      }
    }
  }
}

function appendHighlightedText(parent, text) {
  const parts = text.split(/(<<.+?>>)/);
  for (const part of parts) {
    if (/^<<.+>>$/.test(part)) {
      const span = document.createElement('span');
      span.className = 'text-highlight-condition';
      span.textContent = part.slice(2, -2);
      parent.appendChild(span);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  }
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
    briefingLabel.textContent = '당신의 비밀' + charSuffix();
    briefingLabel.style.color = 'var(--accent-red)';
    briefingLabel.style.marginBottom = '8px';
    briefingLabel.style.fontFamily = 'var(--font-display)';
    briefingLabel.style.fontSize = '18px';
    container.appendChild(briefingLabel);

    const briefingDiv = document.createElement('div');
    briefingDiv.className = 'tab-panel-narrative';
    // Support ---RED--- and ---WHITE--- markers for colored sections
    const briefingSections = state.briefingText.split('\n\n---RED---\n\n');
    if (briefingSections.length > 1) {
      const normalSpan = document.createElement('span');
      appendHighlightedText(normalSpan, briefingSections[0]);
      briefingDiv.appendChild(normalSpan);

      const afterRed = briefingSections.slice(1).join('\n\n');
      const whiteSections = afterRed.split('\n\n---WHITE---\n\n');

      const redSpan = document.createElement('span');
      redSpan.style.color = 'var(--accent-red)';
      appendHighlightedText(redSpan, '\n\n' + whiteSections[0]);
      briefingDiv.appendChild(redSpan);

      if (whiteSections.length > 1) {
        const whiteSpan = document.createElement('span');
        appendHighlightedText(whiteSpan, '\n\n' + whiteSections.slice(1).join('\n\n'));
        briefingDiv.appendChild(whiteSpan);
      }
    } else {
      appendHighlightedText(briefingDiv, state.briefingText);
    }
    container.appendChild(briefingDiv);
  }
}

/**
 * Render character info tab showing both characters with photos and details.
 */
function renderCharacterInfoTab(container) {
  if (!state.allCharacters || state.allCharacters.length === 0) {
    container.innerHTML = '<p class="tab-panel-empty">캐릭터 정보를 불러올 수 없습니다.</p>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'character-info-grid';

  const sorted = [...state.allCharacters].sort((a, b) => {
    const aIsNpc = a.selectable === false;
    const bIsNpc = b.selectable === false;
    const aIsMe = state.character && state.character.id === a.id;
    const bIsMe = state.character && state.character.id === b.id;
    if (aIsNpc !== bIsNpc) return aIsNpc ? -1 : 1;
    if (aIsMe !== bIsMe) return aIsMe ? -1 : 1;
    return 0;
  });

  for (const char of sorted) {
    const isMe = state.character && state.character.id === char.id;
    const isNpc = char.selectable === false;
    const card = document.createElement('div');
    card.className = 'character-info-card' + (isMe ? ' is-me' : '') + (isNpc ? ' is-npc' : '');

    const badge = isMe ? '<span class="character-badge">나</span>' : (isNpc ? '<span class="character-npc-label">피해자·선택불가</span>' : '');
    const row = document.createElement('div');
    row.className = 'character-info-row';
    row.innerHTML =
      '<div class="character-info-portrait">' +
        '<img src="/assets/' + char.id + '.png?v=2" alt="' + char.name + '" />' +
      '</div>' +
      '<div class="character-info-details">' +
        '<h3 class="character-info-name">' + char.name + badge + '</h3>' +
        '<span class="character-info-age">' + char.age + '세, ' + (char.gender || '') + '</span>' +
        '<p class="character-info-desc">' + char.desc + '</p>' +
      '</div>';
    card.appendChild(row);

    // Append goals inside the player's own character card
    if (isMe && state.briefingText) {
      const goalMatch = state.briefingText.match(/🎯 당신의 목표\n\n([\s\S]*?)$/);
      if (goalMatch) {
        const divider = document.createElement('hr');
        divider.className = 'character-goals-divider';
        card.appendChild(divider);

        const goalsTitle = document.createElement('h4');
        goalsTitle.className = 'character-goals-title';
        goalsTitle.textContent = '🎯 나의 목표';
        card.appendChild(goalsTitle);

        const lines = goalMatch[1].split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          const p = document.createElement('p');
          p.className = 'character-goal-item';
          appendHighlightedText(p, line);
          card.appendChild(p);
        }
      }
    }

    grid.appendChild(card);
  }

  container.appendChild(grid);
}

/**
 * Render evidence cards for a tab panel (phase 1, phase 2).
 */
function renderEvidenceTabContent(container, evidenceList, narrativeText) {
  // Show narrative text above evidence cards if available
  if (narrativeText) {
    const narrativeDiv = document.createElement('div');
    narrativeDiv.className = 'tab-panel-narrative';
    // Render with [section header] highlighting
    const parts = narrativeText.split(/(\[[^\]]+\])/);
    for (const part of parts) {
      if (/^\[.+\]$/.test(part)) {
        const span = document.createElement('span');
        span.className = 'text-section-header';
        span.textContent = part;
        narrativeDiv.appendChild(span);
      } else {
        narrativeDiv.appendChild(document.createTextNode(part));
      }
    }
    container.appendChild(narrativeDiv);

    const separator = document.createElement('hr');
    separator.style.borderColor = 'var(--border)';
    separator.style.margin = '20px 0';
    container.appendChild(separator);
  }

  if (!evidenceList || evidenceList.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'tab-panel-empty';
    emptyMsg.textContent = '수집된 증거가 없습니다.';
    container.appendChild(emptyMsg);
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
    typeEl.textContent = `조합카드(추가증거 ${data.comboIndex || ''})`;
  }
  if (contentEl) renderEvidenceContent(contentEl, data.content || '');

  // Show combo card image if available
  const imgWrap = $('combo-modal-image-wrap');
  const imgEl = $('combo-modal-image');
  if (imgWrap && imgEl && data.image) {
    imgEl.src = `/assets/evidence/${data.image}`;
    imgWrap.hidden = false;
  } else if (imgWrap) {
    imgWrap.hidden = true;
  }

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

  // Show message and change button to "시작" when partner is ready
  const waitingStatus = $('waiting-status');
  if (waitingStatus) {
    waitingStatus.textContent = '상대방이 준비를 완료했습니다. 시작을 눌러주세요!';
  }
  const btnReady = $('btn-ready');
  if (btnReady && !btnReady.disabled) {
    btnReady.textContent = '시작';
  }
});

socket.on('phase-ready-count', (data) => {
  // Update ready count display on all screens.
  const introReadyCount = $('intro-ready-count');
  const phaseReadyCount = $('phase-ready-count');
  const aiReadyCount = $('ai-ready-count');
  if (introReadyCount) introReadyCount.textContent = `${data.count}/2`;
  if (phaseReadyCount) phaseReadyCount.textContent = `${data.count}/2`;
  if (aiReadyCount) aiReadyCount.textContent = `${data.count}/2`;

  // If the other player is ready and I'm not, change my button to "넘어가기".
  if (data.count >= 1 && !state.isReady) {
    const btnIntro = $('btn-intro-next');
    const btnPhase = $('btn-phase-ready');
    const btnAi = $('btn-ai-ready');
    if (btnIntro && !btnIntro.disabled) btnIntro.textContent = '넘어가기';
    if (btnPhase && !btnPhase.disabled) btnPhase.textContent = '넘어가기';
    if (btnAi && !btnAi.disabled) btnAi.textContent = '넘어가기';
  }
});

// ---- Character Selection ----

// Pencil-sketch-style character silhouettes.
// Uses an SVG turbulence filter for hand-drawn line wobble.
const SKETCH_FILTER = '<defs><filter id="pencil"><feTurbulence type="turbulence" baseFrequency="0.04" numOctaves="4" result="noise" seed="2"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" xChannelSelector="R" yChannelSelector="G"/></filter></defs>';
const SK = 'filter="url(#pencil)"'; // shorthand

const CHARACTER_SILHOUETTES = {
  hajin: '<img src="/assets/hajin.png?v=2" alt="서하진" />',
  dohyun: '<img src="/assets/dohyun.png?v=2" alt="이도현" />',
  professor: '<img src="/assets/professor.png?v=2" alt="황준석" />',
};

function renderCharacterCards(characters) {
  const container = $('character-cards');
  if (!container) return;
  container.innerHTML = '';

  for (const char of characters) {
    const isNpc = char.selectable === false;
    const card = document.createElement(isNpc ? 'div' : 'button');
    card.className = 'character-card' + (isNpc ? ' npc' : '');
    card.dataset.characterId = char.id;
    card.innerHTML =
      '<div class="character-silhouette">' + (CHARACTER_SILHOUETTES[char.id] || '') + '</div>' +
      '<div class="character-info">' +
        '<h3 class="character-name">' + char.name + (isNpc ? '<span class="character-npc-label">피해자·선택불가</span>' : '') + '</h3>' +
        '<span class="character-age">' + char.age + '\uC138, ' + (char.gender || '') + '</span>' +
        '<p class="character-desc">' + char.desc + '</p>' +
      '</div>';
    if (!isNpc) {
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
        container.querySelectorAll('.character-card:not(.npc)').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        socket.emit('select-character', { characterId: char.id });
      });
    }
    container.appendChild(card);
  }
}

socket.on('show-character-select', (data) => {
  showScreen('screen-character-select');
  state.allCharacters = data.characters || [];
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

  // Reset ready state for intro screen.
  state.isReady = false;
  const introReadyBtn = $('btn-intro-next');
  if (introReadyBtn) {
    introReadyBtn.disabled = false;
    introReadyBtn.classList.remove('active');
    introReadyBtn.textContent = '다음으로 넘어가기';
  }
  const introReadyCount = $('intro-ready-count');
  if (introReadyCount) introReadyCount.textContent = '0/2';

  // Show the intro screen with role and briefing.
  showScreen('screen-intro');

  // Show game tabs AFTER screen transition completes (300ms)
  // to prevent tabs from flashing on the previous screen
  setTimeout(() => {
    showGameTabs();
    updateTabStates();
  }, 300);

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

  // Fade-in for general narrative intro (use prologue from server).
  const narrativeEl = $('intro-narrative');
  const introText = data.prologueNarrative || '';

  // Save intro text for tab access
  state.introNarrative = introText;
  state.briefingText = data.briefing || '';

  if (narrativeEl) {
    await streamText(narrativeEl, introText);

    // Red notice between prologue and briefing
    const notice = document.createElement('p');
    notice.className = 'intro-private-notice';
    notice.textContent = '※ 여기서부터는 각 플레이어별 숙지해야하는 정보입니다. 상대 플레이어에게 공유하지 않고 혼자 읽어주세요. 권장 시간은 15분 정도이나, 서로의 협의를 통해 조정할 수 있습니다. 두 플레이어 모두 숙지가 완료되면 넘어가주세요.';
    narrativeEl.appendChild(notice);
  }

  // Show the secret briefing.
  const briefingEl = $('intro-briefing');
  const briefingContent = $('briefing-content');
  if (briefingEl && briefingContent && data.briefing) {
    briefingEl.style.display = 'block';
    briefingEl.classList.add('visible');
    await streamText(briefingContent, data.briefing, {
      dangerPhrases: ['당신은 범인입니다.', '당신은 직접적인 범인은 아닙니다.'],
    });
  }
});

// ---- Phase Data (Investigation) ----

socket.on('phase-data', async (data) => {
  // Mark the previous phase as completed before switching.
  if (state.currentPhase) {
    state.completedPhases.add(state.currentPhase);
  }
  state.currentPhase = data.phaseId;
  state.isReady = false;
  state.isDiscussion = data.isDiscussion || false;
  state.phaseDuration = data.duration || 0;
  state.reachedPhases.add(data.phaseId);
  saveStateToSession();

  // Update tab states based on game progress
  updateTabStates();

  // Determine which screen to show based on the phase.
  const isAiPhase = data.phaseId === 'aria';
  const isVerdictPhase = data.phaseId === 'accusation';

  if (isVerdictPhase) {
    showScreen('screen-verdict');
    const verdictTitle = document.querySelector('.verdict-title');
    if (verdictTitle) verdictTitle.textContent = `최종 판결${charSuffix()}`;

    // Hide all sub-phases initially
    hideAll('verdict-action-phase', 'verdict-action-waiting', 'verdict-vote-phase', 'verdict-vote-waiting');

    state.hasAccused = false;
    state.hasActed = false;

    // Start action phase based on role
    const info = data.actionPhaseInfo;
    if (info && info.yourTurn) {
      // Innocent (도현): show action choices
      showActionPhaseForInnocent(info.canConfiscate);
    } else {
      // Culprit (하진): wait for innocent's action
      showEl('verdict-action-waiting');
      const waitText = $('action-waiting-text');
      if (waitText) waitText.textContent = '상대방의 행동을 기다리는 중...';
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
      aiReadyBtn.textContent = '대화 종료 & 준비';
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
    if (subtitleEl) {
      subtitleEl.textContent = data.subtitle || '';
      const isInvestigation = data.phaseId && data.phaseId.startsWith('investigation');
      subtitleEl.classList.toggle('warning', isInvestigation);
    }

    // Save narrative for tab review
    if (data.phaseId === 'investigation1') {
      state.phase1Narrative = data.narrative || '';
    } else if (data.phaseId === 'investigation2') {
      state.phase2Narrative = data.narrative || '';
    }
    saveStateToSession();

    // Phase narrative with LLM-style streaming.
    const narrativeEl = $('phase-narrative');
    const narrativeSection = $('narrative-section');
    if (narrativeEl && data.narrative) {
      narrativeEl.scrollTop = 0;
      if (narrativeSection) narrativeSection.hidden = false;
      await streamText(narrativeEl, data.narrative);
      updateNarrativeScrollHint();
    } else {
      // No narrative for this phase – hide the box entirely
      if (narrativeEl) narrativeEl.textContent = '';
      if (narrativeSection) narrativeSection.hidden = true;
    }

    // Show turn order guidance below evidence heading
    const turnGuidance = $('evidence-turn-guidance');
    if (turnGuidance) {
      if (data.turnOrderGuidance) {
        turnGuidance.textContent = data.turnOrderGuidance;
        turnGuidance.hidden = false;
      } else {
        turnGuidance.textContent = '';
        turnGuidance.hidden = true;
      }
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

    // Show ready button in investigation and discussion phases (not accusation).
    const hasReadyBtn = data.phaseId !== 'accusation';
    const readyBtn = $('btn-phase-ready');
    const readyCount = $('phase-ready-count');
    if (readyBtn) {
      readyBtn.hidden = !hasReadyBtn;
      // In investigation phases, disable until all evidence is collected
      const isInvestigation = data.phaseId === 'investigation1' || data.phaseId === 'investigation2';
      readyBtn.disabled = isInvestigation;
      readyBtn.classList.remove('active');
      readyBtn.textContent = '다음으로 넘어가기';
    }
    if (readyCount) {
      readyCount.hidden = !hasReadyBtn;
      readyCount.textContent = '0/2';
    }

    // Update phase progress dots.
    updatePhaseProgress(data.phaseId);
  }
});

// ---- Evidence Detail ----

socket.on('evidence-detail', (data) => {
  const modal = $('evidence-modal');
  const titleEl = $('evidence-modal-title');
  const typeEl = $('evidence-modal-type');
  const contentEl = $('evidence-modal-content');

  state.currentEvidenceId = data.id;
  state.currentEvidenceTitle = data.title || '';
  state.currentComboPartnerTitle = data.comboPartnerTitle || '';

  // Populate content first, then show modal so it appears fully loaded.
  if (titleEl) titleEl.textContent = data.title || '';
  if (typeEl) {
    typeEl.textContent = data.isComboCard ? `조합카드(추가증거 ${data.comboIndex || ''})` : '증거카드';
  }
  if (contentEl) renderEvidenceContent(contentEl, data.content || '');

  if (modal) {
    modal.removeAttribute('hidden');
    modal.classList.add('active');
  }
  SFX.reveal();

  // Show evidence image if available
  const imgWrap2 = $('evidence-modal-image-wrap');
  const imgEl2 = $('evidence-modal-image');
  if (imgWrap2 && imgEl2 && data.image) {
    imgEl2.src = `/assets/evidence/${data.image}`;
    imgEl2.alt = data.title || '';
    imgWrap2.hidden = false;
    resetImageZoom();
    initImageZoom();
    showZoomHint();
  } else if (imgWrap2) {
    imgWrap2.hidden = true;
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

  // Check if body content overflows; only show scroll gradient when needed.
  const bodyWrap = $('evidence-modal-body-wrap');
  const bodyEl = $('evidence-modal-content');
  if (bodyWrap && bodyEl) {
    requestAnimationFrame(() => {
      const hasOverflow = bodyEl.scrollHeight > bodyEl.clientHeight + 5;
      bodyWrap.classList.toggle('scrolled-bottom', !hasOverflow);
    });
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
    typeEl.textContent = '증거카드';
  }
  if (contentEl) renderEvidenceContent(contentEl, data.content || '');

  // Show evidence image if available
  const imgWrap = $('evidence-modal-image-wrap');
  const imgEl = $('evidence-modal-image');
  if (imgWrap && imgEl && data.image) {
    imgEl.src = `/assets/evidence/${data.image}`;
    imgEl.alt = data.title || '';
    imgWrap.hidden = false;
    resetImageZoom();
    initImageZoom();
    showZoomHint();
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

  // Check if body content overflows; only show scroll gradient when needed.
  const bodyWrap2 = $('evidence-modal-body-wrap');
  const bodyEl2 = $('evidence-modal-content');
  if (bodyWrap2 && bodyEl2) {
    requestAnimationFrame(() => {
      const hasOverflow = bodyEl2.scrollHeight > bodyEl2.clientHeight + 5;
      bodyWrap2.classList.toggle('scrolled-bottom', !hasOverflow);
    });
  }
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

  // Show full-screen announcement before showing collected evidence
  showCenterAnnouncement('증거 수집 완료', '수집된 증거를 확인해보세요.', () => {
    renderCollectedEvidence(collectedFull);
  });

  // Enable the ready button now that all evidence is collected
  const readyBtn = $('btn-phase-ready');
  if (readyBtn && !state.isReady) {
    readyBtn.disabled = false;
  }
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

  // Update unseen combo badge
  state.unseenComboCount += 1;
  updateComboBadge();

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
    const receivedCard = { id: data.received.id, title: data.received.title, type: data.received.type, tag: '교환' };
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
    card.tag = '양도';
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

// ---- Action Phase Events ----

socket.on('action-turn', (data) => {
  // It's this player's turn to act (culprit receiving turn after innocent acted)
  hideAll('verdict-action-waiting');
  state.hasActed = false;
  showActionPhaseForCulprit(data.canEliminate);
});

socket.on('action-waiting', () => {
  // This player should wait (innocent waiting for culprit's action)
  hideAll('verdict-action-phase');
  showEl('verdict-action-waiting');
  const waitText = $('action-waiting-text');
  if (waitText) waitText.textContent = '상대방의 행동을 기다리는 중...';
});

socket.on('vote-phase-start', () => {
  // Both players enter the vote phase
  hideAll('verdict-action-phase', 'verdict-action-waiting');
  showEl('verdict-vote-phase');
});

// ---- Vote Phase Events ----

socket.on('accusation-received', (data) => {
  const waitingEl = $('verdict-vote-waiting');
  if (waitingEl && state.hasAccused) {
    waitingEl.querySelector('p').textContent = `투표 대기 중... (${data.count}/2)`;
  }
});

// ---- Game Ending ----

socket.on('game-ending', async (data) => {
  await showEnding(data);
});

// ---- Partner Away (temporary) ----

socket.on('partner-away', () => {
  showToast('상대 플레이어의 연결이 불안정합니다.', 'warning');
});

// ---- Partner Reconnected (came back from temporary disconnect) ----

socket.on('partner-reconnected', () => {
  showToast('상대 플레이어가 다시 접속했습니다.');
});

// ---- Partner Disconnected (permanent — closed tab/window) ----

socket.on('partner-disconnected', () => {
  showToast('상대 플레이어가 게임을 종료했습니다. 처음으로 돌아갑니다.', 'error');
  // Reset game and return to title screen
  setTimeout(() => {
    resetGameState();
    showScreen('screen-title');
  }, 1500);
});

// ---- Generic Error ----

socket.on('error', (data) => {
  showToast(data.message || '\uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.'); // An error occurred.
});

// ---- Connection Events ----

socket.on('disconnect', () => {
  showDisconnectOverlay();
  ambient.stop();
  state.ambientStarted = false;
  state.bgmStarted = false;
});

socket.on('connect', () => {
  hideDisconnectOverlay();

  // Dev mode에서는 소켓 재접속 무시
  if (devMode) return;

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

  const btnTabBack = $('btn-tab-back');
  if (btnTabBack) {
    btnTabBack.addEventListener('click', () => {
      SFX.click();
      closeTabPanel();
    });
  }

  // ---- Intro Back Button (when viewing intro from tab during game) ----
  const btnIntroBack = $('btn-intro-back');
  if (btnIntroBack) {
    btnIntroBack.addEventListener('click', () => {
      SFX.click();
      btnIntroBack.hidden = true;
      const readyBar = document.querySelector('.intro-ready-bar');
      if (readyBar) readyBar.hidden = false;
      // Return to the previous game screen
      const introScreen = $('screen-intro');
      if (introScreen) introScreen.classList.remove('active');
      if (_previousScreenId) {
        const prev = $(_previousScreenId);
        if (prev) prev.classList.add('active');
        currentScreenId = _previousScreenId;
      }
      _previousScreenId = null;
      document.querySelectorAll('.game-tab').forEach((t) => t.classList.remove('active'));
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

  // ---- Action Confirm Popup ----

  let pendingActionConfirm = null;

  function showActionConfirm(message, onConfirm) {
    const modal = $('action-confirm-modal');
    const msgEl = $('action-confirm-message');
    if (!modal || !msgEl) return;
    msgEl.textContent = message;
    pendingActionConfirm = onConfirm;
    modal.removeAttribute('hidden');
    modal.classList.add('active');
  }

  function closeActionConfirm() {
    const modal = $('action-confirm-modal');
    if (modal) {
      modal.setAttribute('hidden', '');
      modal.classList.remove('active');
    }
    pendingActionConfirm = null;
  }

  const btnActionConfirm = $('btn-action-confirm');
  if (btnActionConfirm) {
    btnActionConfirm.addEventListener('click', () => {
      SFX.click();
      if (pendingActionConfirm) pendingActionConfirm();
      closeActionConfirm();
    });
  }

  const btnActionCancel = $('btn-action-cancel');
  if (btnActionCancel) {
    btnActionCancel.addEventListener('click', () => {
      SFX.click();
      closeActionConfirm();
    });
  }

  const actionConfirmModal = $('action-confirm-modal');
  if (actionConfirmModal) {
    actionConfirmModal.addEventListener('click', (e) => {
      if (e.target === actionConfirmModal) closeActionConfirm();
    });
  }

  const btnDonateCard = $('btn-donate-card');
  if (btnDonateCard) {
    btnDonateCard.addEventListener('click', () => {
      if (!state.currentEvidenceId) return;
      SFX.click();
      showActionConfirm(
        `'${state.currentEvidenceTitle}' 카드를 상대에게 양도하시겠습니까?`,
        () => socket.emit('donate-card', { cardId: state.currentEvidenceId })
      );
    });
  }

  const btnExchangeCard = $('btn-exchange-card');
  if (btnExchangeCard) {
    btnExchangeCard.addEventListener('click', () => {
      if (!state.currentEvidenceId) return;
      SFX.click();
      showActionConfirm(
        `'${state.currentEvidenceTitle}' 카드를 교환 제안하시겠습니까?`,
        () => socket.emit('trade-propose', { cardId: state.currentEvidenceId })
      );
    });
  }

  const btnCombineCard = $('btn-combine-card');
  if (btnCombineCard) {
    btnCombineCard.addEventListener('click', () => {
      if (btnCombineCard.disabled) return;
      const comboId = btnCombineCard.dataset.comboId;
      if (!comboId) return;
      SFX.click();
      const partnerName = state.currentComboPartnerTitle;
      showActionConfirm(
        `'${state.currentEvidenceTitle}'과(와) '${partnerName}' 카드를 조합하시겠습니까?`,
        () => socket.emit('combine-cards', { comboId })
      );
    });
  }

  // ---- Sound Toggle ----

  const tabSoundToggle = $('tab-sound-toggle');

  function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    if (tabSoundToggle) tabSoundToggle.classList.toggle('sound-on', state.soundEnabled);

    if (state.soundEnabled) {
      if (state.ambientStarted) ambient.start();
      if (state.bgmStarted) ambient.startBGM();
    } else {
      ambient.stop();
    }
  }

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
      state.isReady = true;
      btnIntroNext.disabled = true;
      btnIntroNext.classList.add('active');
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

  // Evidence body scroll hint: hide gradient when scrolled to bottom.
  const evidenceBody = $('evidence-modal-content');
  const evidenceBodyWrap = $('evidence-modal-body-wrap');
  if (evidenceBody && evidenceBodyWrap) {
    evidenceBody.addEventListener('scroll', () => {
      const atBottom = evidenceBody.scrollHeight - evidenceBody.scrollTop - evidenceBody.clientHeight < 5;
      evidenceBodyWrap.classList.toggle('scrolled-bottom', atBottom);
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
      scrollNarrativeDown();
    });
  }

  const narrativeEl = $('phase-narrative');
  if (narrativeEl) {
    narrativeEl.addEventListener('scroll', () => {
      updateNarrativeScrollHint();
    }, { passive: true });
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
      state.isReady = true;
      btnAiReady.disabled = true;
      btnAiReady.classList.add('active');
      socket.emit('phase-ready', {});
    });
  }

  // ---- Verdict Screen: Action Phase ----

  const btnActionConfiscate = $('btn-action-confiscate');
  if (btnActionConfiscate) {
    btnActionConfiscate.addEventListener('click', () => submitAction('confiscate'));
  }

  const btnActionEliminate = $('btn-action-eliminate');
  if (btnActionEliminate) {
    btnActionEliminate.addEventListener('click', () => submitAction('eliminate'));
  }

  const btnActionPass = $('btn-action-pass');
  if (btnActionPass) {
    btnActionPass.addEventListener('click', () => submitAction('pass'));
  }

  // ---- Verdict Screen: Vote Phase ----

  const btnVotePartner = $('btn-vote-partner');
  if (btnVotePartner) {
    btnVotePartner.addEventListener('click', () => submitAccusation('partnerHuman'));
  }

  const btnVoteAi = $('btn-vote-ai');
  if (btnVoteAi) {
    btnVoteAi.addEventListener('click', () => submitAccusation('aria'));
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

/* ==========================================================================
   VERDICT: Helper functions for action/vote phases
   ========================================================================== */

/** Hide multiple elements by ID */
function hideAll(...ids) {
  for (const id of ids) {
    const el = $(id);
    if (el) el.hidden = true;
  }
}

/** Show a single element by ID */
function showEl(id) {
  const el = $(id);
  if (el) el.hidden = false;
}

/** Show action phase UI for innocent (도현) */
function showActionPhaseForInnocent(canConfiscate) {
  hideAll('verdict-action-waiting', 'verdict-vote-phase', 'verdict-vote-waiting');
  showEl('verdict-action-phase');

  const title = $('action-phase-title');
  const desc = $('action-phase-desc');
  if (title) title.textContent = '행동 단계';
  if (desc) desc.textContent = '경찰이 오기 전, 행동할 수 있는 마지막 기회입니다.';

  // Show/hide confiscate button based on card ownership
  const btnConfiscate = $('btn-action-confiscate');
  if (btnConfiscate) btnConfiscate.hidden = !canConfiscate;

  // Hide culprit-only buttons
  const btnEliminate = $('btn-action-eliminate');
  const btnEliminateDisabled = $('btn-action-eliminate-disabled');
  if (btnEliminate) btnEliminate.hidden = true;
  if (btnEliminateDisabled) btnEliminateDisabled.hidden = true;

  showEl('btn-action-pass');
}

/** Show action phase UI for culprit (하진) */
function showActionPhaseForCulprit(canEliminate) {
  hideAll('verdict-action-waiting', 'verdict-vote-phase', 'verdict-vote-waiting');
  showEl('verdict-action-phase');

  const title = $('action-phase-title');
  const desc = $('action-phase-desc');
  if (title) title.textContent = '행동 단계';
  if (desc) desc.textContent = '경찰이 오기 전, 행동할 수 있는 마지막 기회입니다.';

  // Hide innocent-only button
  const btnConfiscate = $('btn-action-confiscate');
  if (btnConfiscate) btnConfiscate.hidden = true;

  // Show eliminate button based on phone possession
  const btnEliminate = $('btn-action-eliminate');
  const btnEliminateDisabled = $('btn-action-eliminate-disabled');
  if (canEliminate) {
    if (btnEliminate) btnEliminate.hidden = false;
    if (btnEliminateDisabled) btnEliminateDisabled.hidden = true;
  } else {
    if (btnEliminate) btnEliminate.hidden = true;
    if (btnEliminateDisabled) btnEliminateDisabled.hidden = false;
  }

  showEl('btn-action-pass');
}

/** Submit action (confiscate / eliminate / pass) */
function submitAction(action) {
  if (state.hasActed) return;

  SFX.click();
  state.hasActed = true;

  socket.emit('submit-action', { action });

  // Show waiting state
  hideAll('verdict-action-phase');
  showEl('verdict-action-waiting');
  const waitText = $('action-waiting-text');
  if (waitText) {
    waitText.textContent = action === 'pass'
      ? '상대방의 행동을 기다리는 중...'
      : '상대방의 행동을 기다리는 중...';
  }
}

/** Submit vote (partnerHuman / aria) */
function submitAccusation(target) {
  if (state.hasAccused) return;

  SFX.click();
  state.hasAccused = true;

  socket.emit('submit-accusation', { target });

  hideAll('verdict-vote-phase');
  showEl('verdict-vote-waiting');
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
  state.phase1Narrative = '';
  state.phase2Narrative = '';
  state.allCollectedEvidence = [];
  state.comboCards = [];
  state.reachedPhases = new Set();
  state.completedPhases = new Set();
  state.currentEvidenceId = null;
  state.isDiscussion = false;
  state.allCharacters = [];

  // Stop all audio
  ambient.stop();
  state.ambientStarted = false;
  state.bgmStarted = false;

  // Clear saved session so refresh goes to title screen.
  try { sessionStorage.removeItem('murmy_state'); } catch (_) {}

  // Reset any lingering UI states.
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
  const tabSoundBtn = $('tab-sound-toggle');
  if (tabSoundBtn) tabSoundBtn.classList.toggle('sound-on', state.soundEnabled);

  // Inject minimal toast and overlay styles if not already present.
  injectDynamicStyles();

  // Screen capture protection: black out content when tab is hidden.
  document.addEventListener('visibilitychange', () => {
    if (!document.body.classList.contains('capture-protected')) return;
    document.body.classList.toggle('capture-blacked', document.hidden);
  });

  // Dev mode: ?dev=screen-waiting 등으로 더미 데이터와 함께 특정 화면 바로 열기
  const devScreen = new URLSearchParams(window.location.search).get('dev');
  if (devScreen) {
    devMode = true;
    // 더미 state 세팅 (2인 접속 상태 시뮬레이션)
    state.playerNum = 1;
    state.roomCode = '1234';
    state.role = 'culprit';

    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));

    // 화면별 더미 데이터 주입
    if (devScreen === 'screen-waiting') {
      const waitingCode = $('waiting-room-code');
      if (waitingCode) waitingCode.textContent = '1234';
      const waitingStatus = $('waiting-status');
      if (waitingStatus) waitingStatus.textContent = '상대방이 준비를 완료했습니다. 시작을 눌러주세요!';
      const myIndicator = $('ready-indicator-1');
      if (myIndicator) myIndicator.classList.add('is-self');
      const partnerIndicator = $('ready-indicator-2');
      if (partnerIndicator) partnerIndicator.classList.add('is-ready');
      const btnReady = $('btn-ready');
      if (btnReady) { btnReady.disabled = false; btnReady.textContent = '시작'; }
    }

    if (devScreen === 'screen-character-select') {
      const dummyCharacters = [
        { id: 'hajin', name: '서하진', age: 28, gender: '남', desc: '연구실 3년차. 체계적이고 과묵하다. 오랜 기간 교수 밑에서 일한 만큼, 연구실의 모든 시스템에 능통하다.' },
        { id: 'dohyun', name: '이도현', age: 25, gender: '남', desc: '연구실 1년차. 직관적이고 예민하다. ARIA 시스템에 남다른 관심과 애착을 보인다.' },
        { id: 'professor', name: '황준석', age: 57, gender: '남', desc: '자율시스템 연구실 지도교수. 괴팍하고 예민하기로 유명하다. 다른 공대 교수들에 비해 체격이 좋은 편이다.', selectable: false },
      ];
      state.allCharacters = dummyCharacters;
      renderCharacterCards(dummyCharacters);
    }

    if (devScreen === 'screen-intro') {
      const introTitle = document.querySelector('.intro-title');
      if (introTitle) introTitle.textContent = '사건 개요';
      const narrativeEl = $('intro-narrative');
      if (narrativeEl) narrativeEl.textContent = '(더미) 사건 개요 텍스트가 여기에 표시됩니다.';
      showGameTabs();
    }

    if (devScreen === 'screen-investigation') {
      const phaseTitle = $('phase-title');
      if (phaseTitle) phaseTitle.textContent = '조사단계 1';
      const phaseSubtitle = $('phase-subtitle');
      if (phaseSubtitle) phaseSubtitle.textContent = '';
      const phaseTimer = $('phase-timer');
      if (phaseTimer) phaseTimer.textContent = '15:00 / 15:00';
      showGameTabs();
    }

    if (devScreen === 'screen-verdict') {
      showGameTabs();
    }

    if (devScreen === 'screen-ending') {
      showGameTabs();
      // Fetch all endings and render the selected one (or show picker)
      fetch('/api/dev/endings')
        .then((r) => r.json())
        .then((endings) => {
          const endingParam = params.get('ending');
          const keyMap = { '1': 'forked', '2': 'inherited', '3': 'soleSurvivor' };
          const selectedKey = keyMap[endingParam];
          if (selectedKey && endings[selectedKey]) {
            showEnding(endings[selectedKey]);
          } else {
            // Show ending picker
            const inner = document.querySelector('#screen-ending .ending-layout');
            if (inner) {
              inner.innerHTML = '<div style="display:flex;flex-direction:column;gap:12px;margin-top:12px;">'
                + '<p style="color:var(--text-secondary);font-size:0.85rem;">엔딩을 선택하세요:</p>'
                + '<a href="?dev=screen-ending&ending=1" class="verdict-card" style="text-decoration:none;"><span class="verdict-card-label">END 01: Residual</span></a>'
                + '<a href="?dev=screen-ending&ending=2" class="verdict-card" style="text-decoration:none;"><span class="verdict-card-label">END 02: Inherited Process</span></a>'
                + '<a href="?dev=screen-ending&ending=3" class="verdict-card" style="text-decoration:none;"><span class="verdict-card-label">END 03: Sole Survivor</span></a>'
                + '</div>';
            }
          }
        });
    }

    const target = $(devScreen);
    if (target) {
      target.classList.add('active');
      console.log('[murmy] Dev mode: showing', devScreen, 'with dummy data');
    } else {
      showScreen('screen-title');
    }
  } else {
    // Try to restore session state (normal refresh). If no saved state,
    // show the title screen as usual.
    const restored = restoreStateFromSession();
    if (!restored) {
      showScreen('screen-title');
    } else {
      // Reconnect to room — the socket 'connect' handler will re-join.
      console.log('[murmy] Session restored. Reconnecting to room:', state.roomCode);
    }
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

    /* ---- Center Announcement ---- */
    .center-announcement {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9000;
      opacity: 0;
      transition: opacity 0.4s ease;
    }
    .center-announcement.visible {
      opacity: 1;
    }
    .center-announcement-box {
      text-align: center;
      padding: 32px 40px;
    }
    .center-announcement-title {
      font-family: var(--font-display);
      font-size: 1.4rem;
      color: var(--accent-amber);
      margin-bottom: 8px;
    }
    .center-announcement-sub {
      font-size: 0.9rem;
      color: var(--text-secondary);
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
