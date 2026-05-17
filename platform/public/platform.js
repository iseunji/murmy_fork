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
    reviews: $('#page-reviews'),
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

  // --- Bottom nav active state ---
  function setActiveNav(navId) {
    $$('.bottom-nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.nav === navId);
    });
  }

  // --- Hamburger Menu ---
  function toggleMenu() {
    const menu = $('#hamburger-menu');
    const btn = $('#btn-hamburger');
    const isOpen = !menu.hidden;

    if (isOpen) {
      closeMenu();
    } else {
      menu.hidden = false;
      btn.classList.add('active');
      // Close on outside click
      setTimeout(() => {
        document.addEventListener('click', handleOutsideMenuClick);
      }, 0);
    }
  }

  function closeMenu() {
    $('#hamburger-menu').hidden = true;
    $('#btn-hamburger').classList.remove('active');
    document.removeEventListener('click', handleOutsideMenuClick);
  }

  function handleOutsideMenuClick(e) {
    const menu = $('#hamburger-menu');
    const btn = $('#btn-hamburger');
    if (!menu.contains(e.target) && !btn.contains(e.target)) {
      closeMenu();
    }
  }

  // --- Auth UI ---
  function updateAuthUI() {
    const loggedIn = !!state.user;

    // Hamburger menu points
    const menuPoints = $('#menu-points');
    if (loggedIn) {
      menuPoints.hidden = false;
      $('#menu-points-value').textContent = `${state.user.points}P`;
    } else {
      menuPoints.hidden = true;
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
      return `
        <div class="game-card" data-game-id="${game.id}">
          <div class="game-card-cover game-card-cover--loading" data-bg="${game.coverBg || ''}">
            ${game.coverLogo ? `<img class="game-card-logo" src="${game.coverLogo}" alt="${game.title}">` : ''}
            ${game.coverIllust ? `<div class="game-card-illust-wrap"><img class="game-card-illust" src="${game.coverIllust}" alt=""></div>` : ''}
          </div>
          <div class="game-card-body">
            <div class="game-card-header">
              <div class="game-card-title-row">
                <span class="game-card-title">${game.title}</span>
                <span class="game-card-meta-inline">${game.subtitle ? `(${game.subtitle})` : ''} · ${game.players}인용 ${game.duration}</span>
              </div>
              ${owned
                ? (game.accessType === 'promo'
                  ? '<span class="game-card-badge game-card-badge--promo">프로모션</span>'
                  : '<span class="game-card-badge game-card-badge--owned">구매</span>')
                : `<span class="game-card-price">${game.price.toLocaleString()}원</span>`
              }
            </div>
            <p class="game-card-desc">${game.description}</p>
            <div class="game-card-actions">
              ${owned
                ? `<button class="btn btn-invite" data-action="invite">함께할 친구 초대하기</button>`
                : '<button class="btn btn-buy" data-action="buy">구매하기</button>'
              }
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Preload cover images before showing
    container.querySelectorAll('.game-card-cover').forEach((cover) => {
      const bgUrl = cover.dataset.bg;
      const allImgs = cover.querySelectorAll('img');
      const promises = [];

      if (bgUrl) {
        promises.push(new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            cover.style.backgroundImage = `url('${bgUrl}')`;
            cover.style.backgroundSize = 'cover';
            cover.style.backgroundPosition = 'center';
            resolve();
          };
          img.onerror = resolve;
          img.src = bgUrl;
        }));
      }

      allImgs.forEach((imgEl) => {
        if (!imgEl.complete) {
          promises.push(new Promise((resolve) => {
            imgEl.onload = resolve;
            imgEl.onerror = resolve;
          }));
        }
      });

      if (promises.length === 0) {
        cover.classList.remove('game-card-cover--loading');
      } else {
        Promise.all(promises).then(() => {
          cover.classList.remove('game-card-cover--loading');
        });
      }
    });

    // Event listeners
    container.querySelectorAll('.game-card').forEach((card) => {
      card.addEventListener('click', () => {
        const gameId = card.dataset.gameId;
        const game = state.games.find((g) => g.id === gameId);
        if (!game) return;

        if (game.purchased) {
          openInviteModal(gameId);
        } else if (!state.user) {
          showPage('auth');
        } else {
          showPurchasePage(gameId);
        }
      });
    });

    container.querySelectorAll('[data-action="invite"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const gameId = btn.closest('.game-card').dataset.gameId;
        await openInviteModal(gameId);
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

  // --- Reviews ---
  let reviewRating = 0;

  async function loadReviews() {
    try {
      const data = await api('/reviews');
      const list = $('#reviews-list');
      const statsEl = $('#reviews-stats');
      const writeBtn = $('#btn-write-review');

      // Show write button if logged in
      writeBtn.hidden = !state.user;

      // Stats
      if (data.stats && data.stats.length > 0) {
        statsEl.innerHTML = data.stats.map((s) => {
          const game = state.games.find((g) => g.id === s.game_id);
          const title = game ? game.title : s.game_id;
          return `
            <div class="review-stat">
              <span class="review-stat-title">${title}</span>
              <span class="review-stat-stars">${renderStars(s.avg_rating)}</span>
              <span class="review-stat-info">${s.avg_rating} / 5 (${s.count}개)</span>
            </div>
          `;
        }).join('');
      } else {
        statsEl.innerHTML = '';
      }

      // List
      if (data.reviews && data.reviews.length > 0) {
        list.innerHTML = data.reviews.map((r) => {
          const game = state.games.find((g) => g.id === r.game_id);
          const title = game ? game.title : r.game_id;
          const date = new Date(r.created_at + 'Z').toLocaleDateString('ko-KR');
          const isOwn = state.user && state.user.nickname === r.nickname;
          return `
            <div class="review-item">
              <div class="review-item-header">
                <div>
                  <span class="review-item-nickname">${r.nickname}</span>
                  <span class="review-item-game">${title}</span>
                </div>
                <span class="review-item-date">${date}</span>
              </div>
              <div class="review-item-stars">${renderStars(r.rating)}</div>
              <p class="review-item-content">${escapeHtml(r.content)}</p>
              ${isOwn ? `<button class="btn-link review-delete" data-review-id="${r.id}">삭제</button>` : ''}
            </div>
          `;
        }).join('');

        // Delete handlers
        list.querySelectorAll('.review-delete').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm('후기를 삭제하시겠습니까?')) return;
            try {
              await api(`/reviews/${btn.dataset.reviewId}`, { method: 'DELETE' });
              loadReviews();
            } catch (err) {
              alert(err.message);
            }
          });
        });
      } else {
        list.innerHTML = '<p class="empty-state">아직 후기가 없습니다.</p>';
      }
    } catch (err) {
      console.error('Failed to load reviews:', err);
    }
  }

  function renderStars(rating) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
      if (i <= Math.floor(rating)) {
        html += '<i class="fas fa-star star-filled"></i>';
      } else if (i - 0.5 <= rating) {
        html += '<i class="fas fa-star-half-alt star-filled"></i>';
      } else {
        html += '<i class="far fa-star star-empty"></i>';
      }
    }
    return html;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function updateStarInput(rating) {
    reviewRating = rating;
    $('#star-input').querySelectorAll('i').forEach((star) => {
      const val = parseInt(star.dataset.rating);
      star.classList.toggle('star-filled', val <= rating);
      star.classList.toggle('star-empty', val > rating);
    });
  }

  function openReviewModal() {
    const select = $('#review-game-select');
    // Populate with completed games
    const completedGames = state.games.filter((g) => g.purchased);
    select.innerHTML = '<option value="">게임 선택</option>' +
      completedGames.map((g) => `<option value="${g.id}">${g.title}</option>`).join('');

    reviewRating = 0;
    updateStarInput(0);
    $('#review-content').value = '';
    $('#review-modal').hidden = false;
  }

  // --- Invite ---
  async function openInviteModal(gameId) {
    try {
      const data = await api(`/games/${gameId}/invite`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      $('#invite-link-input').value = data.inviteUrl;
      $('#invite-modal').hidden = false;
      $('#invite-modal').dataset.gameId = gameId;
      // Store invite code so the host's game client can link the room
      localStorage.setItem('murmy_host_invite', data.inviteCode);
    } catch (err) {
      alert(err.message);
    }
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
      // Show error on auth page with specific message
      showPage('auth');
      const errEl = $('#auth-error');
      const detail = urlParams.get('detail') || '';
      let errMsg = '로그인에 실패했습니다. 다시 시도해주세요.';
      if (errorFromUrl.includes('token_failed')) {
        errMsg = `인증 서버 오류가 발생했습니다 (${detail || errorFromUrl}). 다시 시도해주세요.`;
      } else if (errorFromUrl.includes('access_denied')) {
        errMsg = '로그인이 취소되었습니다.';
      } else if (errorFromUrl.includes('no_code')) {
        errMsg = '인증 코드를 받지 못했습니다. 다시 시도해주세요.';
      }
      errEl.textContent = errMsg;
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

    // Hamburger menu
    $('#btn-hamburger').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    // Game tabs
    $$('.game-tab').forEach((tab) => {
      tab.addEventListener('click', () => setTab(tab.dataset.tab));
    });

    // Bottom nav
    $('#nav-home').addEventListener('click', () => {
      setActiveNav('home');
      showPage('home');
    });

    $('#nav-reviews').addEventListener('click', () => {
      setActiveNav('reviews');
      showPage('reviews');
      loadReviews();
    });

    $('#nav-my').addEventListener('click', () => {
      setActiveNav('my');
      if (state.user) {
        loadProfile();
        showPage('profile');
      } else {
        showPage('auth');
      }
    });

    // My games button (profile -> owned tab)
    $('#btn-my-games').addEventListener('click', () => {
      setActiveNav('home');
      setTab('owned');
      showPage('home');
    });

    // Logout
    $('#btn-logout').addEventListener('click', async () => {
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
      setActiveNav('home');
      showPage('home');
      await loadGames();
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

    // Review modal
    $('#btn-write-review').addEventListener('click', () => {
      if (!state.user) {
        showPage('auth');
        return;
      }
      openReviewModal();
    });

    $('#star-input').querySelectorAll('i').forEach((star) => {
      star.addEventListener('click', () => {
        updateStarInput(parseInt(star.dataset.rating));
      });
    });

    $('#btn-review-cancel').addEventListener('click', () => {
      $('#review-modal').hidden = true;
    });

    $('#btn-review-submit').addEventListener('click', async () => {
      const gameId = $('#review-game-select').value;
      const content = $('#review-content').value.trim();

      if (!gameId) return alert('게임을 선택해주세요.');
      if (!reviewRating) return alert('별점을 선택해주세요.');
      if (content.length < 5) return alert('후기는 5자 이상 작성해주세요.');

      try {
        await api('/reviews', {
          method: 'POST',
          body: JSON.stringify({ gameId, rating: reviewRating, content }),
        });
        $('#review-modal').hidden = true;
        loadReviews();
      } catch (err) {
        alert(err.message);
      }
    });

    // --- Invite modal ---
    $('#btn-invite-copy').addEventListener('click', () => {
      const input = $('#invite-link-input');
      navigator.clipboard.writeText(input.value).then(() => {
        $('#btn-invite-copy').textContent = '복사됨!';
        setTimeout(() => { $('#btn-invite-copy').textContent = '복사'; }, 2000);
      }).catch(() => {
        input.select();
        document.execCommand('copy');
        $('#btn-invite-copy').textContent = '복사됨!';
        setTimeout(() => { $('#btn-invite-copy').textContent = '복사'; }, 2000);
      });
    });

    $('#btn-share-kakao').addEventListener('click', () => {
      const url = $('#invite-link-input').value;
      const kakaoUrl = `https://sharer.kakao.com/talk/friends/picker/link?url=${encodeURIComponent(url)}`;
      if (navigator.share) {
        navigator.share({ title: 'Murmy42 - 함께 플레이하기', text: '2인용 머더 미스터리 게임에 초대합니다!', url }).catch(() => {});
      } else {
        window.open(kakaoUrl, '_blank', 'width=500,height=600');
      }
    });

    $('#btn-share-sms').addEventListener('click', () => {
      const url = $('#invite-link-input').value;
      const body = encodeURIComponent(`Murmy42 게임 초대! 아래 링크로 접속하세요:\n${url}`);
      window.location.href = `sms:?body=${body}`;
    });

    $('#btn-invite-close').addEventListener('click', () => {
      const modal = $('#invite-modal');
      const gameId = modal.dataset.gameId;
      modal.hidden = true;
      if (gameId) {
        window.location.href = `/games/${gameId}/`;
      }
    });

    // Promo code submit
    $('#btn-promo-submit').addEventListener('click', async () => {
      const code = $('#promo-code-input').value.trim();
      const resultEl = $('#promo-result');
      if (!code) {
        resultEl.textContent = '코드를 입력해주세요.';
        resultEl.className = 'promo-result promo-result--error';
        resultEl.hidden = false;
        return;
      }
      try {
        const data = await api('/promo/redeem', {
          method: 'POST',
          body: JSON.stringify({ code }),
        });
        resultEl.textContent = data.message;
        resultEl.className = 'promo-result promo-result--success';
        resultEl.hidden = false;
        $('#promo-code-input').value = '';
        // Refresh game list
        await loadGames();
      } catch (err) {
        resultEl.textContent = err.message;
        resultEl.className = 'promo-result promo-result--error';
        resultEl.hidden = false;
      }
    });

    $('#promo-code-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#btn-promo-submit').click();
    });

    // Logo click -> home
    $('.header-logo').addEventListener('click', (e) => {
      e.preventDefault();
      setActiveNav('home');
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
