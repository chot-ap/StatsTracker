/**
 * ScoreTrack 4 - Viewer Logic (Read-Only)
 * リアルタイム速報・戦績閲覧専用スクリプト
 */

const SUPABASE_CONFIG = {
  url: 'https://tylydgydwvnuhleyyyyg.supabase.co',
  anonKey: 'sb_publishable_qdkKE_ECqK7bzqqHMEKB9Q_3K774vyQ'
};

const SEAT_LABELS = ['東 (起家)', '南', '西', '北'];
const SEAT_SHORT = ['東', '南', '西', '北'];
const SEAT_COLORS = ['text-blue-400', 'text-red-400', 'text-amber-400', 'text-emerald-400'];

let supabaseClient = null;
let realtimeChannel = null;

let viewerState = {
  players: [],
  sessions: [],
  matches: [],
  currentSessionId: null,
  activeTab: 'live',
  statsSort: {
    column: 'totalScore',
    direction: 'desc'
  },
  statsLocationFilter: 'ALL'
};

// ============================================================================
// Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  parseUrlParams();
  loadViewerLocalCache(); // キャッシュがあれば即座に初期描画
  initSupabaseViewer();
});

// URLパラメータからセッション指定を取得
function parseUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const requestedSession = urlParams.get('session');
  if (requestedSession) {
    viewerState.currentSessionId = requestedSession;
  }
}

// ローカルキャッシュの先行読み込み（白画面・読み込み中のままを防止）
function loadViewerLocalCache() {
  try {
    let rawSessions = localStorage.getItem('scoretrack_viewer_sessions');
    let rawPlayers = localStorage.getItem('scoretrack_viewer_players');
    let rawMatches = localStorage.getItem('scoretrack_viewer_matches');

    if (!rawSessions) {
      rawSessions = localStorage.getItem('scoretrack_sessions');
      rawPlayers = localStorage.getItem('scoretrack_players');
      rawMatches = localStorage.getItem('scoretrack_matches');
    }

    if (rawSessions) {
      const parsedSessions = JSON.parse(rawSessions) || [];
      const parsedPlayers = JSON.parse(rawPlayers) || [];
      const parsedMatches = JSON.parse(rawMatches) || [];

      if (parsedSessions.length > 0) {
        viewerState.sessions = parsedSessions;
        viewerState.players = parsedPlayers;
        viewerState.matches = parsedMatches.map(m => {
          let recs = m.records || [];
          if (typeof recs === 'string') {
            try { recs = JSON.parse(recs); } catch (e) { recs = []; }
          }
          return {
            ...m,
            records: (recs || []).map(r => ({
              ...r,
              score: (r.score !== undefined && r.score !== null && r.score !== '') ? (parseFloat(r.score) || 0) : 0,
              rank: parseInt(r.manualRank || r.rank, 10) || null
            }))
          };
        });

        if (!viewerState.currentSessionId || !viewerState.sessions.some(s => s.id === viewerState.currentSessionId)) {
          viewerState.currentSessionId = viewerState.sessions[0].id;
        }

        renderViewer();
        updateViewerStatus('syncing', 'クラウド同期中...');
      }
    }
  } catch (err) {
    console.warn('Viewer: Local cache read failed', err);
  }
}

function saveViewerLocalCache() {
  try {
    localStorage.setItem('scoretrack_viewer_sessions', JSON.stringify(viewerState.sessions));
    localStorage.setItem('scoretrack_viewer_players', JSON.stringify(viewerState.players));
    localStorage.setItem('scoretrack_viewer_matches', JSON.stringify(viewerState.matches));
  } catch (e) {}
}

// テーマ管理（Dark / Light）
function initTheme() {
  const savedTheme = localStorage.getItem('scoretrack_theme');
  if (savedTheme === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    document.documentElement.classList.add('dark');
  }
  updateThemeIcons();
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  if (isDark) {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('scoretrack_theme', 'light');
  } else {
    document.documentElement.classList.add('dark');
    localStorage.setItem('scoretrack_theme', 'dark');
  }
  updateThemeIcons();
}

function updateThemeIcons() {
  const isDark = document.documentElement.classList.contains('dark');
  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');
  if (sunIcon && moonIcon) {
    if (isDark) {
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    } else {
      sunIcon.classList.remove('hidden');
      moonIcon.classList.add('hidden');
    }
  }
  lucide.createIcons();
}

// ============================================================================
// Supabase Viewer Client (Read-Only)
// ============================================================================
let initRetryCount = 0;
function initSupabaseViewer() {
  if (window.supabase) {
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
      fetchViewerData();
      setupRealtimeViewer();
    } catch (err) {
      console.error('Viewer: Supabase init error', err);
      updateViewerStatus('error', '接続エラー');
      renderViewerFetchError('Supabase初期化に失敗しました');
    }
  } else {
    initRetryCount++;
    if (initRetryCount <= 15) {
      // CDN読み込み遅延に備えて200msごとにリトライ（最大3秒）
      setTimeout(initSupabaseViewer, 200);
    } else {
      console.error('Viewer: Supabase SDK could not be loaded');
      updateViewerStatus('error', 'SDK未読込');
      renderViewerFetchError('Supabaseライブラリの読み込みに失敗しました。電波環境をご確認の上、再読み込みしてください。');
    }
  }
}

function updateViewerStatus(status, text) {
  const badge = document.getElementById('viewer-status-badge');
  const label = document.getElementById('viewer-status-text');
  if (!badge || !label) return;

  if (status === 'syncing') {
    badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold';
    label.textContent = text || 'データ受信中...';
  } else if (status === 'live') {
    badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold';
    label.textContent = text || 'リアルタイム速報中';
  } else if (status === 'error') {
    badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold';
    label.textContent = text || 'オフライン';
  }
}

// タイムアウト付きPromiseヘルパー（通信ハングを防止）
function fetchWithTimeout(promise, ms = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`通信がタイムアウトしました (${ms / 1000}秒)`));
    }, ms);
    promise
      .then(res => { clearTimeout(timer); resolve(res); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

// Fetch all necessary data
async function fetchViewerData(isManual = false) {
  if (!supabaseClient) {
    if (window.supabase) {
      try {
        supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
      } catch (e) {}
    }
    if (!supabaseClient) {
      updateViewerStatus('error', 'SDK未接続');
      renderViewerFetchError('クラウドへの接続が確立されていません');
      return;
    }
  }

  const refreshIcon = document.getElementById('viewer-refresh-icon');
  if (refreshIcon) refreshIcon.classList.add('animate-spin');
  updateViewerStatus('syncing', 'データ取得中...');

  try {
    const fetchPromises = Promise.all([
      supabaseClient.from('players').select('*'),
      supabaseClient.from('sessions').select('*'),
      supabaseClient.from('matches').select('*'),
      supabaseClient.from('settlements').select('*')
    ]);

    const [pRes, sRes, mRes, setRes] = await fetchWithTimeout(fetchPromises, 8000);

    if (pRes.error || sRes.error || mRes.error || setRes.error) {
      throw pRes.error || sRes.error || mRes.error || setRes.error;
    }

    const cloudPlayers = pRes.data || [];
    const cloudSessions = sRes.data || [];
    const cloudMatches = mRes.data || [];
    const cloudSettlements = setRes.data || [];

    viewerState.players = cloudPlayers.map(p => ({
      id: p.id,
      name: p.name,
      createdAt: p.created_at
    }));

    const settlementsMap = {};
    cloudSettlements.forEach(st => {
      settlementsMap[st.session_id] = st.details;
    });

    viewerState.sessions = cloudSessions.map(s => {
      let pIds = s.player_ids;
      if (typeof pIds === 'string') {
        try { pIds = JSON.parse(pIds); } catch (e) { pIds = []; }
      } else if (!Array.isArray(pIds)) {
        pIds = [];
      }
      return {
        id: s.id,
        date: s.date,
        location: s.location || '',
        memo: s.memo || '',
        playerIds: pIds,
        tableFee: parseFloat(s.table_fee) || 0,
        rate: parseFloat(s.rate) || 100,
        createdAt: s.created_at,
        settlement: settlementsMap[s.id] || { rate: parseFloat(s.rate) || 100, tableFee: parseFloat(s.table_fee) || 0, players: {} }
      };
    });

    // Sort sessions by date desc, then created_at desc
    viewerState.sessions.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));

    viewerState.matches = cloudMatches.map(m => {
      let recs = m.records;
      if (typeof recs === 'string') {
        try { recs = JSON.parse(recs); } catch (e) { recs = []; }
      } else if (!Array.isArray(recs)) {
        recs = [];
      }
      // スコアを確実に数値型へ正規化
      recs = recs.map(r => ({
        ...r,
        score: (r.score !== undefined && r.score !== null && r.score !== '') ? (parseFloat(r.score) || 0) : 0,
        rank: parseInt(r.manualRank || r.rank, 10) || null
      }));

      return {
        id: m.id,
        sessionId: m.session_id,
        roundNumber: parseInt(m.roundNumber || m.round_number, 10) || 1,
        records: recs,
        createdAt: m.created_at
      };
    });

    // Select active session
    if (!viewerState.currentSessionId || !viewerState.sessions.some(s => s.id === viewerState.currentSessionId)) {
      viewerState.currentSessionId = viewerState.sessions[0]?.id || null;
    }

    saveViewerLocalCache();

    renderViewer();
    updateViewerStatus('live', 'リアルタイム速報中');
    const lastUpdated = document.getElementById('live-last-updated');
    if (lastUpdated) {
      lastUpdated.textContent = new Date().toLocaleTimeString();
    }

    if (isManual) {
      showToast('最新データを反映しました', 'success');
    }
  } catch (err) {
    console.error('fetchViewerData error:', err);
    updateViewerStatus('error', '取得失敗');
    if (viewerState.sessions.length === 0) {
      renderViewerFetchError(err.message || 'データ取得に失敗しました');
    }
    if (isManual) showToast('データの取得に失敗しました: ' + (err.message || ''), 'error');
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('animate-spin');
  }
}

function renderViewerFetchError(msg) {
  const select = document.getElementById('viewer-session-select');
  if (select && viewerState.sessions.length === 0) {
    select.innerHTML = '<option value="">データ取得失敗</option>';
  }
  const grid = document.getElementById('live-standings-grid');
  if (grid && viewerState.sessions.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-400 bg-dark-850 border border-slate-800 rounded-2xl">
        <i data-lucide="alert-circle" class="w-10 h-10 mx-auto mb-2 text-rose-400"></i>
        <p class="text-sm font-semibold text-rose-400 mb-1">${escapeHtml(msg || '対局データの取得に失敗しました')}</p>
        <p class="text-xs text-slate-500 mb-4">電波状況をご確認の上、再度お試しください</p>
        <button onclick="fetchViewerData(true)" class="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold transition shadow-lg shadow-brand-600/20 active:scale-95">
          再読み込みする
        </button>
      </div>
    `;
    lucide.createIcons();
  }
  const container = document.getElementById('live-matches-container');
  if (container && viewerState.matches.length === 0) {
    container.innerHTML = `
      <div class="bg-dark-850 border border-slate-800 rounded-2xl p-6 text-center text-slate-500 text-sm">
        データを受信できませんでした
      </div>
    `;
  }
}

// Realtime Subscription
let realtimeDebounceTimer = null;
function setupRealtimeViewer() {
  if (!supabaseClient) return;

  try {
    realtimeChannel = supabaseClient
      .channel('scoretrack-viewer-channel')
      .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
        console.log('Viewer Realtime change:', payload);
        if (realtimeDebounceTimer) clearTimeout(realtimeDebounceTimer);
        realtimeDebounceTimer = setTimeout(() => {
          fetchViewerData(false);
          showToast('最新の対局データを受信しました', 'info');
        }, 800);
      })
      .subscribe();
  } catch (err) {
    console.warn('Viewer: Realtime setup failed', err);
  }
}

// ============================================================================
// Tab Management
// ============================================================================
function switchViewerTab(tab) {
  viewerState.activeTab = tab;

  const tabs = ['live', 'settlement', 'stats', 'all-sessions'];
  tabs.forEach(t => {
    const sec = document.getElementById(`view-tab-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (sec && btn) {
      if (t === tab) {
        sec.classList.remove('hidden');
        btn.className = 'tab-btn px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition bg-brand-500/15 text-brand-400 border border-brand-500/30';
      } else {
        sec.classList.add('hidden');
        btn.className = 'tab-btn px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition text-slate-400 hover:text-slate-200 hover:bg-slate-800/50';
      }
    }
  });

  if (tab === 'live') {
    renderLiveView();
  } else if (tab === 'settlement') {
    renderSettlementView();
  } else if (tab === 'stats') {
    populateViewerStatsLocationFilter();
    renderViewerStatsTable();
  } else if (tab === 'all-sessions') {
    renderAllSessionsSummary();
  }
  lucide.createIcons();
}

function renderViewer() {
  renderSessionDropdown();
  if (viewerState.activeTab === 'live') {
    renderLiveView();
  } else if (viewerState.activeTab === 'settlement') {
    renderSettlementView();
  } else if (viewerState.activeTab === 'stats') {
    renderViewerStatsTable();
  } else if (viewerState.activeTab === 'all-sessions') {
    renderAllSessionsSummary();
  }
  lucide.createIcons();
}

// ============================================================================
// Session Selector & Overview
// ============================================================================
function renderSessionDropdown() {
  const select = document.getElementById('viewer-session-select');
  if (!select) return;

  if (viewerState.sessions.length === 0) {
    select.innerHTML = '<option value="">開催中のセッションはありません</option>';
    return;
  }

  select.innerHTML = viewerState.sessions.map(s => {
    const isSelected = s.id === viewerState.currentSessionId;
    const loc = s.location || '卓名未設定';
    return `<option value="${s.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(s.date)} [${escapeHtml(loc)}]</option>`;
  }).join('');

  const currentSession = viewerState.sessions.find(s => s.id === viewerState.currentSessionId);
  const dateSpan = document.getElementById('live-session-date');
  if (dateSpan && currentSession) {
    dateSpan.textContent = currentSession.date || '';
  }

  // Update input link in header
  const inputLink = document.getElementById('viewer-to-input-link');
  if (inputLink && viewerState.currentSessionId) {
    inputLink.href = `./index.html?session=${viewerState.currentSessionId}`;
  }
}

function onViewerSessionChange(sessionId) {
  viewerState.currentSessionId = sessionId;
  // Update URL without page reload
  const url = new URL(window.location);
  url.searchParams.set('session', sessionId);
  window.history.replaceState({}, '', url);

  renderViewer();
}

// ============================================================================
// TAB 1: Live View Rendering
// ============================================================================
function renderLiveView() {
  const currentSession = viewerState.sessions.find(s => s.id === viewerState.currentSessionId);
  if (!currentSession) {
    document.getElementById('live-standings-grid').innerHTML = '<div class="col-span-full py-8 text-center text-slate-500 text-sm">セッションを選択してください</div>';
    document.getElementById('live-matches-container').innerHTML = '';
    return;
  }

  const currentMatches = viewerState.matches
    .filter(m => m.sessionId === currentSession.id)
    .sort((a, b) => b.roundNumber - a.roundNumber);

  const roundCount = document.getElementById('live-round-count');
  if (roundCount) roundCount.textContent = currentMatches.length;

  const matchesCounter = document.getElementById('live-matches-counter');
  if (matchesCounter) matchesCounter.textContent = `全${currentMatches.length}戦`;

  // Render Standings Grid
  renderLiveStandings(currentSession, currentMatches);

  // Render Matches History
  renderLiveMatches(currentSession, currentMatches);
}

function renderLiveStandings(session, currentMatches) {
  const grid = document.getElementById('live-standings-grid');
  if (!grid) return;

  const playerStats = (session.playerIds || []).map((pid, idx) => {
    const player = viewerState.players.find(p => p.id === pid) || { id: pid, name: `席${idx + 1}` };
    let totalScore = 0;
    let ranks = [0, 0, 0, 0];
    let matchCount = 0;

    currentMatches.forEach(m => {
      const rec = (m.records || []).find(r => r.playerId === pid);
      if (rec) {
        const sc = parseFloat(rec.score);
        if (!isNaN(sc)) {
          totalScore += sc;
          matchCount++;
        }
        const rank = parseInt(rec.manualRank || rec.rank, 10);
        if (rank >= 1 && rank <= 4) {
          ranks[rank - 1]++;
        }
      }
    });

    const avgRank = matchCount > 0
      ? (ranks.reduce((sum, count, rIdx) => sum + count * (rIdx + 1), 0) / matchCount).toFixed(2)
      : '-';

    return {
      player,
      seatIndex: idx,
      totalScore,
      avgRank,
      matchCount,
      ranks
    };
  });

  // Sort by totalScore desc
  const sortedStats = [...playerStats].sort((a, b) => b.totalScore - a.totalScore);

  grid.innerHTML = sortedStats.map((item, rankIdx) => {
    const scoreColor = item.totalScore > 0 ? 'text-emerald-400' : (item.totalScore < 0 ? 'text-rose-400' : 'text-slate-300');
    const scoreFormatted = item.totalScore > 0 ? `+${item.totalScore.toFixed(1)}` : item.totalScore.toFixed(1);
    const medalColors = ['from-amber-400 to-yellow-600', 'from-slate-300 to-slate-500', 'from-amber-700 to-amber-900', 'from-slate-600 to-slate-800'];
    const seatName = SEAT_LABELS[item.seatIndex] || `席${item.seatIndex + 1}`;

    return `
      <div class="bg-dark-850 border border-slate-800 rounded-2xl p-4 shadow relative overflow-hidden transition hover:border-slate-700">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-lg bg-gradient-to-br ${medalColors[rankIdx] || medalColors[3]} text-white text-xs font-black flex items-center justify-center shadow-sm">
              ${rankIdx + 1}
            </span>
            <span class="text-xs font-semibold text-slate-400">${escapeHtml(seatName)}</span>
          </div>
          <span class="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
            ${item.matchCount}戦
          </span>
        </div>

        <div class="text-sm sm:text-base font-bold text-white truncate mb-2" title="${escapeHtml(item.player.name)}">
          ${escapeHtml(item.player.name)}
        </div>

        <div class="pt-2 border-t border-slate-800/80 flex items-end justify-between">
          <div>
            <div class="text-[10px] uppercase font-bold text-slate-500">平均順位</div>
            <div class="text-xs font-semibold text-slate-300">${item.avgRank}</div>
          </div>
          <div class="text-right">
            <div class="text-[10px] uppercase font-bold text-slate-500">合計スコア</div>
            <div class="text-base sm:text-lg font-black font-mono tracking-tight ${scoreColor}">
              ${scoreFormatted}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderLiveMatches(session, currentMatches) {
  const container = document.getElementById('live-matches-container');
  if (!container) return;

  if (currentMatches.length === 0) {
    container.innerHTML = `
      <div class="bg-dark-850 border border-slate-800 rounded-2xl p-8 text-center text-slate-500">
        <i data-lucide="inbox" class="w-10 h-10 mx-auto mb-2 text-slate-600"></i>
        <p class="text-sm">まだ対局スコアが登録されていません</p>
        <p class="text-xs text-slate-600 mt-1">記録係がスコアを保存すると自動的にここに表示されます</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = currentMatches.map(m => {
    // Records
    const records = m.records || [];
    // Sort records by rank
    const sortedRecords = [...records].sort((a, b) => {
      const rA = a.manualRank || a.rank || 99;
      const rB = b.manualRank || b.rank || 99;
      return rA - rB;
    });

    const rowsHtml = sortedRecords.map(rec => {
      const player = viewerState.players.find(p => p.id === rec.playerId) || { name: '未設定' };
      const scoreNum = parseFloat(rec.score) || 0;
      const scoreColor = scoreNum > 0 ? 'text-emerald-400' : (scoreNum < 0 ? 'text-rose-400' : 'text-slate-400');
      const scoreStr = scoreNum > 0 ? `+${scoreNum.toFixed(1)}` : scoreNum.toFixed(1);
      const rank = parseInt(rec.manualRank || rec.rank, 10) || '-';
      const rankBadgeColors = {
        1: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        2: 'bg-slate-400/20 text-slate-200 border-slate-400/40',
        3: 'bg-amber-800/20 text-amber-600 border-amber-700/40',
        4: 'bg-slate-700/30 text-slate-400 border-slate-700/40'
      };

      return `
        <div class="flex items-center justify-between py-1.5 px-3 rounded-xl bg-dark-900/60 border border-slate-800/40">
          <div class="flex items-center gap-2.5">
            <span class="w-5 h-5 rounded-md text-[11px] font-bold flex items-center justify-center border ${rankBadgeColors[rank] || 'bg-slate-800 text-slate-400 border-slate-700'}">
              ${rank}
            </span>
            <span class="text-xs sm:text-sm font-semibold text-slate-200 truncate max-w-[120px] sm:max-w-none">
              ${escapeHtml(player.name)}
            </span>
          </div>
          <div class="font-mono font-bold text-xs sm:text-sm ${scoreColor}">
            ${scoreStr}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="bg-dark-850 border border-slate-800 rounded-2xl p-4 shadow-sm hover:border-slate-700 transition">
        <div class="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-lg bg-brand-500/20 text-brand-400 border border-brand-500/30 text-xs font-bold">
              第 ${m.roundNumber} 戦
            </span>
            <span class="text-[11px] text-slate-400">4名集計済</span>
          </div>
          <span class="text-[11px] text-slate-500 font-mono">
            ${m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          ${rowsHtml}
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// TAB 2: Settlement View Rendering
// ============================================================================
function renderSettlementView() {
  const area = document.getElementById('settlement-content-area');
  if (!area) return;

  const currentSession = viewerState.sessions.find(s => s.id === viewerState.currentSessionId);
  if (!currentSession) {
    area.innerHTML = '<div class="p-8 text-center text-slate-500">セッションを選択してください</div>';
    return;
  }

  const currentMatches = viewerState.matches.filter(m => m.sessionId === currentSession.id);
  const settlement = currentSession.settlement || { rate: currentSession.rate || 100, tableFee: currentSession.tableFee || 0, players: {} };
  const rate = settlement.rate || 100;
  const tableFee = settlement.tableFee || 0;
  const feePerPlayer = Math.round(tableFee / 4);

  // Calculate each player's settlement
  const playersSummary = (currentSession.playerIds || []).map((pid, idx) => {
    const player = viewerState.players.find(p => p.id === pid) || { id: pid, name: `席${idx + 1}` };
    let totalScore = 0;
    currentMatches.forEach(m => {
      const rec = (m.records || []).find(r => r.playerId === pid);
      if (rec) {
        const sc = parseFloat(rec.score);
        if (!isNaN(sc)) {
          totalScore += sc;
        }
      }
    });

    const pSettlement = settlement.players?.[pid] || { food: 0, paid: 0 };
    const scoreMoney = Math.round(totalScore * rate);
    const food = parseFloat(pSettlement.food) || 0;
    const paid = parseFloat(pSettlement.paid) || 0;
    // Net: scoreMoney - feePerPlayer - food
    const dueAmount = scoreMoney - feePerPlayer - food;
    const finalDifference = dueAmount + paid; // balance

    return {
      player,
      seatName: SEAT_LABELS[idx] || `席${idx + 1}`,
      totalScore,
      scoreMoney,
      feePerPlayer,
      food,
      paid,
      dueAmount,
      finalDifference
    };
  });

  const cardsHtml = playersSummary.map(item => {
    const dueColor = item.dueAmount >= 0 ? 'text-emerald-400' : 'text-rose-400';
    const dueSign = item.dueAmount > 0 ? '+' : '';

    return `
      <div class="bg-dark-850 border border-slate-800 rounded-2xl p-4 shadow relative">
        <div class="flex items-center justify-between pb-2 border-b border-slate-800 mb-3">
          <div class="font-bold text-white text-base">${escapeHtml(item.player.name)}</div>
          <span class="text-xs text-slate-400">${escapeHtml(item.seatName)}</span>
        </div>

        <div class="space-y-1.5 text-xs">
          <div class="flex justify-between text-slate-400">
            <span>累計スコア</span>
            <span class="font-mono font-semibold text-slate-200">${item.totalScore > 0 ? '+' : ''}${item.totalScore.toFixed(1)}</span>
          </div>
          <div class="flex justify-between text-slate-400">
            <span>ゲーム収支 (×${rate}円)</span>
            <span class="font-mono font-semibold ${item.scoreMoney >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
              ${item.scoreMoney > 0 ? '+' : ''}${item.scoreMoney.toLocaleString()} 円
            </span>
          </div>
          <div class="flex justify-between text-slate-400">
            <span>場代分担</span>
            <span class="font-mono text-slate-300">-${item.feePerPlayer.toLocaleString()} 円</span>
          </div>
          ${item.food > 0 ? `
          <div class="flex justify-between text-slate-400">
            <span>飲食・雑費</span>
            <span class="font-mono text-slate-300">-${item.food.toLocaleString()} 円</span>
          </div>` : ''}
          <div class="pt-2 border-t border-slate-800 flex justify-between items-center font-bold">
            <span class="text-slate-200">清算受払額</span>
            <span class="text-base font-mono font-black ${dueColor}">
              ${dueSign}${item.dueAmount.toLocaleString()} 円
            </span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  area.innerHTML = `
    <!-- Settings Summary -->
    <div class="bg-dark-850 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center gap-6 text-xs text-slate-300">
      <div><span class="text-slate-500 font-semibold">適用レート:</span> 1pt = <strong class="text-brand-400 text-sm">${rate}</strong> 円</div>
      <div><span class="text-slate-500 font-semibold">卓代合計:</span> <strong class="text-white text-sm">${tableFee.toLocaleString()}</strong> 円 (1人あたり ${feePerPlayer.toLocaleString()} 円)</div>
      <div><span class="text-slate-500 font-semibold">集計対局:</span> <strong class="text-white text-sm">${currentMatches.length}</strong> 戦</div>
    </div>

    <!-- Players Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      ${cardsHtml}
    </div>
  `;
}

// ============================================================================
// TAB 3: Stats Table Rendering
// ============================================================================
function populateViewerStatsLocationFilter() {
  const filter = document.getElementById('viewer-stats-location-filter');
  if (!filter) return;

  const locations = Array.from(new Set(viewerState.sessions.map(s => s.location).filter(Boolean)));
  const currentVal = filter.value;

  filter.innerHTML = '<option value="ALL">全場所・全卓</option>' +
    locations.map(loc => `<option value="${escapeHtml(loc)}" ${currentVal === loc ? 'selected' : ''}>${escapeHtml(loc)}</option>`).join('');
}

function renderViewerStatsTable() {
  const tbody = document.getElementById('viewer-stats-tbody');
  if (!tbody) return;

  const locFilter = document.getElementById('viewer-stats-location-filter')?.value || 'ALL';

  // Filter matches by location
  let validSessionIds = viewerState.sessions.map(s => s.id);
  if (locFilter !== 'ALL') {
    validSessionIds = viewerState.sessions.filter(s => s.location === locFilter).map(s => s.id);
  }
  const filteredMatches = viewerState.matches.filter(m => validSessionIds.includes(m.sessionId));

  // Aggregate stats per player
  const playerStatsMap = {};
  viewerState.players.forEach(p => {
    playerStatsMap[p.id] = {
      id: p.id,
      name: p.name,
      totalMatches: 0,
      r1: 0,
      r2: 0,
      r3: 0,
      r4: 0,
      totalScore: 0
    };
  });

  filteredMatches.forEach(m => {
    (m.records || []).forEach(rec => {
      const entry = playerStatsMap[rec.playerId];
      if (entry && rec) {
        const sc = parseFloat(rec.score);
        if (!isNaN(sc)) {
          entry.totalMatches++;
          entry.totalScore += sc;
        }
        const rank = parseInt(rec.manualRank || rec.rank, 10);
        if (rank === 1) entry.r1++;
        else if (rank === 2) entry.r2++;
        else if (rank === 3) entry.r3++;
        else if (rank === 4) entry.r4++;
      }
    });
  });

  let statsList = Object.values(playerStatsMap)
    .filter(item => item.totalMatches > 0)
    .map(item => {
      const top2 = item.r1 + item.r2;
      const top2Rate = item.totalMatches > 0 ? ((top2 / item.totalMatches) * 100).toFixed(1) : 0;
      const avgRank = item.totalMatches > 0
        ? ((item.r1 * 1 + item.r2 * 2 + item.r3 * 3 + item.r4 * 4) / item.totalMatches).toFixed(2)
        : '-';
      const avgScore = item.totalMatches > 0 ? (item.totalScore / item.totalMatches).toFixed(1) : 0;

      return {
        ...item,
        top2Rate: parseFloat(top2Rate),
        avgRank: parseFloat(avgRank) || 99,
        avgScore: parseFloat(avgScore)
      };
    });

  // Sort
  const col = viewerState.statsSort.column;
  const dir = viewerState.statsSort.direction === 'asc' ? 1 : -1;
  statsList.sort((a, b) => {
    if (a[col] < b[col]) return -1 * dir;
    if (a[col] > b[col]) return 1 * dir;
    return 0;
  });

  if (statsList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="py-8 text-center text-slate-500">戦績データがありません</td></tr>';
    return;
  }

  tbody.innerHTML = statsList.map((st, idx) => {
    const scoreColor = st.totalScore > 0 ? 'text-emerald-400 font-bold' : (st.totalScore < 0 ? 'text-rose-400 font-bold' : 'text-slate-300');
    return `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="py-3 px-3 font-bold text-slate-400">${idx + 1}</td>
        <td class="py-3 px-3 font-semibold text-white">${escapeHtml(st.name)}</td>
        <td class="py-3 px-2 text-right font-mono text-slate-300">${st.totalMatches}</td>
        <td class="py-3 px-2 text-right font-mono text-amber-400">${st.r1}</td>
        <td class="py-3 px-2 text-right font-mono text-slate-300">${st.r2}</td>
        <td class="py-3 px-2 text-right font-mono text-amber-600">${st.r3}</td>
        <td class="py-3 px-2 text-right font-mono text-slate-400">${st.r4}</td>
        <td class="py-3 px-2 text-right font-mono text-brand-400">${st.top2Rate}%</td>
        <td class="py-3 px-2 text-right font-mono text-slate-200">${st.avgRank}</td>
        <td class="py-3 px-3 text-right font-mono ${scoreColor}">${st.totalScore > 0 ? '+' : ''}${st.totalScore.toFixed(1)}</td>
        <td class="py-3 px-3 text-right font-mono text-slate-300">${st.avgScore > 0 ? '+' : ''}${st.avgScore.toFixed(1)}</td>
      </tr>
    `;
  }).join('');
}

function sortViewerStats(col) {
  if (viewerState.statsSort.column === col) {
    viewerState.statsSort.direction = viewerState.statsSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    viewerState.statsSort.column = col;
    viewerState.statsSort.direction = (col === 'avgRank' || col === 'rank') ? 'asc' : 'desc';
  }
  renderViewerStatsTable();
}

// ============================================================================
// TAB 4: All Sessions Summary
// ============================================================================
function renderAllSessionsSummary() {
  const grid = document.getElementById('viewer-all-sessions-grid');
  if (!grid) return;

  if (viewerState.sessions.length === 0) {
    grid.innerHTML = '<div class="col-span-full py-8 text-center text-slate-500">開催セッションがありません</div>';
    return;
  }

  grid.innerHTML = viewerState.sessions.map(s => {
    const sMatches = viewerState.matches.filter(m => m.sessionId === s.id);
    const loc = s.location || '卓名未設定';

    // Top player in this session
    const scores = {};
    sMatches.forEach(m => {
      (m.records || []).forEach(r => {
        const sc = parseFloat(r.score);
        if (!isNaN(sc)) {
          scores[r.playerId] = (scores[r.playerId] || 0) + sc;
        }
      });
    });

    let topPlayerName = '対局前';
    let topScore = 0;
    const sortedEntries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    if (sortedEntries.length > 0) {
      const topP = viewerState.players.find(p => p.id === sortedEntries[0][0]);
      topPlayerName = topP?.name || '不明';
      topScore = sortedEntries[0][1];
    }

    return `
      <div class="bg-dark-850 border border-slate-800 rounded-2xl p-4 shadow hover:border-brand-500/50 transition flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-semibold">${escapeHtml(s.date)}</span>
            <span class="text-xs font-mono text-brand-400 font-bold">${sMatches.length} 戦進行</span>
          </div>
          <h3 class="text-base font-bold text-white mb-2">${escapeHtml(loc)}</h3>
          <div class="text-xs text-slate-400 mb-4 bg-dark-900/60 p-2.5 rounded-xl border border-slate-800">
            <div class="flex justify-between items-center mb-1">
              <span class="text-slate-500">現在トップ:</span>
              <span class="font-bold text-amber-300">${escapeHtml(topPlayerName)}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-slate-500">トップスコア:</span>
              <span class="font-mono font-bold text-emerald-400">${topScore > 0 ? '+' : ''}${topScore.toFixed(1)}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 pt-2 border-t border-slate-800">
          <button onclick="onViewerSessionChange('${s.id}'); switchViewerTab('live');" class="flex-1 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold transition">
            速報を見る
          </button>
          <a href="./index.html?session=${s.id}" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition">
            入力
          </a>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// Share Modal Functions (QRコード・URL共有)
// ============================================================================
function getBaseViewerUrl() {
  let path = window.location.pathname;
  path = path.replace(/(index|view)\.html.*$/, '');
  if (!path.endsWith('/')) path += '/';
  return window.location.origin + path;
}

let viewerShareState = {
  activeTab: 'viewer'
};

function openShareModal() {
  const modal = document.getElementById('viewer-share-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  switchViewerShareTab('viewer');
  lucide.createIcons();
}

function closeShareModal() {
  const modal = document.getElementById('viewer-share-modal');
  if (modal) modal.classList.add('hidden');
}

function switchViewerShareTab(tab) {
  viewerShareState.activeTab = tab;
  const currentId = viewerState.currentSessionId || '';
  const baseUrl = getBaseViewerUrl();

  const viewBtn = document.getElementById('viewer-share-tab-view-btn');
  const inputBtn = document.getElementById('viewer-share-tab-input-btn');
  const qrTitle = document.getElementById('viewer-qr-title');
  const qrDesc = document.getElementById('viewer-qr-desc');
  const urlInput = document.getElementById('viewer-share-active-url');

  let targetUrl = '';
  if (tab === 'viewer') {
    targetUrl = `${baseUrl}view.html?session=${currentId}`;
    if (viewBtn) {
      viewBtn.className = 'flex-1 py-1.5 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 bg-brand-600 text-white shadow-sm';
    }
    if (inputBtn) {
      inputBtn.className = 'flex-1 py-1.5 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 text-slate-400 hover:text-slate-200';
    }
    if (qrTitle) qrTitle.textContent = '参加者用 閲覧QRコード';
    if (qrDesc) qrDesc.textContent = 'スマホのカメラをかざすと、リアルタイム速報画面が開きます';
  } else {
    targetUrl = `${baseUrl}index.html?session=${currentId}`;
    if (viewBtn) {
      viewBtn.className = 'flex-1 py-1.5 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 text-slate-400 hover:text-slate-200';
    }
    if (inputBtn) {
      inputBtn.className = 'flex-1 py-1.5 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 bg-amber-600 text-white shadow-sm';
    }
    if (qrTitle) qrTitle.textContent = '記録係用 入力QRコード';
    if (qrDesc) qrDesc.textContent = 'この端末で開くと、この卓に固定されてスコアを入力できます';
  }

  if (urlInput) urlInput.value = targetUrl;
  renderViewerQrCode(targetUrl);
  lucide.createIcons();
}

function renderViewerQrCode(url) {
  const container = document.getElementById('viewer-qrcode-container');
  if (!container) return;

  container.innerHTML = '';

  if (typeof QRCode !== 'undefined') {
    try {
      new QRCode(container, {
        text: url,
        width: 160,
        height: 160,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
      return;
    } catch (err) {
      console.warn('Viewer QR generation failed, falling back to API image:', err);
    }
  }

  // Fallback API image
  const img = document.createElement('img');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}`;
  img.alt = 'QR Code';
  img.className = 'w-40 h-40 rounded-lg';
  container.appendChild(img);
}

function copyViewerCurrentUrl() {
  const input = document.getElementById('viewer-share-active-url');
  if (!input) return;
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    showToast('URLをクリップボードにコピーしました', 'success');
  }).catch(() => {
    document.execCommand('copy');
    showToast('URLをコピーしました', 'success');
  });
}

async function triggerViewerNativeShare() {
  const input = document.getElementById('viewer-share-active-url');
  if (!input) return;
  const url = input.value;
  const currentSession = viewerState.sessions.find(s => s.id === viewerState.currentSessionId);
  const sessionName = currentSession ? `${currentSession.location || '卓'} (${currentSession.date || ''})` : '対局';
  const isViewer = viewerShareState.activeTab === 'viewer';

  const shareData = {
    title: isViewer ? `【速報】${sessionName} スコア` : `【入力】${sessionName}`,
    text: isViewer ? `${sessionName} のリアルタイム対局結果・速報です` : `${sessionName} のスコア入力画面です`,
    url: url
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      showToast('共有しました', 'success');
    } catch (err) {
      if (err.name !== 'AbortError') {
        copyViewerCurrentUrl();
      }
    }
  } else {
    copyViewerCurrentUrl();
  }
}

// Utilities
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const colors = {
    info: 'bg-dark-850 border-slate-700 text-slate-100',
    success: 'bg-emerald-950/90 border-emerald-500/40 text-emerald-100',
    error: 'bg-rose-950/90 border-rose-500/40 text-rose-100'
  };

  toast.className = `px-4 py-2.5 rounded-xl border shadow-xl text-xs font-semibold pointer-events-auto transition-all duration-300 transform translate-y-2 opacity-0 flex items-center gap-2 ${colors[type] || colors.info}`;
  toast.textContent = message;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
