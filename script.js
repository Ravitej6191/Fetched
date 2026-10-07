/* =============================================================================
   Fetched! — Main Script (Bento edition)
   Pure vanilla JS · OMDB API · localStorage persistence
   Card click = details · hover play button = open embed source in a new tab
============================================================================= */

'use strict';

/* ── Config ──────────────────────────────────────────────────────────────── */
const API_KEY            = 'b9b2061f';
const API_BASE           = 'https://www.omdbapi.com/';
const DEBOUNCE_MS        = 380;
const MAX_HISTORY        = 15;
const MAX_RECENT         = 8;
const MIN_QUERY_LEN      = 2;
const MOBILE_BP          = 900;
const SCROLL_SHOW        = 400;
const MAX_SEARCH_CACHE   = 60;   // max in-memory search cache entries
const MAX_DETAIL_CACHE   = 100;  // max in-memory detail cache entries
const MAX_SOURCE_MEMORY  = 500;  // max localStorage source preference entries

/* ── Embed sources (index 0 = default) ──────────────────────────────────── */
const EMBED_SOURCES = [
  {
    name: 'VidFast',
    movie: 'https://vidfast.pro/movie/{id}',
    tv:    'https://vidfast.pro/tv/{id}/{season}/{episode}',
  },
  {
    name: 'VidSrc',
    movie: 'https://vidsrc.pm/embed/movie?imdb={id}',
    tv:    'https://vidsrc.pm/embed/tv?imdb={id}&season={season}&episode={episode}',
  },
  {
    name: '2Embed',
    movie: 'https://www.2embed.cc/embed/{id}',
    tv:    'https://www.2embed.cc/embedtv/{id}&s={season}&e={episode}',
  },
  {
    name: 'AnyEmbed',
    movie: 'https://anyembed.xyz/embed/imdb-movie-{id}',
    tv:    'https://anyembed.xyz/embed/imdb-tv-{id}-{season}-{episode}',
  },
];

/* ── Helpers ─────────────────────────────────────────────────────────────── */
// localStorage can throw (private mode, blocked storage, quota): never let it break the app
const lsGet = key => { try { return localStorage.getItem(key); } catch { return null; } };
const lsSet = (key, value) => { try { localStorage.setItem(key, value); } catch { /* ignore */ } };

const safeJsonParse = (str, fallback) => {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
};

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const $   = id => document.getElementById(id);
const qs  = (sel, ctx = document) => ctx.querySelector(sel);
const qsa = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function announce(msg) {
  const region = $('srAnnounce');
  if (!region) return;
  region.textContent = '';
  requestAnimationFrame(() => { region.textContent = msg; });
}

/* ── Toast ───────────────────────────────────────────────────────────────── */
let toastTimer = null;

function hideToast() {
  const toast = $('toast');
  if (toast) toast.hidden = true;
  clearTimeout(toastTimer);
}

// actions: [{ label, run }] — rendered as buttons; the toast closes when one is used.
function showToast(message, actions = [], ms = 6000) {
  const toast = $('toast');
  if (!toast) return;
  $('toastMsg').textContent = message;
  const box = $('toastActions');
  box.innerHTML = '';
  actions.forEach(({ label, run }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => { hideToast(); run(); });
    box.appendChild(btn);
  });
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
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
let resizeTimer       = null;
let fetchAbortCtrl    = null;  // AbortController for the current search fetch
let currentPage       = 0;     // last OMDB page successfully loaded for lastQuery

// Persisted state
let watchHistory    = safeJsonParse(lsGet('watchHistory'),    []);
let recentSearches  = safeJsonParse(lsGet('recentSearches'),  []);
let watchlist       = safeJsonParse(lsGet('watchlist'),       []);
let sourceMemory    = safeJsonParse(lsGet('sourceMemory2'),    {});
let episodeProgress = safeJsonParse(lsGet('episodeProgress'), {});
let watchedEps      = safeJsonParse(lsGet('watchedEps'),      {});  // { imdbID: ["1:1", "1:2"] }

// In-memory caches
const searchCache = {};
const detailCache = {};
const seasonCache = {};  // `${imdbID}::${season}` → episode list

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
  if (save) lsSet('theme', theme);
}

function initTheme() {
  const saved = lsGet('theme');
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

/* ── Network status ──────────────────────────────────────────────────────── */
const offlineBar = $('offlineBar');

function updateNetworkStatus() {
  const offline = !navigator.onLine;
  if (offlineBar) offlineBar.hidden = !offline;
  document.body.classList.toggle('is-offline', offline);
}

window.addEventListener('online',  updateNetworkStatus, { passive: true });
window.addEventListener('offline', updateNetworkStatus, { passive: true });

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
  lsSet('disclaimerShown', '1');
  hideDisclaimer();
});
modalClose.addEventListener('click', () => {
  lsSet('disclaimerShown', '1');
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
  lsSet('watchlist', JSON.stringify(watchlist));
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
    <li class="sidebar-item" data-id="${escapeHtml(item.imdbID)}" role="button" tabindex="0" aria-label="${escapeHtml(item.Title)}">
      <span class="sidebar-item-title">${escapeHtml(item.Title)}</span>
      <span class="sidebar-item-year">${escapeHtml(item.Year || '')}</span>
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
  lsSet('watchlist', JSON.stringify(watchlist));
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
  lsSet('episodeProgress', JSON.stringify(episodeProgress));
}

function markWatched(imdbID, season, episode) {
  const key  = `${season}:${episode}`;
  const list = watchedEps[imdbID] || (watchedEps[imdbID] = []);
  if (!list.includes(key)) list.push(key);
  lsSet('watchedEps', JSON.stringify(watchedEps));
}

function isWatched(imdbID, season, episode) {
  return !!watchedEps[imdbID]?.includes(`${season}:${episode}`);
}

/* ── Watch history ───────────────────────────────────────────────────────── */
function addToHistory(item) {
  watchHistory = watchHistory.filter(h => h.imdbID !== item.imdbID);
  watchHistory.unshift({
    imdbID: item.imdbID,
    Title:  item.Title,
    Year:   item.Year,
    Poster: item.Poster,
    Type:   item.Type,
  });
  if (watchHistory.length > MAX_HISTORY) watchHistory = watchHistory.slice(0, MAX_HISTORY);
  lsSet('watchHistory', JSON.stringify(watchHistory));
  renderHistoryList();
  renderContinueRow();
}

function renderHistoryList() {
  if (!historyList) return;
  if (!watchHistory.length) {
    historyList.innerHTML = '<li class="sidebar-empty">Nothing watched yet.</li>';
    return;
  }
  historyList.innerHTML = watchHistory.map(item => `
    <li class="sidebar-item" data-id="${escapeHtml(item.imdbID)}" role="button" tabindex="0" aria-label="${escapeHtml(item.Title)}">
      <span class="sidebar-item-title">${escapeHtml(item.Title)}</span>
      <span class="sidebar-item-year">${escapeHtml(item.Year || '')}</span>
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
  lsSet('watchHistory', JSON.stringify(watchHistory));
  renderHistoryList();
  renderContinueRow();
});

/* ── Recent searches ─────────────────────────────────────────────────────── */
function addRecentSearch(query) {
  recentSearches = recentSearches.filter(r => r.toLowerCase() !== query.toLowerCase());
  recentSearches.unshift(query);
  if (recentSearches.length > MAX_RECENT) recentSearches = recentSearches.slice(0, MAX_RECENT);
  lsSet('recentSearches', JSON.stringify(recentSearches));
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
      <span class="sidebar-item-title">${escapeHtml(q)}</span>
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
  lsSet('recentSearches', JSON.stringify(recentSearches));
  renderRecentList();
});

/* ── UI state ────────────────────────────────────────────────────────────── */
function showState(state) {
  emptyState.hidden       = state !== 'empty';
  skeletonWrap.hidden     = state !== 'loading';
  resultsContainer.hidden = state !== 'results';
  const homeRows = $('homeRows');
  if (homeRows) homeRows.hidden = state !== 'empty';
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

  // Persist source preference (trim if oversized to avoid bloating localStorage)
  sourceMemory[item.imdbID] = idx;
  const smKeys = Object.keys(sourceMemory);
  if (smKeys.length > MAX_SOURCE_MEMORY) {
    smKeys.slice(0, smKeys.length - MAX_SOURCE_MEMORY).forEach(k => delete sourceMemory[k]);
  }
  lsSet('sourceMemory2', JSON.stringify(sourceMemory));
  if (isTV) {
    saveEpisodeProgress(item.imdbID, season, episode);
    markWatched(item.imdbID, parseInt(season, 10) || 1, parseInt(episode, 10) || 1);
  }

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
  showPlayToast(item, idx, season, episode);
}

/* ── Play feedback: retry on the next source / jump to the next episode ─── */
function showPlayToast(item, idx, season, episode) {
  const isTV    = item.Type === 'series';
  const label   = isTV ? `${item.Title} · S${season}E${episode}` : item.Title;
  const nextIdx = (idx + 1) % EMBED_SOURCES.length;
  const actions = [{
    label: `Not working? Try ${EMBED_SOURCES[nextIdx].name}`,
    run:   () => playItem(item, { sourceIdx: nextIdx, season, episode }),
  }];
  if (isTV) actions.push({ label: 'Next episode ▸', run: () => playNext(item) });
  showToast(`Opened ${label} on ${EMBED_SOURCES[idx]?.name || EMBED_SOURCES[0].name}`, actions, 15000);
}

async function getNextEpisode(item) {
  const { season, episode } = getEpisodeProgress(item.imdbID);
  const eps  = await loadSeason(item.imdbID, season);
  const last = eps ? Math.max(...eps.map(e => parseInt(e.Episode, 10) || 0)) : 0;
  if (last && episode >= last) {
    const detail = await getDetail(item.imdbID);
    const total  = parseInt(detail?.totalSeasons, 10) || season;
    return season < total ? { season: season + 1, episode: 1 } : null;
  }
  return { season, episode: episode + 1 };
}

async function playNext(item) {
  const next = await getNextEpisode(item);
  if (!next) { showToast('That was the last episode 🎉'); return; }
  playItem(item, next);
}

/* ── Create card ─────────────────────────────────────────────────────────── */
function createCard(item, index, opts = {}) {
  const card = document.createElement('article');
  card.className = 'card';
  card.setAttribute('role', 'listitem');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${item.Title} (${item.Year || 'Unknown year'}). Press Enter for details.`);
  card.style.animationDelay = `${index * 30}ms`;

  const poster     = (item.Poster && item.Poster !== 'N/A') ? item.Poster : 'Assets/Images/dummy.svg';
  const bookmarked = isInWatchlist(item.imdbID);
  const safeId     = escapeHtml(item.imdbID);
  const safeTitle  = escapeHtml(item.Title);
  const safeYear   = escapeHtml(opts.sub ?? item.Year ?? '');

  card.innerHTML = `
    <button class="card-bookmark-btn${bookmarked ? ' active' : ''}" data-id="${safeId}"
      aria-label="${bookmarked ? 'Remove from watchlist' : 'Add to watchlist'}" title="Watchlist">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <path d="M5 3h14a1 1 0 0 1 1 1v17l-7-3-7 3V4a1 1 0 0 1 1-1z"/>
      </svg>
    </button>
    <div class="card-poster-wrap">
      <div class="card-shimmer"></div>
      <img class="card-poster" src="${escapeHtml(poster)}" alt="${safeTitle} poster" loading="lazy" decoding="async" />
      <div class="card-rating-badge" data-id="${safeId}"></div>
    </div>
    <div class="card-overlay">
      <div class="card-overlay-actions">
        <button class="card-play-btn" aria-label="Play ${safeTitle}" title="Play">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="card-info">
      <div class="card-info-text">
        <div class="card-title">${safeTitle}</div>
        <div class="card-year">${safeYear}</div>
      </div>
      <button class="card-details-btn" aria-label="Details for ${safeTitle}" title="Details">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="9 6 15 12 9 18"/>
        </svg>
      </button>
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

  // Inner buttons handle their own clicks; the card itself opens the details.
  const onButton = (selector, action) => {
    const btn = qs(selector, card);
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      action();
    });
  };
  onButton('.card-bookmark-btn', () => toggleWatchlist(item));
  onButton('.card-play-btn',     () => playItem(item));
  onButton('.card-details-btn',  () => openDetailModal(item));

  card.addEventListener('click', () => openDetailModal(item));
  card.addEventListener('keydown', e => {
    if (e.target !== card) return;  // Enter on the inner buttons keeps its own action
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetailModal(item); }
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

function hasMorePages() {
  return currentPage > 0 && currentPage * 10 < totalResults;
}

function renderLoadMore() {
  if (!loadMoreWrap) return;
  const shown = filteredResults.length;
  const total = Math.max(totalResults, shown);
  // Can still fetch more from the API if we haven't hit the total yet
  const canFetchMore = hasMorePages();
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
  // The type filter is applied by the API so every page of results matches it
  if (lastQuery) {
    allResults = []; currentPage = 0;
    fetchResults(lastQuery, 1, false);
  }
});

yearFromInput?.addEventListener('input', () => {
  yearFrom = yearFromInput.value;
  if (yearFrom && yearTo && parseInt(yearFrom, 10) > parseInt(yearTo, 10)) {
    yearTo = yearFrom;
    yearToInput.value = yearFrom;
  }
  if (lastQuery) applyFilters();
});
yearToInput?.addEventListener('input', () => {
  yearTo = yearToInput.value;
  if (yearFrom && yearTo && parseInt(yearTo, 10) < parseInt(yearFrom, 10)) {
    yearFrom = yearTo;
    yearFromInput.value = yearTo;
  }
  if (lastQuery) applyFilters();
});

filterResetBtn?.addEventListener('click', () => {
  activeType = 'all';
  yearFrom = yearTo = '';
  if (yearFromInput) yearFromInput.value = '';
  if (yearToInput)   yearToInput.value   = '';
  qsa('.filter-pill', typePills).forEach(p => p.classList.toggle('active', p.dataset.type === 'all'));
  if (lastQuery) { allResults = []; currentPage = 0; fetchResults(lastQuery, 1, false); }
  filterResetBtn.hidden = true;
});

/* ── API fetch ───────────────────────────────────────────────────────────── */
async function fetchJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchResults(query, page = 1, append = false) {
  // "Load more" waits for the in-flight request; a fresh search aborts it.
  if (append && isLoading) return;

  if (!append && fetchAbortCtrl) fetchAbortCtrl.abort();
  fetchAbortCtrl = new AbortController();
  const { signal } = fetchAbortCtrl;

  isLoading = true;
  if (loadMoreBtn) loadMoreBtn.disabled = true;

  const applyPage = (results, total) => {
    if (!append) allResults = [...results]; else allResults.push(...results);
    totalResults = total;
    currentPage  = page;
    applyFilters();
    announce(`${total} result${total !== 1 ? 's' : ''} for "${query}"`);
  };

  const typeParam = activeType === 'all' ? '' : `&type=${activeType}`;
  const cacheKey  = `${query}::${activeType}::${page}`;
  if (searchCache[cacheKey]) {
    applyPage(searchCache[cacheKey].results, searchCache[cacheKey].total);
    isLoading = false;
    if (loadMoreBtn) loadMoreBtn.disabled = false;
    return;
  }

  if (!append) showState('loading');

  try {
    const data = await fetchJson(`${API_BASE}?apikey=${API_KEY}&s=${encodeURIComponent(query)}&page=${page}${typeParam}`, signal);
    if (query !== lastQuery) return;  // superseded by a newer search

    if (data.Response === 'True') {
      // Drop individual episode entries — they clutter the grid when searching series
      const results = (data.Search || []).filter(r => r.Type !== 'episode');
      const total   = parseInt(data.totalResults, 10) || results.length;
      searchCache[cacheKey] = { results, total };

      // Evict oldest entries once the cache grows beyond the limit
      const cacheKeys = Object.keys(searchCache);
      if (cacheKeys.length > MAX_SEARCH_CACHE) {
        cacheKeys.slice(0, cacheKeys.length - MAX_SEARCH_CACHE).forEach(k => delete searchCache[k]);
      }
      applyPage(results, total);
    } else if (/limit/i.test(data.Error || '')) {
      if (!append) showState('error');
    } else if (!append) {
      allResults = []; filteredResults = []; totalResults = 0; currentPage = 0;
      showState('noresults');
    }
  } catch (err) {
    if (err.name === 'AbortError') return;  // superseded; the newer request owns isLoading
    if (!append) showState('error');
  } finally {
    // Only the latest request may clear the loading flag
    if (signal === fetchAbortCtrl.signal) {
      isLoading = false;
      if (loadMoreBtn) loadMoreBtn.disabled = false;
    }
  }
}

/* ── Load more (fetch next OMDB page, then re-render) ───────────────────── */
loadMoreBtn?.addEventListener('click', async () => {
  if (isLoading || !hasMorePages()) return;
  await fetchResults(lastQuery, currentPage + 1, true);
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
    currentPage  = 0;
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
  currentPage     = 0;
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
let detailToken   = 0;  // guards against a slow response for an earlier title

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

  // Swipe down to dismiss (bottom-sheet layout on phones)
  const panel = detailOverlay.querySelector('#detailPanel');
  let startY = null, dy = 0;
  panel.addEventListener('touchstart', e => {
    if (window.innerWidth > 700 || panel.scrollTop > 0) return;
    startY = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (startY === null) return;
    dy = e.touches[0].clientY - startY;
    if (dy > 0) { panel.style.transition = 'none'; panel.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  panel.addEventListener('touchend', () => {
    if (startY === null) return;
    panel.style.transition = ''; panel.style.transform = '';
    if (dy > 110) closeDetailModal();
    startY = null; dy = 0;
  });

  return detailOverlay;
}

// Full OMDB record for a title (cached). Resolves to null when unavailable.
async function getDetail(imdbID) {
  if (detailCache[imdbID]) return detailCache[imdbID];
  try {
    const data = await fetchJson(`${API_BASE}?apikey=${API_KEY}&i=${imdbID}&plot=full`);
    if (data.Response !== 'True') return null;
    detailCache[imdbID] = data;
    // Evict oldest detail entries once the cache grows beyond the limit
    const dKeys = Object.keys(detailCache);
    if (dKeys.length > MAX_DETAIL_CACHE) {
      dKeys.slice(0, dKeys.length - MAX_DETAIL_CACHE).forEach(k => delete detailCache[k]);
    }
    return data;
  } catch {
    return null;
  }
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
  if (detailCleanup) detailCleanup();
  detailCleanup = trapFocus(overlay);
  const token = ++detailToken;
  setTimeout(() => overlay.querySelector('#detailClose')?.focus(), 60);

  const data = await getDetail(item.imdbID);
  if (token !== detailToken || !detailModal.open) return;  // closed or replaced while loading

  loadingDiv.style.display = 'none';
  bodyDiv.style.display    = '';

  if (!data) {
    bodyDiv.innerHTML = `<p class="detail-error" style="padding:28px 24px;color:var(--text-2)">Could not load details for <strong>${escapeHtml(item.Title)}</strong>.</p>`;
    return;
  }

  if (data.imdbRating) updateCardRating(item.imdbID, data.imdbRating);

  const poster     = (data.Poster && data.Poster !== 'N/A') ? data.Poster : 'Assets/Images/dummy.svg';
  const isTV       = data.Type === 'series';
  const imdbRating = data.imdbRating !== 'N/A' ? `⭐ ${escapeHtml(data.imdbRating)}/10` : '—';
  const bookmarked = isInWatchlist(item.imdbID);

  // Compact popup: a few chips, then one line each for genre and cast
  const known = v => (v && v !== 'N/A' ? v : null);
  const metaItems = [
    ['Year',    data.Year],
    ['IMDb',    imdbRating],
    ['Rated',   known(data.Rated)],
    ['Runtime', known(data.Runtime)],
    isTV ? ['Seasons', data.totalSeasons || '?'] : null,
  ].filter(Boolean).filter(([, v]) => v);
  const genre = known(data.Genre);
  const cast  = known(data.Actors);
  const award = known(data.Awards);

  bodyDiv.innerHTML = `
    <div class="detail-hero">
      <img class="detail-poster" src="${escapeHtml(poster)}" alt="${escapeHtml(data.Title)} poster" loading="lazy" />
      <div class="detail-info">
        <h2 class="detail-title" id="detailTitle">${escapeHtml(data.Title)}</h2>
        <div class="detail-meta">
          ${metaItems.map(([k, v]) => `<span class="detail-meta-item"><strong>${k}</strong>${escapeHtml(v)}</span>`).join('')}
        </div>
        ${genre ? `<p class="detail-line">${escapeHtml(genre.split(', ').join(' · '))}</p>` : ''}
        ${cast  ? `<p class="detail-line detail-line--dim" title="${escapeHtml(cast)}"><strong>Cast</strong> ${escapeHtml(cast)}</p>` : ''}
        ${award ? `<p class="detail-awards" title="${escapeHtml(award)}">🏆 ${escapeHtml(award)}</p>` : ''}
        <p class="detail-plot" title="${escapeHtml(data.Plot || '')}">${escapeHtml(data.Plot || '')}</p>
        ${isTV ? `
        <div class="detail-episodes">
          <label class="detail-ep-field">Season
            <select id="detailSeason" aria-label="Season"></select>
          </label>
          <label class="detail-ep-field detail-ep-field--wide">Episode
            <select id="detailEpisode" aria-label="Episode"></select>
          </label>
        </div>` : ''}
        <div class="detail-actions">
          <button class="detail-act-btn detail-act-btn--primary" id="detailPlayBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
            Watch Now
          </button>
          <select class="detail-act-btn detail-act-btn--ghost" id="detailSource" aria-label="Streaming source">
            ${EMBED_SOURCES.map((src, i) => `<option value="${i}"${i === (sourceMemory[item.imdbID] ?? 0) ? ' selected' : ''}>${escapeHtml(src.name)}</option>`).join('')}
          </select>
          <button class="detail-act-btn detail-act-btn--ghost" id="detailWlBtn">
            ${bookmarked ? '✓ In Watchlist' : '+ Watchlist'}
          </button>
        </div>
      </div>
    </div>`;

  bodyDiv.querySelector('#detailPlayBtn').addEventListener('click', () => {
    const sourceIdx = parseInt(bodyDiv.querySelector('#detailSource').value, 10);
    const opts = { sourceIdx };
    if (isTV) {
      opts.season  = parseInt(seasonSel.value, 10)  || 1;
      opts.episode = parseInt(episodeSel.value, 10) || 1;
    }
    closeDetailModal();
    playItem(item, opts);
  });

  // Season / episode picker (series only)
  const seasonSel  = bodyDiv.querySelector('#detailSeason');
  const episodeSel = bodyDiv.querySelector('#detailEpisode');
  if (isTV) setupEpisodePicker(item.imdbID, parseInt(data.totalSeasons, 10) || 1, seasonSel, episodeSel);

  const wlBtn = bodyDiv.querySelector('#detailWlBtn');
  wlBtn.addEventListener('click', () => {
    toggleWatchlist(item);
    wlBtn.textContent = isInWatchlist(item.imdbID) ? '✓ In Watchlist' : '+ Watchlist';
  });
}

async function loadSeason(imdbID, season) {
  const key = `${imdbID}::${season}`;
  if (seasonCache[key]) return seasonCache[key];
  try {
    const d = await fetchJson(`${API_BASE}?apikey=${API_KEY}&i=${imdbID}&Season=${season}`);
    if (d.Response === 'True' && Array.isArray(d.Episodes) && d.Episodes.length) {
      seasonCache[key] = d.Episodes;
      return d.Episodes;
    }
  } catch { /* fall through to numeric fallback */ }
  return null;
}

function setupEpisodePicker(imdbID, totalSeasons, seasonSel, episodeSel) {
  const progress = getEpisodeProgress(imdbID);
  const seasonCount = Math.max(totalSeasons, progress.season);
  seasonSel.innerHTML = Array.from({ length: seasonCount }, (_, i) =>
    `<option value="${i + 1}">Season ${i + 1}</option>`).join('');
  seasonSel.value = String(progress.season);

  async function fillEpisodes(season, selectedEp) {
    episodeSel.disabled = true;
    episodeSel.innerHTML = '<option>Loading…</option>';
    const eps = await loadSeason(imdbID, season);
    if (parseInt(seasonSel.value, 10) !== season) return;  // user changed season meanwhile
    const list = eps
      ? eps.map(e => ({ n: parseInt(e.Episode, 10), t: e.Title }))
      : Array.from({ length: 30 }, (_, i) => ({ n: i + 1, t: '' }));  // API gave nothing: plain numbers
    episodeSel.innerHTML = list.map(e =>
      `<option value="${e.n}">${isWatched(imdbID, season, e.n) ? '✓ ' : ''}E${e.n}${e.t && e.t !== 'N/A' ? ' · ' + escapeHtml(e.t) : ''}</option>`).join('');
    const hasSel = list.some(e => e.n === selectedEp);
    episodeSel.value = String(hasSel ? selectedEp : list[0].n);
    episodeSel.disabled = false;
  }

  seasonSel.addEventListener('change', () => fillEpisodes(parseInt(seasonSel.value, 10), 1));
  fillEpisodes(progress.season, progress.episode);
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

/* ── Home rails ──────────────────────────────────────────────────────────── */
// OMDB has no "trending" endpoint, so these are hand-picked IMDb ids. Posters
// and details are fetched once and cached for a day.
const POPULAR_IDS = [
  'tt1375666', 'tt0816692', 'tt15398776', 'tt0903747', 'tt0944947', 'tt4574334',
  'tt0468569', 'tt1160419', 'tt1745960', 'tt9362722', 'tt6751668', 'tt7366338',
  'tt0386676', 'tt2861424', 'tt0111161',
];
const ANIME_IDS = [
  'tt2560140', 'tt0877057', 'tt1355642', 'tt0388629', 'tt0409591', 'tt9335498',
  'tt12343534', 'tt0213338', 'tt4508902', 'tt5626028', 'tt5311514', 'tt0245429',
  'tt2098220', 'tt1910272', 'tt10233448',
];
const CURATED_TTL = 24 * 60 * 60 * 1000;

function renderRail(rail, items, subFn) {
  rail.innerHTML = '';
  items.forEach((item, i) => rail.appendChild(createCard(item, i, subFn ? { sub: subFn(item) } : {})));
}

function renderContinueRow() {
  const row  = $('continueRow');
  const rail = $('continueRail');
  if (!row || !rail) return;
  row.hidden = !watchHistory.length;
  if (!watchHistory.length) return;

  // Entries saved before posters were stored: backfill once, then re-render
  const missing = watchHistory.slice(0, 10).filter(h => !h.Poster);
  if (missing.length && !renderContinueRow.backfilling) {
    renderContinueRow.backfilling = true;
    Promise.all(missing.map(async h => {
      const d = await getDetail(h.imdbID);
      h.Poster = d?.Poster || 'N/A';
    })).then(() => {
      lsSet('watchHistory', JSON.stringify(watchHistory));
      renderContinueRow.backfilling = false;
      renderContinueRow();
    });
  }
  renderRail(rail, watchHistory.slice(0, 10), item => {
    if (item.Type !== 'series') return item.Year || '';
    const p = getEpisodeProgress(item.imdbID);
    return `S${p.season} · E${p.episode}`;
  });
}

async function loadCuratedRow(key, ids, rowId, railId) {
  const row  = $(rowId);
  const rail = $(railId);
  if (!row || !rail) return;

  const cached = safeJsonParse(lsGet(`curated_${key}`), null);
  let items = cached && Date.now() - cached.t < CURATED_TTL ? cached.items : null;

  if (!items) {
    const results = await Promise.allSettled(ids.map(getDetail));
    items = results
      .map(r => r.value)
      .filter(Boolean)
      .map(d => ({ imdbID: d.imdbID, Title: d.Title, Year: d.Year, Poster: d.Poster, Type: d.Type }));
    if (items.length >= Math.ceil(ids.length * 0.8)) lsSet(`curated_${key}`, JSON.stringify({ t: Date.now(), items }));
  }

  if (!items.length) { row.hidden = true; return; }  // offline / API limit: hide quietly
  renderRail(rail, items);
}

function initHome() {
  renderContinueRow();
  // Load after first paint so the search box is interactive immediately
  const load = () => {
    loadCuratedRow('popular', POPULAR_IDS, 'popularRow', 'popularRail');
    loadCuratedRow('anime',   ANIME_IDS,   'animeRow',   'animeRail');
  };
  if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 1500 }); else setTimeout(load, 300);
}

/* ── Backup: export / import lists ───────────────────────────────────────── */
const BACKUP_KEYS = {
  watchlist:       () => watchlist,
  watchHistory:    () => watchHistory,
  episodeProgress: () => episodeProgress,
  watchedEps:      () => watchedEps,
};

async function exportData() {
  const payload = { app: 'fetched', version: 1, exportedAt: new Date().toISOString() };
  Object.entries(BACKUP_KEYS).forEach(([k, get]) => { payload[k] = get(); });
  const json = JSON.stringify(payload, null, 2);
  const file = new File([json], 'fetched-backup.json', { type: 'application/json' });

  // Native / mobile: use the share sheet when it can take files
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Fetched! backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = 'fetched-backup.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  showToast('Backup saved');
}

const IMDB_ID = /^tt\d{5,12}$/;

// Imported files are untrusted: keep only known fields, with safe values
function cleanItem(x) {
  if (!x || typeof x.imdbID !== 'string' || !IMDB_ID.test(x.imdbID) || typeof x.Title !== 'string') return null;
  return {
    imdbID: x.imdbID,
    Title:  x.Title.slice(0, 200),
    Year:   String(x.Year ?? '').slice(0, 12),
    Poster: typeof x.Poster === 'string' && /^https:\/\/[^\s"'<>`]+$/.test(x.Poster) ? x.Poster.slice(0, 500) : 'N/A',
    Type:   x.Type === 'series' ? 'series' : 'movie',
  };
}

function importData(text) {
  let data;
  try { data = JSON.parse(text); } catch { showToast('That file is not valid JSON'); return; }
  if (!data || data.app !== 'fetched') { showToast('Not a Fetched! backup file'); return; }

  const pickItems = arr => (Array.isArray(arr) ? arr.map(cleanItem).filter(Boolean) : []);
  const mergeItems = (mine, theirs) => {
    const seen = new Set(mine.map(i => i.imdbID));
    return [...mine, ...theirs.filter(i => !seen.has(i.imdbID))];
  };

  watchlist    = mergeItems(watchlist, pickItems(data.watchlist));
  watchHistory = mergeItems(watchHistory, pickItems(data.watchHistory)).slice(0, MAX_HISTORY);

  if (data.episodeProgress && typeof data.episodeProgress === 'object') {
    Object.entries(data.episodeProgress).forEach(([id, p]) => {
      if (IMDB_ID.test(id) && !episodeProgress[id] && p && Number.isFinite(+p.season) && Number.isFinite(+p.episode)) {
        episodeProgress[id] = { season: +p.season, episode: +p.episode };
      }
    });
  }
  if (data.watchedEps && typeof data.watchedEps === 'object') {
    Object.entries(data.watchedEps).forEach(([id, list]) => {
      if (!IMDB_ID.test(id) || !Array.isArray(list)) return;
      const merged = new Set([...(watchedEps[id] || []), ...list.filter(k => /^\d+:\d+$/.test(k))]);
      watchedEps[id] = [...merged];
    });
  }

  lsSet('watchlist',       JSON.stringify(watchlist));
  lsSet('watchHistory',    JSON.stringify(watchHistory));
  lsSet('episodeProgress', JSON.stringify(episodeProgress));
  lsSet('watchedEps',      JSON.stringify(watchedEps));
  renderWatchlistSidebar();
  renderHistoryList();
  renderContinueRow();
  showToast('Backup imported');
}

$('exportBtn')?.addEventListener('click', exportData);
$('importBtn')?.addEventListener('click', () => $('importFile')?.click());
$('importFile')?.addEventListener('change', async e => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('That file is too large'); return; }
  importData(await file.text());
});

/* ── Swipe the filters drawer shut on phones ─────────────────────────────── */
function initSidebarSwipe() {
  let x0 = null, y0 = 0;
  sidebar.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  sidebar.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (mobileSidebarOpen && dx < -60 && Math.abs(dy) < 50) closeMobileSidebar();
  });
}

/* ── Init ────────────────────────────────────────────────────────────────── */
function init() {
  initTheme();
  registerSW();

  if (!lsGet('disclaimerShown')) {
    showDisclaimer();
  }

  renderRecentList();
  renderWatchlistSidebar();
  renderHistoryList();

  sidebar.setAttribute('inert', '');

  initScrollToTop();
  setupCardKeyboardNav();
  initSidebarSwipe();
  initHome();
  showState('empty');
  updateNetworkStatus();

  // Debounced resize — layout recalcs are expensive; 100 ms is imperceptible
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
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
    }, 100);
  }, { passive: true });
}

document.addEventListener('DOMContentLoaded', init);
