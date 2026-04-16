/* =============================================================================
   Fetched! — Main Script (Bento edition)
   Pure vanilla JS · OMDB API · localStorage persistence
   Play = open embed source in new tab (no picker, no same-page iframe)
============================================================================= */

'use strict';

/* ── Config ──────────────────────────────────────────────────────────────── */
const API_KEY       = 'b9b2061f';
const API_BASE      = 'https://www.omdbapi.com/';
const DEBOUNCE_MS   = 380;
const MAX_HISTORY   = 15;
const MAX_RECENT    = 8;
const MIN_QUERY_LEN = 2;
const MOBILE_BP     = 900;
const SCROLL_SHOW   = 400;

/* ── Embed sources (index 0 = default) ──────────────────────────────────── */
const EMBED_SOURCES = [
  {
    name: 'VidSrc',
    movie: 'https://vidsrc.me/embed/movie?imdb={id}',
    tv:    'https://vidsrc.me/embed/tv?imdb={id}&season={season}&episode={episode}',
  },
  {
    name: 'VidSrc ICU',
    movie: 'https://vidsrc.icu/embed/movie/{id}',
    tv:    'https://vidsrc.icu/embed/tv/{id}/{season}/{episode}',
  },
  {
    name: '2Embed',
    movie: 'https://www.2embed.cc/embed/{id}',
    tv:    'https://www.2embed.cc/embedtv/{id}&s={season}&e={episode}',
  },
  {
    name: 'SmashyStream',
    movie: 'https://embed.smashystream.com/playere.php?imdb={id}',
    tv:    'https://embed.smashystream.com/playere.php?imdb={id}&season={season}&episode={episode}',
  },
  {
    name: 'MultiEmbed',
    movie: 'https://multiembed.mov/?video_id={id}&tmdb=0',
    tv:    'https://multiembed.mov/?video_id={id}&tmdb=0&s={season}&e={episode}',
  },
];

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const safeJsonParse = (str, fallback) => {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
};

const $   = id => document.getElementById(id);
const qs  = (sel, ctx = document) => ctx.querySelector(sel);
const qsa = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function announce(msg) {
  const region = $('srAnnounce');
  if (!region) return;
  region.textContent = '';
  requestAnimationFrame(() => { region.textContent = msg; });
}

/* ── State ───────────────────────────────────────────────────────────────── */
let allResults        = [];
let filteredResults   = [];
let totalResults      = 0;
let lastQuery         = '';
let isLoading         = false;
let mobileSidebarOpen = false;
let activeType        = 'all';
let yearFrom          = '';
let yearTo            = '';
let debounceTimer     = null;

// Persisted state
let watchHistory    = safeJsonParse(localStorage.getItem('watchHistory'),    []);
let recentSearches  = safeJsonParse(localStorage.getItem('recentSearches'),  []);
let watchlist       = safeJsonParse(localStorage.getItem('watchlist'),       []);
let sourceMemory    = safeJsonParse(localStorage.getItem('sourceMemory'),    {});
let episodeProgress = safeJsonParse(localStorage.getItem('episodeProgress'), {});

// In-memory caches
const searchCache = {};
const detailCache = {};

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const searchInput       = $('searchInput');
const searchClear       = $('searchClear');
const emptyState        = $('emptyState');
const skeletonWrap      = $('skeletonWrap');
const resultsContainer  = $('resultsContainer');
const resultsGrid       = $('resultsGrid');
const resultsCount      = $('resultsCount');
const noResultsMsg      = $('noResultsMsg');
const errorMsg          = $('errorMsg');
const loadMoreWrap      = $('loadMoreWrap');
const loadMoreBtn       = $('loadMoreBtn');
const loadMoreCount     = $('loadMoreCount');
const recentList        = $('recentList');
const watchlistList     = $('watchlistList');
const historyList       = $('historyList');
const recentClearBtn    = $('recentClearBtn');
const watchlistClearBtn = $('watchlistClearBtn');
const historyClearBtn   = $('historyClearBtn');
const filterResetBtn    = $('filterResetBtn');
const typePills         = $('typePills');
const yearFromInput     = $('yearFrom');
const yearToInput       = $('yearTo');
const sidebarToggle     = $('sidebarToggle');
const sidebar           = $('sidebar');
const sidebarBackdrop   = $('sidebarBackdrop');
const appLayout         = $('appLayout');
const themeToggle       = $('themeToggle');
const disclaimerModal   = $('disclaimerModal');
const disclaimerBtn     = $('disclaimerBtn');
const modalClose        = $('modalClose');
const scrollTopBtn      = $('scrollTopBtn');
const heroChips         = qsa('.hero-chip');

/* ── Overlay state trackers ──────────────────────────────────────────────── */
const detailModal = { open: false };

/* ── Body overflow lock ──────────────────────────────────────────────────── */
function updateBodyOverflow() {
  const lock = mobileSidebarOpen
    || detailModal.open
    || (disclaimerModal && !disclaimerModal.hidden);
  document.body.style.overflow = lock ? 'hidden' : '';
}

/* ── Focus trap ──────────────────────────────────────────────────────────── */
function trapFocus(container) {
  const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const getFocusable = () => qsa(FOCUSABLE, container).filter(n => !n.closest('[inert]'));

  function handler(e) {
    if (e.key !== 'Tab') return;
    const items = getFocusable();
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last  = items[items.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
  }
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

/* ── Theme ───────────────────────────────────────────────────────────────── */
function setTheme(theme, save = true) {
  document.documentElement.classList.toggle('light-mode', theme === 'light');
  const isDark = theme === 'dark';
  themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  themeToggle.title       = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  themeToggle.textContent = isDark ? '☀️' : '🌙';
  if (save) localStorage.setItem('theme', theme);
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    setTheme(saved, false);
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(prefersDark ? 'dark' : 'light', false);
  }
}

themeToggle.addEventListener('click', () => {
  const isLight = document.documentElement.classList.contains('light-mode');
  setTheme(isLight ? 'dark' : 'light');
});

/* ── PWA service worker ──────────────────────────────────────────────────── */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

/* ── Disclaimer ──────────────────────────────────────────────────────────── */
function showDisclaimer() {
  disclaimerModal.hidden = false;
  updateBodyOverflow();
  const cleanup = trapFocus(disclaimerModal);
  disclaimerModal._trapCleanup = cleanup;
  setTimeout(() => disclaimerBtn.focus(), 60);
}

function hideDisclaimer() {
  disclaimerModal.hidden = true;
  if (disclaimerModal._trapCleanup) {
    disclaimerModal._trapCleanup();
    disclaimerModal._trapCleanup = null;
  }
  updateBodyOverflow();
  searchInput.focus();
}

disclaimerBtn.addEventListener('click', () => {
  localStorage.setItem('disclaimerShown', '1');
  hideDisclaimer();
});
modalClose.addEventListener('click', () => {
  localStorage.setItem('disclaimerShown', '1');
  hideDisclaimer();
});

/* ── Sidebar ─────────────────────────────────────────────────────────────── */
function openMobileSidebar() {
  mobileSidebarOpen = true;
  sidebar.removeAttribute('inert');
  sidebar.classList.add('mobile-open');
  sidebarBackdrop.classList.add('active');
  sidebarToggle?.setAttribute('aria-expanded', 'true');
  updateBodyOverflow();
  setTimeout(() => {
    const focusable = qs('button, input, a', sidebar);
    focusable?.focus();
  }, 60);
}

function closeMobileSidebar() {
  mobileSidebarOpen = false;
  sidebar.setAttribute('inert', '');
  sidebar.classList.remove('mobile-open');
  sidebarBackdrop.classList.remove('active');
  sidebarToggle?.setAttribute('aria-expanded', 'false');
  updateBodyOverflow();
}

function showSidebar() {
  if (sidebarToggle) sidebarToggle.hidden = false;
  appLayout.classList.add('searching');
  if (window.innerWidth > MOBILE_BP) {
    sidebar.removeAttribute('inert');
  }
}

function hideSidebar() {
  appLayout.classList.remove('searching');
  closeMobileSidebar();
  if (window.innerWidth > MOBILE_BP) {
    sidebar.setAttribute('inert', '');
  }
  if (sidebarToggle) sidebarToggle.hidden = true;
}

sidebarToggle?.addEventListener('click', () => {
  mobileSidebarOpen ? closeMobileSidebar() : openMobileSidebar();
});
sidebarBackdrop.addEventListener('click', closeMobileSidebar);

/* ── Watchlist ───────────────────────────────────────────────────────────── */
function isInWatchlist(imdbID) {
  return watchlist.some(w => w.imdbID === imdbID);
}

function toggleWatchlist(item) {
  const idx = watchlist.findIndex(w => w.imdbID === item.imdbID);
  if (idx > -1) {
    watchlist.splice(idx, 1);
    announce(`${item.Title} removed from watchlist`);
  } else {
    watchlist.unshift({
      imdbID: item.imdbID,
      Title:  item.Title,
      Year:   item.Year,
      Poster: item.Poster,
      Type:   item.Type,
    });
    announce(`${item.Title} added to watchlist`);
  }
  localStorage.setItem('watchlist', JSON.stringify(watchlist));
  renderWatchlistSidebar();
  updateCardBookmark(item.imdbID, isInWatchlist(item.imdbID));
}

function renderWatchlistSidebar() {
  if (!watchlistList) return;
  if (!watchlist.length) {
    watchlistList.innerHTML = '<li class="sidebar-empty">Nothing saved yet.</li>';
    return;
  }
  watchlistList.innerHTML = watchlist.map(item => `
    <li class="sidebar-item" data-id="${item.imdbID}" role="button" tabindex="0" aria-label="${item.Title}">
      <span class="sidebar-item-title">${item.Title}</span>
      <span class="sidebar-item-year">${item.Year || ''}</span>
    </li>`).join('');

  qsa('.sidebar-item', watchlistList).forEach(li => {
    const open = () => {
      const id    = li.dataset.id;
      const found = allResults.find(r => r.imdbID === id) || watchlist.find(w => w.imdbID === id);
      if (found) openDetailModal(found);
    };
    li.addEventListener('click', open);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

watchlistClearBtn?.addEventListener('click', () => {
  watchlist = [];
  localStorage.setItem('watchlist', JSON.stringify(watchlist));
  renderWatchlistSidebar();
  qsa('.card-bookmark-btn').forEach(btn => btn.classList.remove('active'));
});

/* ── Episode progress ────────────────────────────────────────────────────── */
function getEpisodeProgress(imdbID) {
  return episodeProgress[imdbID] || { season: 1, episode: 1 };
}

function saveEpisodeProgress(imdbID, season, episode) {
  episodeProgress[imdbID] = {
    season:  parseInt(season,  10) || 1,
    episode: parseInt(episode, 10) || 1,
  };
  localStorage.setItem('episodeProgress', JSON.stringify(episodeProgress));
}

/* ── Watch history ───────────────────────────────────────────────────────── */
function addToHistory(item) {
  watchHistory = watchHistory.filter(h => h.imdbID !== item.imdbID);
  watchHistory.unshift({
    imdbID: item.imdbID,
    Title:  item.Title,
    Year:   item.Year,
    Type:   item.Type,
  });
  if (watchHistory.length > MAX_HISTORY) watchHistory = watchHistory.slice(0, MAX_HISTORY);
  localStorage.setItem('watchHistory', JSON.stringify(watchHistory));
  renderHistoryList();
}

function renderHistoryList() {
  if (!historyList) return;
  if (!watchHistory.length) {
    historyList.innerHTML = '<li class="sidebar-empty">Nothing watched yet.</li>';
    return;
  }
  historyList.innerHTML = watchHistory.map(item => `
    <li class="sidebar-item" data-id="${item.imdbID}" role="button" tabindex="0" aria-label="${item.Title}">
      <span class="sidebar-item-title">${item.Title}</span>
      <span class="sidebar-item-year">${item.Year || ''}</span>
    </li>`).join('');

  qsa('.sidebar-item', historyList).forEach(li => {
    const play = () => {
      const id    = li.dataset.id;
      const found = allResults.find(r => r.imdbID === id) || watchHistory.find(h => h.imdbID === id);
      if (found) playItem(found);
    };
    li.addEventListener('click', play);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); } });
  });
}

historyClearBtn?.addEventListener('click', () => {
  watchHistory = [];
  localStorage.setItem('watchHistory', JSON.stringify(watchHistory));
  renderHistoryList();
});

/* ── Recent searches ─────────────────────────────────────────────────────── */
function addRecentSearch(query) {
  recentSearches = recentSearches.filter(r => r.toLowerCase() !== query.toLowerCase());
  recentSearches.unshift(query);
  if (recentSearches.length > MAX_RECENT) recentSearches = recentSearches.slice(0, MAX_RECENT);
  localStorage.setItem('recentSearches', JSON.stringify(recentSearches));
  renderRecentList();
}

function renderRecentList() {
  if (!recentList) return;
  if (!recentSearches.length) {
    recentList.innerHTML = '<li class="sidebar-empty">No recent searches.</li>';
    return;
  }
  recentList.innerHTML = recentSearches.map(q => `
    <li class="sidebar-item recent-item" role="button" tabindex="0">
      <span class="sidebar-item-title">${q}</span>
    </li>`).join('');

  qsa('.recent-item', recentList).forEach((li, i) => {
    const doSearch = () => {
      searchInput.value = recentSearches[i];
      searchInput.dispatchEvent(new Event('input'));
      if (window.innerWidth <= MOBILE_BP) closeMobileSidebar();
    };
    li.addEventListener('click', doSearch);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doSearch(); } });
  });
}

recentClearBtn?.addEventListener('click', () => {
  recentSearches = [];
  localStorage.setItem('recentSearches', JSON.stringify(recentSearches));
  renderRecentList();
});

/* ── UI state ────────────────────────────────────────────────────────────── */
function showState(state) {
  emptyState.hidden       = state !== 'empty';
  skeletonWrap.hidden     = state !== 'loading';
  resultsContainer.hidden = state !== 'results';
  noResultsMsg.hidden     = state !== 'noresults';
  errorMsg.hidden         = state !== 'error';
  if (state !== 'results' && loadMoreWrap) loadMoreWrap.hidden = true;
}

/* ── Card badge / bookmark updaters ─────────────────────────────────────── */
function updateCardRating(imdbID, rating) {
  const badge = qs(`.card-rating-badge[data-id="${imdbID}"]`);
  if (badge && rating && rating !== 'N/A') {
    badge.textContent = `⭐ ${parseFloat(rating).toFixed(1)}`;
    badge.classList.add('visible');
  }
}

function updateCardBookmark(imdbID, bookmarked) {
  const btn = qs(`.card-bookmark-btn[data-id="${imdbID}"]`);
  if (btn) {
    btn.classList.toggle('active', bookmarked);
    btn.setAttribute('aria-label', bookmarked ? 'Remove from watchlist' : 'Add to watchlist');
  }
}

/* ── Play item (opens embed source in new tab) ──────────────────────────── */
function playItem(item, opts = {}) {
  if (!item || !item.imdbID) return;

  const isTV     = item.Type === 'series';
  const idx      = Number.isInteger(opts.sourceIdx) ? opts.sourceIdx : (sourceMemory[item.imdbID] ?? 0);
  const src      = EMBED_SOURCES[idx] || EMBED_SOURCES[0];
  const progress = getEpisodeProgress(item.imdbID);
  const season   = opts.season  || progress.season  || 1;
  const episode  = opts.episode || progress.episode || 1;

  const tpl = isTV ? src.tv : src.movie;
  const url = tpl
    .replace('{id}',      item.imdbID)
    .replace('{season}',  season)
    .replace('{episode}', episode);

  // Persist source preference + episode progress
  sourceMemory[item.imdbID] = idx;
  localStorage.setItem('sourceMemory', JSON.stringify(sourceMemory));
  if (isTV) saveEpisodeProgress(item.imdbID, season, episode);

  addToHistory(item);

  // Open the embed in a new tab via a synthesized <a target="_blank"> click.
  // This is the only method that:
  //   1. Survives popup blockers when inside a user gesture (card click, keypress).
  //   2. Doesn't return a spurious `null` when the browser strips the opener
  //      (as `window.open(..., 'noopener,noreferrer')` does in most modern
  //      browsers — which was causing the current tab to ALSO navigate).
  const a = document.createElement('a');
  a.href   = url;
  a.target = '_blank';
  a.rel    = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  announce(`Opening ${item.Title} in a new tab`);
}

/* ── Create card ─────────────────────────────────────────────────────────── */
function createCard(item, index) {
  const card = document.createElement('article');
  card.className = 'card';
  card.setAttribute('role', 'listitem');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${item.Title} (${item.Year || 'Unknown year'}). Press Enter to play.`);
  card.style.animationDelay = `${index * 30}ms`;

  const poster     = (item.Poster && item.Poster !== 'N/A') ? item.Poster : 'Assets/Images/dummy.svg';
  const bookmarked = isInWatchlist(item.imdbID);

  card.innerHTML = `
    <button class="card-bookmark-btn${bookmarked ? ' active' : ''}" data-id="${item.imdbID}"
      aria-label="${bookmarked ? 'Remove from watchlist' : 'Add to watchlist'}" title="Watchlist">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <path d="M5 3h14a1 1 0 0 1 1 1v17l-7-3-7 3V4a1 1 0 0 1 1-1z"/>
      </svg>
    </button>
    <div class="card-poster-wrap">
      <div class="card-shimmer"></div>
      <img class="card-poster" src="${poster}" alt="${item.Title} poster" loading="lazy" decoding="async" />
    </div>
    <div class="card-overlay" aria-hidden="true">
      <div class="card-overlay-actions">
        <div class="card-play-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
        </div>
        <button class="card-info-btn" aria-label="More info about ${item.Title}">i</button>
      </div>
    </div>
    <div class="card-info">
      <div class="card-title">${item.Title}</div>
      <div class="card-year">${item.Year || ''}</div>
    </div>`;

  // Poster shimmer
  const img     = qs('.card-poster', card);
  const shimmer = qs('.card-shimmer', card);

  function onPosterLoad() {
    shimmer.classList.add('done');
    img.removeEventListener('load',  onPosterLoad);
    img.removeEventListener('error', onPosterError);
  }
  function onPosterError() {
    if (!img.src.endsWith('dummy.svg')) img.src = 'Assets/Images/dummy.svg';
    shimmer.classList.add('done');
    img.removeEventListener('load',  onPosterLoad);
    img.removeEventListener('error', onPosterError);
  }
  img.addEventListener('load',  onPosterLoad);
  img.addEventListener('error', onPosterError);
  if (img.complete && img.naturalWidth) onPosterLoad();

  // Bookmark
  const bookmarkBtn = qs('.card-bookmark-btn', card);
  const stopAllBookmark = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  bookmarkBtn.addEventListener('pointerdown', stopAllBookmark);
  bookmarkBtn.addEventListener('mousedown',   stopAllBookmark);
  bookmarkBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    toggleWatchlist(item);
  });

  // Info button → detail modal
  // NOTE: We also stop propagation on pointerdown/mousedown so the card's
  // click handler can't fire synthetically on touch devices (which would
  // otherwise call playItem() and race with the modal opening).
  const infoBtn = qs('.card-info-btn', card);
  const stopAllInfo = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  infoBtn.addEventListener('pointerdown', stopAllInfo);
  infoBtn.addEventListener('mousedown',   stopAllInfo);
  infoBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    openDetailModal(item);
  });

  // Main click / keyboard → PLAY directly (new tab)
  // Guard: ignore clicks that originated inside the bookmark or info buttons
  // (defence-in-depth in case stopPropagation above was bypassed).
  card.addEventListener('click', e => {
    if (e.target.closest('.card-bookmark-btn, .card-info-btn')) return;
    playItem(item);
  });
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playItem(item); }
  });

  return card;
}

/* ── Render results ──────────────────────────────────────────────────────── */
const TYPE_LABELS = { movie: 'Movies', series: 'Series', other: 'Other' };
const TYPE_ORDER  = ['movie', 'series', 'other'];

function groupByType(items) {
  const groups = { movie: [], series: [], other: [] };
  items.forEach(item => {
    const key = item.Type === 'movie' ? 'movie'
              : item.Type === 'series' ? 'series'
              : 'other';
    groups[key].push(item);
  });
  return groups;
}

function renderResults() {
  resultsGrid.innerHTML = '';

  if (!filteredResults.length) {
    showState('noresults');
    return;
  }

  let globalIndex = 0;

  if (activeType === 'all') {
    resultsGrid.dataset.mode = 'sections';
    const groups = groupByType(filteredResults);
    const visible = TYPE_ORDER.filter(k => groups[k].length);

    visible.forEach(key => {
      const items = groups[key];
      const section = document.createElement('section');
      section.className = 'results-section';
      section.dataset.type = key;
      section.innerHTML = `
        <h3 class="results-section-title">
          <span class="results-section-dot" aria-hidden="true"></span>
          <span class="results-section-label">${TYPE_LABELS[key]}</span>
          <span class="results-section-count">${items.length}</span>
        </h3>
        <div class="results-section-grid" role="list"></div>
      `;
      const grid = section.querySelector('.results-section-grid');
      items.forEach(item => grid.appendChild(createCard(item, globalIndex++)));
      resultsGrid.appendChild(section);
    });
  } else {
    resultsGrid.dataset.mode = 'flat';
    const flatGrid = document.createElement('div');
    flatGrid.className = 'results-section-grid';
    flatGrid.setAttribute('role', 'list');
    filteredResults.forEach(item => flatGrid.appendChild(createCard(item, globalIndex++)));
    resultsGrid.appendChild(flatGrid);
  }

  showState('results');
  updateResultsCount();
  renderLoadMore();
}

function updateResultsCount() {
  if (!resultsCount) return;
  const total = Math.max(totalResults, filteredResults.length);
  resultsCount.textContent = total ? `${total} result${total !== 1 ? 's' : ''}` : '';
}

function renderLoadMore() {
  if (!loadMoreWrap) return;
  const shown = filteredResults.length;
  const total = Math.max(totalResults, shown);
  // Can still fetch more from the API if we haven't hit the total yet
  const canFetchMore = allResults.length < totalResults;
  if (loadMoreCount) loadMoreCount.textContent = `Showing ${shown} of ${total}`;
  loadMoreWrap.hidden = !canFetchMore;
  if (loadMoreBtn) loadMoreBtn.disabled = isLoading;
}

/* ── Filters ─────────────────────────────────────────────────────────────── */
function applyFilters() {
  const from = parseInt(yearFrom, 10) || 0;
  const to   = parseInt(yearTo,   10) || 9999;

  filteredResults = allResults.filter(item => {
    const typeOk = activeType === 'all' || item.Type === activeType;
    const year   = parseInt((item.Year || '').replace(/[^0-9]/g, ''), 10) || 0;
    const yearOk = (!from || year >= from) && (!to || to >= 9999 || year <= to);
    return typeOk && yearOk;
  });

  renderResults();
  filterResetBtn.hidden = activeType === 'all' && !yearFrom && !yearTo;
}

typePills.addEventListener('click', e => {
  const pill = e.target.closest('.filter-pill');
  if (!pill) return;
  qsa('.filter-pill', typePills).forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  activeType = pill.dataset.type;
  if (lastQuery) applyFilters();
});

yearFromInput?.addEventListener('input', () => { yearFrom = yearFromInput.value; if (lastQuery) applyFilters(); });
yearToInput?.addEventListener('input',   () => { yearTo   = yearToInput.value;   if (lastQuery) applyFilters(); });

filterResetBtn?.addEventListener('click', () => {
  activeType = 'all';
  yearFrom = yearTo = '';
  if (yearFromInput) yearFromInput.value = '';
  if (yearToInput)   yearToInput.value   = '';
  qsa('.filter-pill', typePills).forEach(p => p.classList.toggle('active', p.dataset.type === 'all'));
  if (lastQuery) applyFilters();
  filterResetBtn.hidden = true;
});

/* ── API fetch ───────────────────────────────────────────────────────────── */
async function fetchResults(query, page = 1, append = false) {
  if (isLoading) return;
  isLoading = true;
  if (loadMoreBtn) loadMoreBtn.disabled = true;

  const cacheKey = `${query}::${page}`;
  if (searchCache[cacheKey]) {
    const cached = searchCache[cacheKey];
    if (!append) allResults = [...cached.results]; else allResults.push(...cached.results);
    totalResults = cached.total;
    applyFilters();
    isLoading = false;
    if (loadMoreBtn) loadMoreBtn.disabled = false;
    announce(`${totalResults} results for "${query}"`);
    return;
  }

  if (!append) showState('loading');

  try {
    const res  = await fetch(`${API_BASE}?apikey=${API_KEY}&s=${encodeURIComponent(query)}&page=${page}`);
    const data = await res.json();

    if (data.Response === 'True') {
      // Drop individual episode entries — they clutter the grid when searching series
      const results = (data.Search || []).filter(r => r.Type !== 'episode');
      const total   = parseInt(data.totalResults, 10) || results.length;
      searchCache[cacheKey] = { results, total };
      if (!append) allResults = results; else allResults.push(...results);
      totalResults = total;
      applyFilters();
      announce(`${total} result${total !== 1 ? 's' : ''} for "${query}"`);
    } else {
      if (!append) {
        allResults = []; filteredResults = []; totalResults = 0;
        showState('noresults');
      }
    }
  } catch {
    if (!append) showState('error');
  } finally {
    isLoading = false;
    if (loadMoreBtn) loadMoreBtn.disabled = false;
  }
}

/* ── Load more (fetch next OMDB page, then re-render) ───────────────────── */
loadMoreBtn?.addEventListener('click', async () => {
  if (isLoading) return;
  if (allResults.length >= totalResults) return;
  const nextApiPage = Math.floor(allResults.length / 10) + 1;
  await fetchResults(lastQuery, nextApiPage, true);
});

/* ── Search ──────────────────────────────────────────────────────────────── */
function onSearchInput(e) {
  const val = e.target.value.trim();
  searchClear.hidden = !val;

  clearTimeout(debounceTimer);

  if (val.length < MIN_QUERY_LEN) {
    if (!val) { showState('empty'); hideSidebar(); lastQuery = ''; }
    return;
  }

  debounceTimer = setTimeout(async () => {
    if (val === lastQuery) return;
    lastQuery    = val;
    allResults   = [];
    filteredResults = [];
    addRecentSearch(val);
    showSidebar();
    await fetchResults(val, 1, false);
  }, DEBOUNCE_MS);
}

searchInput.addEventListener('input', onSearchInput);

function resetToHome({ focusSearch = false } = {}) {
  clearTimeout(debounceTimer);
  searchInput.value  = '';
  searchClear.hidden = true;
  lastQuery       = '';
  allResults      = [];
  filteredResults = [];
  totalResults    = 0;
  // Reset filters so "home" is truly clean
  activeType = 'all';
  yearFrom = yearTo = '';
  if (yearFromInput) yearFromInput.value = '';
  if (yearToInput)   yearToInput.value   = '';
  qsa('.filter-pill', typePills).forEach(p => p.classList.toggle('active', p.dataset.type === 'all'));
  if (filterResetBtn) filterResetBtn.hidden = true;
  // Close any open overlays
  if (detailModal.open) closeDetailModal();
  if (mobileSidebarOpen) closeMobileSidebar();
  showState('empty');
  hideSidebar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (focusSearch) searchInput.focus();
}

searchClear?.addEventListener('click', () => resetToHome({ focusSearch: true }));

/* ── Logo → go home ──────────────────────────────────────────────────────── */
const navLogo = qs('.nav-logo');
navLogo?.addEventListener('click', e => {
  e.preventDefault();
  resetToHome();
});

/* ── Hero chips (quick searches) ─────────────────────────────────────────── */
heroChips.forEach(chip => {
  chip.addEventListener('click', () => {
    const q = chip.dataset.q;
    if (!q) return;
    searchInput.value = q;
    searchInput.focus();
    searchInput.dispatchEvent(new Event('input'));
  });
});

/* ── Detail modal ────────────────────────────────────────────────────────── */
let detailOverlay = null;
let detailCleanup = null;

function ensureDetailOverlay() {
  if (detailOverlay) return detailOverlay;

  detailOverlay = document.createElement('div');
  detailOverlay.className = 'detail-overlay';
  detailOverlay.id        = 'detailOverlay';
  detailOverlay.setAttribute('role',            'dialog');
  detailOverlay.setAttribute('aria-modal',      'true');
  detailOverlay.setAttribute('aria-labelledby', 'detailTitle');
  detailOverlay.setAttribute('aria-hidden',     'true');

  detailOverlay.innerHTML = `
    <div class="detail-panel" id="detailPanel">
      <button class="detail-close" id="detailClose" aria-label="Close">×</button>
      <div class="detail-loading" id="detailLoading" aria-busy="true">
        <div class="detail-spinner"></div>
      </div>
      <div class="detail-body" id="detailBody" style="display:none"></div>
    </div>`;

  document.body.appendChild(detailOverlay);

  detailOverlay.addEventListener('click', e => {
    if (e.target === detailOverlay) closeDetailModal();
  });
  detailOverlay.querySelector('#detailClose').addEventListener('click', closeDetailModal);

  return detailOverlay;
}

async function openDetailModal(item) {
  const overlay    = ensureDetailOverlay();
  const loadingDiv = overlay.querySelector('#detailLoading');
  const bodyDiv    = overlay.querySelector('#detailBody');

  detailModal.open  = true;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  loadingDiv.style.display = '';
  bodyDiv.style.display    = 'none';
  bodyDiv.innerHTML        = '';
  updateBodyOverflow();
  detailCleanup = trapFocus(overlay);
  setTimeout(() => overlay.querySelector('#detailClose')?.focus(), 60);

  let data = detailCache[item.imdbID];
  if (!data) {
    try {
      const res = await fetch(`${API_BASE}?apikey=${API_KEY}&i=${item.imdbID}&plot=full`);
      data = await res.json();
      if (data.Response === 'True') detailCache[item.imdbID] = data;
    } catch {
      data = null;
    }
  }

  loadingDiv.style.display = 'none';
  bodyDiv.style.display    = '';

  if (!data || data.Response !== 'True') {
    bodyDiv.innerHTML = `<p class="detail-error" style="padding:28px 24px;color:var(--text-2)">Could not load details for <strong>${item.Title}</strong>.</p>`;
    return;
  }

  if (data.imdbRating) updateCardRating(item.imdbID, data.imdbRating);

  const poster     = (data.Poster && data.Poster !== 'N/A') ? data.Poster : 'Assets/Images/dummy.svg';
  const isTV       = data.Type === 'series';
  const imdbRating = data.imdbRating !== 'N/A' ? `⭐ ${data.imdbRating}/10` : '—';
  const bookmarked = isInWatchlist(item.imdbID);

  const metaItems = [
    ['Year',    data.Year],
    ['Rating',  imdbRating],
    ['Rated',   data.Rated    !== 'N/A' ? data.Rated    : null],
    ['Runtime', data.Runtime  !== 'N/A' ? data.Runtime  : null],
    ['Genre',   data.Genre    !== 'N/A' ? data.Genre    : null],
    ['Director', data.Director && data.Director !== 'N/A' ? data.Director : null],
    ['Cast',    data.Actors   !== 'N/A' ? data.Actors   : null],
    isTV ? ['Seasons', data.totalSeasons || '?'] : null,
  ].filter(Boolean).filter(([, v]) => v);

  bodyDiv.innerHTML = `
    <div class="detail-hero">
      <img class="detail-poster" src="${poster}" alt="${data.Title} poster" loading="lazy" />
      <div class="detail-info">
        <h2 class="detail-title" id="detailTitle">${data.Title}</h2>
        <div class="detail-meta">
          ${metaItems.map(([k, v]) => `<span class="detail-meta-item"><strong>${k}</strong>${v}</span>`).join('')}
        </div>
        ${data.Awards && data.Awards !== 'N/A' ? `<p class="detail-awards">🏆 ${data.Awards}</p>` : ''}
        <p class="detail-plot">${data.Plot || ''}</p>
        <div class="detail-actions">
          <button class="detail-act-btn detail-act-btn--primary" id="detailPlayBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
            Watch Now
          </button>
          <button class="detail-act-btn detail-act-btn--ghost" id="detailWlBtn">
            ${bookmarked ? '✓ In Watchlist' : '+ Watchlist'}
          </button>
        </div>
      </div>
    </div>`;

  bodyDiv.querySelector('#detailPlayBtn').addEventListener('click', () => {
    closeDetailModal();
    playItem(item);
  });

  const wlBtn = bodyDiv.querySelector('#detailWlBtn');
  wlBtn.addEventListener('click', () => {
    toggleWatchlist(item);
    wlBtn.textContent = isInWatchlist(item.imdbID) ? '✓ In Watchlist' : '+ Watchlist';
  });
}

function closeDetailModal() {
  if (!detailOverlay) return;
  detailOverlay.classList.remove('open');
  detailOverlay.setAttribute('aria-hidden', 'true');
  detailModal.open = false;
  if (detailCleanup) { detailCleanup(); detailCleanup = null; }
  updateBodyOverflow();
}

/* ── Keyboard shortcuts ──────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  // Escape: close overlays in priority order
  if (e.key === 'Escape') {
    if (detailModal.open) { closeDetailModal(); return; }
    if (!disclaimerModal.hidden) { hideDisclaimer(); return; }
    if (mobileSidebarOpen) { closeMobileSidebar(); return; }
    if (searchInput.value) { searchClear.click(); return; }
    return;
  }

  // '/' → focus search bar
  const tag = document.activeElement?.tagName;
  if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
    if (detailModal.open || !disclaimerModal.hidden) return;
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

/* ── Card keyboard navigation ────────────────────────────────────────────── */
function setupCardKeyboardNav() {
  resultsGrid.addEventListener('keydown', e => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const cards = qsa('.card', resultsGrid);
    const idx   = cards.indexOf(document.activeElement);
    if (idx === -1) return;
    e.preventDefault();

    const firstCard  = cards[0];
    const secondCard = cards[1];
    let cols = 4;
    if (firstCard && secondCard) {
      const r1 = firstCard.getBoundingClientRect();
      const r2 = secondCard.getBoundingClientRect();
      if (Math.abs(r1.top - r2.top) < 5) {
        cols = cards.filter(c => Math.abs(c.getBoundingClientRect().top - r1.top) < 5).length;
      }
    }

    let next = idx;
    if (e.key === 'ArrowRight') next = idx + 1;
    if (e.key === 'ArrowLeft')  next = idx - 1;
    if (e.key === 'ArrowDown')  next = idx + cols;
    if (e.key === 'ArrowUp')    next = idx - cols;

    if (next >= 0 && next < cards.length) cards[next].focus();
  });
}

/* ── Scroll to top ───────────────────────────────────────────────────────── */
function initScrollToTop() {
  if (!scrollTopBtn) return;
  window.addEventListener('scroll', () => {
    scrollTopBtn.hidden = window.scrollY < SCROLL_SHOW;
  }, { passive: true });
  scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* ── Init ────────────────────────────────────────────────────────────────── */
function init() {
  initTheme();
  registerSW();

  if (!localStorage.getItem('disclaimerShown')) {
    showDisclaimer();
  }

  renderRecentList();
  renderWatchlistSidebar();
  renderHistoryList();

  if (window.innerWidth > MOBILE_BP) {
    sidebar.setAttribute('inert', '');
  }

  initScrollToTop();
  setupCardKeyboardNav();
  showState('empty');

  window.addEventListener('resize', () => {
    if (window.innerWidth > MOBILE_BP) {
      sidebar.classList.remove('mobile-open');
      sidebarBackdrop.classList.remove('active');
      if (mobileSidebarOpen) {
        mobileSidebarOpen = false;
        sidebarToggle?.setAttribute('aria-expanded', 'false');
      }
      if (appLayout.classList.contains('searching')) {
        sidebar.removeAttribute('inert');
      }
    }
    updateBodyOverflow();
  });
}

document.addEventListener('DOMContentLoaded', init);
