// ============================================================
// MURMY42 PLATFORM - Frontend
// ============================================================

(function () {
  'use strict';

  // --- State ---
  const state = {
    user: null,
    token: localStorage.getItem('murmy_token') || null,
    refreshToken: localStorage.getItem('murmy_refresh') || null,
    games: [],
    currentPage: 'home',
    currentTab: 'all',
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

  // --- Token management ---
  function saveTokens(token, refreshToken, provider) {
    state.token = token;
    state.refreshToken = refreshToken;
    localStorage.setItem('murmy_token', token);
    localStorage.setItem('murmy_refresh', refreshToken);
    if (provider) {
      localStorage.setItem('murmy_last_provider', provider);
    }
  }

  function clearTokens() {
    state.token = null;
    state.refreshToken = null;
    state.user = null;
    localStorage.removeItem('murmy_token');
    localStorage.removeItem('murmy_refresh');
  }

  async function refreshAccessToken() {
    if (!state.refreshToken) return false;

    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: state.refreshToken }),
      });

      if (!res.ok) {
        clearTokens();
        return false;
      }

      const data = await res.json();
      saveTokens(data.token, data.refreshToken);
      return true;
    } catch {
      clearTokens();
      return false;
    }
  }

  // --- API helper with auto-refresh ---
  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }

    let res = await fetch(`/api${path}`, { ...options, headers });

    // If 401 with TOKEN_EXPIRED, try refresh
    if (res.status === 401 && state.refreshToken) {
      const body = await res.json();
      if (body.code === 'TOKEN_EXPIRED') {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          headers['Authorization'] = `Bearer ${state.token}`;
          res = await fetch(`/api${path}`, { ...options, headers });
        } else {
          throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
        }
      } else {
        throw new Error(body.error || 'Request failed');
      }
    }

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Request failed');
    }

    return await res.json();
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

    // Show "최근" badge on auth page
    if (pageId === 'auth') {
      showLastProviderBadge();
    }
  }

  // --- Last provider badge ---
  function showLastProviderBadge() {
    const lastProvider = localStorage.getItem('murmy_last_provider');
    $$('.oauth-recent').forEach((badge) => {
      badge.hidden = badge.dataset.recent !== lastProvider;
    });
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
      $('#profile-email').textContent = data.email || `${data.provider} 계정`;
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

    // Check for OAuth token in URL (from callback redirect)
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    const refreshFromUrl = urlParams.get('refresh');
    const providerFromUrl = urlParams.get('provider');
    const errorFromUrl = urlParams.get('error');

    if (tokenFromUrl && refreshFromUrl) {
      saveTokens(tokenFromUrl, refreshFromUrl, providerFromUrl);
      window.history.replaceState({}, '', '/');
    } else if (errorFromUrl) {
      window.history.replaceState({}, '', '/');
      // Show error on auth page
      showPage('auth');
      const errEl = $('#auth-error');
      errEl.textContent = '로그인에 실패했습니다. 다시 시도해주세요.';
      errEl.hidden = false;
    }

    // Load user if token exists
    if (state.token) {
      try {
        const data = await api('/user/me');
        state.user = data;
      } catch {
        clearTokens();
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
      showPage('auth');
    });

    // Profile button
    $('#btn-profile').addEventListener('click', () => {
      loadProfile();
      showPage('profile');
    });

    // Logout button
    $('#btn-logout').addEventListener('click', async () => {
      // Notify server to invalidate refresh token
      if (state.refreshToken) {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: state.refreshToken }),
          });
        } catch { /* ignore */ }
      }
      clearTokens();
      updateAuthUI();
      showPage('home');
      loadGames();
    });

    // My games button (profile -> owned tab)
    $('#btn-my-games').addEventListener('click', () => {
      setTab('owned');
      showPage('home');
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
