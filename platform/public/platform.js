// ============================================================
// MURMY42 PLATFORM - Frontend
// ============================================================

(function () {
  'use strict';

  // --- State ---
  const state = {
    user: null,
    token: localStorage.getItem('murmy_token') || null,
    games: [],
    currentPage: 'home',
    currentTab: 'all',
    authMode: 'login',
    purchaseGameId: null,
  };

  // --- DOM refs ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const pages = {
    home: $('#page-home'),
    auth: $('#page-auth'),
    profile: $('#page-profile'),
    purchase: $('#page-purchase'),
  };

  // --- Theme ---
  function initTheme() {
    const saved = localStorage.getItem('murmy_theme');
    if (saved) {
      applyTheme(saved);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(prefersDark ? 'dark' : 'light');
    }
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem('murmy_theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.content = theme === 'light' ? '#f7f6f3' : '#111113';
    }
  }

  function toggleTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    applyTheme(isLight ? 'dark' : 'light');
  }

  // --- API helper ---
  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }
    const res = await fetch(`/api${path}`, { ...options, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // --- Navigation ---
  function showPage(pageId) {
    Object.values(pages).forEach((p) => {
      p.classList.remove('active');
      p.hidden = true;
    });
    const page = pages[pageId];
    if (page) {
      page.hidden = false;
      page.classList.add('active');
    }
    state.currentPage = pageId;
  }

  // --- Auth UI ---
  function updateAuthUI() {
    const loggedIn = !!state.user;
    $('#header-nav').hidden = loggedIn;
    $('#header-nav-logged').hidden = !loggedIn;

    if (loggedIn) {
      $('#header-points').textContent = `${state.user.points}P`;
    }
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    const isSignup = mode === 'signup';
    $('#auth-title').textContent = isSignup ? '회원가입' : '로그인';
    $('#btn-auth-submit').textContent = isSignup ? '가입하기' : '로그인';
    $('#form-group-nickname').hidden = !isSignup;
    $('#auth-toggle-text').textContent = isSignup ? '이미 계정이 있으신가요?' : '계정이 없으신가요?';
    $('#btn-auth-toggle').textContent = isSignup ? '로그인' : '회원가입';
    $('#auth-error').hidden = true;
  }

  // --- Game Tabs ---
  function setTab(tab) {
    state.currentTab = tab;
    $$('.game-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    renderGameList();
  }

  // --- Game List ---
  function renderGameList() {
    const container = $('#game-list');
    const emptyMsg = $('#game-list-empty');

    let games = state.games;
    if (state.currentTab === 'owned') {
      games = games.filter((g) => g.purchased);
    }

    if (games.length === 0 && state.currentTab === 'owned') {
      container.innerHTML = '';
      emptyMsg.hidden = false;
      return;
    }
    emptyMsg.hidden = true;

    container.innerHTML = games.map((game) => {
      const owned = game.purchased;
      const coverStyle = game.coverBg
        ? `background-image: url('${game.coverBg}'); background-size: cover; background-position: center;`
        : '';

      return `
        <div class="game-card" data-game-id="${game.id}">
          <div class="game-card-cover" style="${coverStyle}">
            ${game.coverLogo ? `<img src="${game.coverLogo}" alt="${game.title}">` : ''}
          </div>
          <div class="game-card-body">
            <div class="game-card-header">
              <div>
                <div class="game-card-title">${game.title}</div>
                <div class="game-card-subtitle">${game.subtitle}</div>
              </div>
              ${owned
                ? '<span class="game-card-badge game-card-badge--owned">보유 중</span>'
                : `<span class="game-card-price">${game.price.toLocaleString()}원</span>`
              }
            </div>
            <p class="game-card-desc">${game.description}</p>
            <div class="game-card-meta">
              <span>${game.players}인용</span>
              <span>${game.duration}</span>
            </div>
            <div class="game-card-actions">
              ${owned
                ? '<button class="btn btn-play" data-action="play">플레이하기</button>'
                : '<button class="btn btn-buy" data-action="buy">구매하기</button>'
              }
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Event listeners
    container.querySelectorAll('.game-card').forEach((card) => {
      card.addEventListener('click', () => {
        const gameId = card.dataset.gameId;
        const game = state.games.find((g) => g.id === gameId);
        if (!game) return;

        if (game.purchased) {
          window.location.href = `/games/${gameId}/`;
        } else if (!state.user) {
          showPage('auth');
        } else {
          showPurchasePage(gameId);
        }
      });
    });

    container.querySelectorAll('[data-action="play"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const gameId = btn.closest('.game-card').dataset.gameId;
        window.location.href = `/games/${gameId}/`;
      });
    });

    container.querySelectorAll('[data-action="buy"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const gameId = btn.closest('.game-card').dataset.gameId;
        if (!state.user) {
          showPage('auth');
          return;
        }
        showPurchasePage(gameId);
      });
    });
  }

  // --- Profile ---
  async function loadProfile() {
    try {
      const data = await api('/user/me');
      state.user = data;
      updateAuthUI();

      $('#profile-nickname').textContent = data.nickname;
      $('#profile-email').textContent = data.email;
      $('#profile-points').textContent = `${data.points}P`;

      // Coupons
      const couponList = $('#coupon-list');
      if (data.coupons && data.coupons.length > 0) {
        couponList.innerHTML = data.coupons.map((c) => `
          <div class="coupon-item">
            <span class="coupon-code">${c.code}</span>
            <span class="coupon-amount">-${c.discount_amount.toLocaleString()}원</span>
          </div>
        `).join('');
      } else {
        couponList.innerHTML = '<p class="empty-state">사용 가능한 쿠폰이 없습니다.</p>';
      }

      // History
      const historyData = await api('/user/history');
      const historyList = $('#history-list');
      if (historyData.completions && historyData.completions.length > 0) {
        historyList.innerHTML = historyData.completions.map((c) => `
          <div class="history-item">
            <span>${c.game_id} (${c.role === 'culprit' ? '범인' : '탐정'})</span>
            <span>${c.won ? '승리' : '패배'} +${c.points_awarded}P</span>
          </div>
        `).join('');
      } else {
        historyList.innerHTML = '<p class="empty-state">아직 플레이한 게임이 없습니다.</p>';
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
    }
  }

  // --- Purchase ---
  function showPurchasePage(gameId) {
    const game = state.games.find((g) => g.id === gameId);
    if (!game) return;

    state.purchaseGameId = gameId;

    $('#purchase-game-info').innerHTML = `
      <div class="game-card-title">${game.title}</div>
      <div class="game-card-subtitle">${game.subtitle}</div>
      <p class="game-card-desc" style="margin-top:0.5rem">${game.description}</p>
    `;

    $('#purchase-price').textContent = `${game.price.toLocaleString()}원`;
    $('#purchase-points-available').textContent = `사용 가능: ${state.user.points}P`;
    $('#purchase-points').value = 0;
    $('#purchase-points').max = state.user.points;
    $('#purchase-coupon').value = '';
    updatePurchaseTotal(game.price);

    showPage('purchase');
  }

  function updatePurchaseTotal(basePrice) {
    const pointsUsed = parseInt($('#purchase-points').value) || 0;
    const total = Math.max(0, basePrice - pointsUsed);
    $('#purchase-total').textContent = `${total.toLocaleString()}원`;
  }

  // --- Init ---
  async function init() {
    // Theme first (avoid flash)
    initTheme();

    // Check for OAuth token in URL
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    if (tokenFromUrl) {
      state.token = tokenFromUrl;
      localStorage.setItem('murmy_token', tokenFromUrl);
      window.history.replaceState({}, '', '/');
    }

    // Load user if token exists
    if (state.token) {
      try {
        const data = await api('/user/me');
        state.user = data;
      } catch {
        state.token = null;
        localStorage.removeItem('murmy_token');
      }
    }

    updateAuthUI();

    // Load game list
    try {
      state.games = await api('/games');
      renderGameList();
    } catch (err) {
      console.error('Failed to load games:', err);
    }

    // --- Event Listeners ---

    // Theme toggle
    $('#btn-theme').addEventListener('click', toggleTheme);

    // Game tabs
    $$('.game-tab').forEach((tab) => {
      tab.addEventListener('click', () => setTab(tab.dataset.tab));
    });

    // Login button
    $('#btn-login').addEventListener('click', () => {
      setAuthMode('login');
      showPage('auth');
    });

    // Profile button
    $('#btn-profile').addEventListener('click', () => {
      loadProfile();
      showPage('profile');
    });

    // Logout button
    $('#btn-logout').addEventListener('click', () => {
      state.user = null;
      state.token = null;
      localStorage.removeItem('murmy_token');
      updateAuthUI();
      showPage('home');
      loadGames();
    });

    // My games button (profile -> owned tab)
    $('#btn-my-games').addEventListener('click', () => {
      setTab('owned');
      showPage('home');
    });

    // Auth toggle (login <-> signup)
    $('#btn-auth-toggle').addEventListener('click', () => {
      setAuthMode(state.authMode === 'login' ? 'signup' : 'login');
    });

    // Auth form submit
    $('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#auth-email').value.trim();
      const password = $('#auth-password').value;
      const nickname = $('#auth-nickname').value.trim();

      try {
        let result;
        if (state.authMode === 'signup') {
          result = await api('/auth/signup', {
            method: 'POST',
            body: JSON.stringify({ email, password, nickname }),
          });
          if (result.couponCode) {
            alert(`가입 완료! 환영 쿠폰이 발급되었습니다: ${result.couponCode}\n(2,000원 할인, 90일 유효)`);
          }
        } else {
          result = await api('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
          });
        }

        state.token = result.token;
        state.user = result.user;
        localStorage.setItem('murmy_token', result.token);
        updateAuthUI();
        showPage('home');
        loadGames();
      } catch (err) {
        $('#auth-error').textContent = err.message;
        $('#auth-error').hidden = false;
      }
    });

    // Purchase points input
    $('#purchase-points').addEventListener('input', () => {
      const game = state.games.find((g) => g.id === state.purchaseGameId);
      if (game) updatePurchaseTotal(game.price);
    });

    // Purchase confirm
    $('#btn-purchase-confirm').addEventListener('click', async () => {
      if (!state.purchaseGameId) return;

      try {
        const result = await api(`/games/${state.purchaseGameId}/purchase`, {
          method: 'POST',
          body: JSON.stringify({
            pointsToUse: parseInt($('#purchase-points').value) || 0,
            couponCode: $('#purchase-coupon').value.trim() || undefined,
          }),
        });

        state.user.points = result.newPointsBalance;
        updateAuthUI();
        alert(`구매 완료! (+2P 적립)\n결제 금액: ${result.amountPaid.toLocaleString()}원`);
        showPage('home');
        loadGames();
      } catch (err) {
        alert(err.message);
      }
    });

    // Logo click -> home
    $('.header-logo').addEventListener('click', (e) => {
      e.preventDefault();
      showPage('home');
    });
  }

  async function loadGames() {
    try {
      state.games = await api('/games');
      renderGameList();
    } catch (err) {
      console.error(err);
    }
  }

  // Start
  init();
})();
