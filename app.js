/**
 * ScoreTrack 4 - 4-Player Game Tracker
 * Pure Vanilla JS Application
 */

// ============================================================================
// State & Storage Keys
// ============================================================================
const STORAGE_KEYS = {
  PLAYERS: 'scoretrack_players',
  SESSIONS: 'scoretrack_sessions',
  MATCHES: 'scoretrack_matches',
  CURRENT_SESSION: 'scoretrack_current_session_id',
  DEVICE_ID: 'scoretrack_device_id',
};

let state = {
  players: [],        // [{ id, name, createdAt }]
  sessions: [],       // [{ id, date, location, playerIds: [id1, id2, id3, id4], createdAt, activeEditor: { deviceId, timestamp } }]
  matches: [],        // [{ id, sessionId, roundNumber, records: [{ playerId, score, rank, manualRank }] }]
  currentSessionId: null,
  activeTab: 'session',
  isSessionLockedMode: false, // URLパラメータ (?session=xxx) による担当卓固定モード
  lockedSessionId: null,
  myDeviceId: null,
  statsSort: {
    column: 'totalScore',
    direction: 'desc'
  },
  settlementHistorySort: {
    column: 'finalNet',
    direction: 'desc'
  }
};

const SEAT_LABELS = ['東 (起家)', '南', '西', '北'];
const SEAT_SHORT = ['東', '南', '西', '北'];
const SEAT_BORDER_CLASSES = ['seat-east', 'seat-south', 'seat-west', 'seat-north'];
const SEAT_COLORS = ['text-blue-400', 'text-red-400', 'text-amber-400', 'text-emerald-400'];

// ============================================================================
// Initialization & Loading
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initDeviceId();
  loadData();
  parseAppUrlParams();

  // If completely fresh with no players, set default initial players & session
  if (state.players.length === 0) {
    initializeDefaultData();
  }

  // Ensure currentSessionId is valid
  if (!state.currentSessionId || !state.sessions.some(s => s.id === state.currentSessionId)) {
    if (state.sessions.length > 0) {
      state.currentSessionId = state.sessions[0].id;
    }
  }

  renderAll();
  lucide.createIcons();

  // Initialize Supabase Cloud Sync
  initSupabase();
});

// ============================================================================
// Theme Management (Dark / Light Mode)
// ============================================================================
const THEME_STORAGE_KEY = 'scoretrack_theme';

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  // Default to dark if not set
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
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    showToast('ライトモードに切り替えました', 'info');
  } else {
    document.documentElement.classList.add('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    showToast('ダークモードに切り替えました', 'info');
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

function loadData() {
  try {
    const p = localStorage.getItem(STORAGE_KEYS.PLAYERS);
    const s = localStorage.getItem(STORAGE_KEYS.SESSIONS);
    const m = localStorage.getItem(STORAGE_KEYS.MATCHES);
    const curr = localStorage.getItem(STORAGE_KEYS.CURRENT_SESSION);

    state.players = p ? JSON.parse(p) : [];
    state.sessions = s ? JSON.parse(s) : [];
    state.matches = m ? JSON.parse(m) : [];
    state.currentSessionId = curr || (state.sessions[0]?.id || null);
  } catch (err) {
    console.error('Failed to load localStorage data', err);
    showToast('データの読み込みに失敗しました', 'error');
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEYS.PLAYERS, JSON.stringify(state.players));
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(state.sessions));
    localStorage.setItem(STORAGE_KEYS.MATCHES, JSON.stringify(state.matches));
    if (state.currentSessionId) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION, state.currentSessionId);
    }
  } catch (err) {
    console.error('Failed to save to localStorage', err);
    showToast('データの保存に失敗しました', 'error');
  }
}

// ============================================================================
// Device ID & Session Editor Lock (排他制御・二重入力防止)
// ============================================================================
function initDeviceId() {
  let id = localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  if (!id) {
    id = 'dev_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    localStorage.setItem(STORAGE_KEYS.DEVICE_ID, id);
  }
  state.myDeviceId = id;
}

// URLパラメータからセッション指定を取得（?session=ID）
function parseAppUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const requestedSession = urlParams.get('session');
  if (requestedSession) {
    state.isSessionLockedMode = true;
    state.lockedSessionId = requestedSession;
    state.currentSessionId = requestedSession;
  }
}

function updateSessionLockedBadge() {
  const badge = document.getElementById('session-locked-badge');
  if (!badge) return;
  if (state.isSessionLockedMode) {
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// セッションの編集ロックをチェック（他端末が直近5分以内に編集していたら警告モーダルを表示）
function checkSessionEditorLock(session) {
  if (!session || !session.activeEditor) return true;
  const editor = session.activeEditor;
  if (!editor.deviceId || editor.deviceId === state.myDeviceId) return true;

  const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5分間
  const now = Date.now();
  const lastActive = new Date(editor.timestamp || 0).getTime();
  if (now - lastActive < LOCK_TIMEOUT_MS) {
    showConflictWarningModal(editor.deviceId, editor.timestamp);
    return false;
  }
  return true;
}

function claimSessionEditorLock(session) {
  if (!session) return;
  session.activeEditor = {
    deviceId: state.myDeviceId,
    timestamp: new Date().toISOString()
  };
  saveData();
}

function showConflictWarningModal(editorDeviceId, timestamp) {
  const modal = document.getElementById('conflict-warning-modal');
  if (!modal) return;
  const info = document.getElementById('conflict-editor-info');
  const time = document.getElementById('conflict-time-info');
  const viewerBtn = document.getElementById('conflict-go-viewer-btn');
  if (info) info.textContent = editorDeviceId.substring(0, 10) + '...';
  if (time) time.textContent = new Date(timestamp).toLocaleTimeString();
  if (viewerBtn && state.currentSessionId) {
    viewerBtn.href = `./view.html?session=${state.currentSessionId}`;
  }
  modal.classList.remove('hidden');
  lucide.createIcons();
}

function takeoverEditingLock() {
  const currentSession = getCurrentSession();
  if (currentSession) {
    claimSessionEditorLock(currentSession);
    syncSingleSession(currentSession);
    showToast('この卓の入力権を引き継ぎました', 'success');
  }
  const modal = document.getElementById('conflict-warning-modal');
  if (modal) modal.classList.add('hidden');
}

// ============================================================================
// Header Menu & Share Modal (QRコード・URL共有)
// ============================================================================
function toggleHeaderMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('header-more-menu');
  if (menu) {
    menu.classList.toggle('hidden');
  }
}

function closeHeaderMenu() {
  const menu = document.getElementById('header-more-menu');
  if (menu) {
    menu.classList.add('hidden');
  }
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('header-more-menu');
  const btn = document.getElementById('header-more-btn');
  if (menu && !menu.classList.contains('hidden')) {
    if (btn && btn.contains(e.target)) return;
    if (!menu.contains(e.target)) {
      menu.classList.add('hidden');
    }
  }
});

function getBaseAppUrl() {
  let path = window.location.pathname;
  path = path.replace(/(index|view)\.html.*$/, '');
  if (!path.endsWith('/')) path += '/';
  return window.location.origin + path;
}

let shareModalState = {
  activeTab: 'viewer' // 'viewer' or 'input'
};

function openShareModal() {
  const modal = document.getElementById('share-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  switchShareTab('viewer');
  lucide.createIcons();
}

function closeShareModal() {
  const modal = document.getElementById('share-modal');
  if (modal) modal.classList.add('hidden');
}

function switchShareTab(tab) {
  shareModalState.activeTab = tab;
  const currentId = state.currentSessionId || '';
  const baseUrl = getBaseAppUrl();

  const viewerBtn = document.getElementById('share-tab-viewer-btn');
  const inputBtn = document.getElementById('share-tab-input-btn');
  const qrTitle = document.getElementById('share-qr-title');
  const qrDesc = document.getElementById('share-qr-desc');
  const urlInput = document.getElementById('share-active-url-input');

  let targetUrl = '';
  if (tab === 'viewer') {
    targetUrl = `${baseUrl}view.html?session=${currentId}`;
    if (viewerBtn) {
      viewerBtn.className = 'flex-1 py-1.5 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 bg-brand-600 text-white shadow-sm';
    }
    if (inputBtn) {
      inputBtn.className = 'flex-1 py-1.5 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 text-slate-400 hover:text-slate-200';
    }
    if (qrTitle) qrTitle.textContent = '参加者用 閲覧QRコード';
    if (qrDesc) qrDesc.textContent = 'スマホのカメラをかざすと、リアルタイム速報画面が開きます';
  } else {
    targetUrl = `${baseUrl}index.html?session=${currentId}`;
    if (viewerBtn) {
      viewerBtn.className = 'flex-1 py-1.5 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 text-slate-400 hover:text-slate-200';
    }
    if (inputBtn) {
      inputBtn.className = 'flex-1 py-1.5 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 bg-amber-600 text-white shadow-sm';
    }
    if (qrTitle) qrTitle.textContent = '記録係用 入力QRコード';
    if (qrDesc) qrDesc.textContent = 'この端末で開くと、この卓に固定されてスコアを入力できます';
  }

  if (urlInput) urlInput.value = targetUrl;
  renderQrCode(targetUrl);
  lucide.createIcons();
}

function renderQrCode(url) {
  const container = document.getElementById('share-qrcode-container');
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
      console.warn('QRCode generation failed, falling back to API image:', err);
    }
  }

  // Fallback image using online QR service
  const img = document.createElement('img');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}`;
  img.alt = 'QR Code';
  img.className = 'w-40 h-40 rounded-lg';
  container.appendChild(img);
}

function copyCurrentShareUrl() {
  const input = document.getElementById('share-active-url-input');
  if (!input) return;
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    showToast('URLをクリップボードにコピーしました', 'success');
  }).catch(() => {
    document.execCommand('copy');
    showToast('URLをコピーしました', 'success');
  });
}

async function triggerNativeShare() {
  const input = document.getElementById('share-active-url-input');
  if (!input) return;
  const url = input.value;
  const session = getCurrentSession();
  const sessionName = session ? `${session.location || '卓'} (${session.date || ''})` : '対局';
  const isViewer = shareModalState.activeTab === 'viewer';

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
        copyCurrentShareUrl();
      }
    }
  } else {
    // Fallback: copy to clipboard
    copyCurrentShareUrl();
  }
}

// ============================================================================
// Supabase Cloud Database Integration (Granular Sync & Realtime)
// ============================================================================
const SUPABASE_CONFIG = {
  url: 'https://tylydgydwvnuhleyyyyg.supabase.co',
  anonKey: 'sb_publishable_qdkKE_ECqK7bzqqHMEKB9Q_3K774vyQ'
};

let supabaseClient = null;
let realtimeChannel = null;

// Track local modifications to prevent self-echo re-renders
const myRecentUpdateTimestamps = {};

function markSelfUpdate(entityId) {
  myRecentUpdateTimestamps[entityId] = Date.now();
}

function isMyRecentUpdate(entityId) {
  const lastTime = myRecentUpdateTimestamps[entityId];
  if (!lastTime) return false;
  return (Date.now() - lastTime) < 2000; // 2秒以内は自分の更新
}

function initSupabase() {
  if (window.supabase) {
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
      console.log('Supabase client initialized successfully');
      setupRealtimeSubscription();
      // On startup, pull latest cloud data
      pullLatestDataFromCloud(false);
    } catch (err) {
      console.error('Supabase initialization failed:', err);
      updateCloudSyncUI('offline', '初期化エラー');
    }
  } else {
    console.warn('Supabase SDK not loaded yet');
    updateCloudSyncUI('offline', 'SDK未読込');
  }
}

function updateCloudSyncUI(status, message) {
  const dot = document.getElementById('cloud-sync-dot');
  const label = document.getElementById('cloud-sync-label');
  const icon = document.getElementById('cloud-sync-icon');
  const badge = document.getElementById('data-cloud-status-badge');

  if (!dot || !label) return;

  if (status === 'syncing') {
    dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
    label.textContent = '同期中...';
    if (icon) icon.classList.add('animate-spin');
    if (badge) {
      badge.textContent = '同期中...';
      badge.className = 'text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 font-medium';
    }
  } else if (status === 'synced') {
    dot.className = 'w-2 h-2 rounded-full bg-emerald-400';
    label.textContent = 'クラウド同期済';
    if (icon) icon.classList.remove('animate-spin');
    if (badge) {
      badge.textContent = '接続・同期完了';
      badge.className = 'text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium';
    }
  } else if (status === 'offline' || status === 'error') {
    dot.className = 'w-2 h-2 rounded-full bg-rose-400';
    label.textContent = '同期停止';
    if (icon) icon.classList.remove('animate-spin');
    if (badge) {
      badge.textContent = message || '接続エラー';
      badge.className = 'text-[11px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 font-medium';
    }
  }
}

// ----------------------------------------------------------------------------
// レコード単位の差分同期関数（Granular Sync Functions）
// ----------------------------------------------------------------------------

// 1. Matches: 単一対局のみ UPSERT
async function syncSingleMatch(match) {
  if (!supabaseClient || !match) return;
  updateCloudSyncUI('syncing');
  markSelfUpdate(match.id);

  try {
    const payload = {
      id: match.id,
      session_id: match.sessionId,
      round_number: match.roundNumber,
      records: match.records || [],
      created_at: match.createdAt || new Date().toISOString()
    };
    const { error } = await supabaseClient.from('matches').upsert([payload], { onConflict: 'id' });
    if (error) throw error;
    updateCloudSyncUI('synced');
  } catch (err) {
    console.error('syncSingleMatch error:', err);
    updateCloudSyncUI('error', '対局保存エラー');
  }
}

// Matches: 単一対局の削除
async function syncDeleteMatch(matchId) {
  if (!supabaseClient || !matchId) return;
  updateCloudSyncUI('syncing');
  markSelfUpdate(matchId);

  try {
    const { error } = await supabaseClient.from('matches').delete().eq('id', matchId);
    if (error) throw error;
    updateCloudSyncUI('synced');
  } catch (err) {
    console.error('syncDeleteMatch error:', err);
    updateCloudSyncUI('error', '対局削除エラー');
  }
}

// Matches: 入力中のデバウンス同期（打鍵ごとにDBを叩きすぎないよう500ms待つ）
const matchSyncTimers = {};
function debounceSyncMatch(match) {
  if (!match) return;
  updateCloudSyncUI('syncing');
  if (matchSyncTimers[match.id]) {
    clearTimeout(matchSyncTimers[match.id]);
  }
  matchSyncTimers[match.id] = setTimeout(() => {
    syncSingleMatch(match);
    delete matchSyncTimers[match.id];
  }, 500);
}

// 2. Sessions: 単一セッションのみ UPSERT
async function syncSingleSession(session) {
  if (!supabaseClient || !session) return;
  updateCloudSyncUI('syncing');
  markSelfUpdate(session.id);

  try {
    const sPayload = {
      id: session.id,
      date: session.date,
      location: session.location || '',
      memo: session.memo || '',
      player_ids: session.playerIds || [],
      table_fee: session.settlement?.tableFee || session.tableFee || 0,
      rate: session.settlement?.rate || session.rate || 100,
      created_at: session.createdAt || new Date().toISOString()
    };
    const { error: sErr } = await supabaseClient.from('sessions').upsert([sPayload], { onConflict: 'id' });
    if (sErr) throw sErr;

    if (session.settlement) {
      const setPayload = {
        id: 'set_' + session.id,
        session_id: session.id,
        details: session.settlement,
        updated_at: new Date().toISOString()
      };
      await supabaseClient.from('settlements').upsert([setPayload], { onConflict: 'id' });
    }
    updateCloudSyncUI('synced');
  } catch (err) {
    console.error('syncSingleSession error:', err);
    updateCloudSyncUI('error', 'セッション保存エラー');
  }
}

// Sessions: 単一セッションおよび関連データの削除
async function syncDeleteSession(sessionId) {
  if (!supabaseClient || !sessionId) return;
  updateCloudSyncUI('syncing');
  markSelfUpdate(sessionId);

  try {
    await supabaseClient.from('matches').delete().eq('session_id', sessionId);
    await supabaseClient.from('settlements').delete().eq('session_id', sessionId);
    await supabaseClient.from('sessions').delete().eq('id', sessionId);
    updateCloudSyncUI('synced');
  } catch (err) {
    console.error('syncDeleteSession error:', err);
    updateCloudSyncUI('error', 'セッション削除エラー');
  }
}

// Sessions: 精算設定変更のデバウンス同期
let sessionSyncTimeout = null;
function debounceSyncSession(session) {
  if (!session) return;
  updateCloudSyncUI('syncing');
  if (sessionSyncTimeout) clearTimeout(sessionSyncTimeout);
  sessionSyncTimeout = setTimeout(() => {
    syncSingleSession(session);
  }, 500);
}

// 3. Players: 単一プレイヤーのみ UPSERT
async function syncSinglePlayer(player) {
  if (!supabaseClient || !player) return;
  updateCloudSyncUI('syncing');
  markSelfUpdate(player.id);

  try {
    const pPayload = {
      id: player.id,
      name: player.name,
      created_at: player.createdAt || new Date().toISOString()
    };
    const { error } = await supabaseClient.from('players').upsert([pPayload], { onConflict: 'id' });
    if (error) throw error;
    updateCloudSyncUI('synced');
  } catch (err) {
    console.error('syncSinglePlayer error:', err);
    updateCloudSyncUI('error', 'プレイヤー保存エラー');
  }
}

// Players: 単一プレイヤー削除
async function syncDeletePlayer(playerId) {
  if (!supabaseClient || !playerId) return;
  updateCloudSyncUI('syncing');
  markSelfUpdate(playerId);

  try {
    const { error } = await supabaseClient.from('players').delete().eq('id', playerId);
    if (error) throw error;
    updateCloudSyncUI('synced');
  } catch (err) {
    console.error('syncDeletePlayer error:', err);
    updateCloudSyncUI('error', 'プレイヤー削除エラー');
  }
}

// ----------------------------------------------------------------------------
// クラウド全体取得（起動時＆手動リフレッシュ用）
// ----------------------------------------------------------------------------
async function pullLatestDataFromCloud(isManual = false) {
  if (!supabaseClient) return;

  if (isManual) {
    showToast('クラウドから最新データを取得しています...', 'info');
  }
  updateCloudSyncUI('syncing');

  try {
    const [pRes, sRes, mRes, setRes] = await Promise.all([
      supabaseClient.from('players').select('*'),
      supabaseClient.from('sessions').select('*'),
      supabaseClient.from('matches').select('*'),
      supabaseClient.from('settlements').select('*')
    ]);

    if (pRes.error || sRes.error || mRes.error || setRes.error) {
      throw pRes.error || sRes.error || mRes.error || setRes.error;
    }

    const cloudPlayers = pRes.data || [];
    const cloudSessions = sRes.data || [];
    const cloudMatches = mRes.data || [];
    const cloudSettlements = setRes.data || [];

    // If cloud is empty and local has existing data, auto migrate local data to cloud
    if (cloudPlayers.length === 0 && cloudSessions.length === 0 && (state.players.length > 0 || state.sessions.length > 0)) {
      console.log('Cloud is empty; migrating initial local data to cloud...');
      await migrateLocalDataToCloud(true);
      return;
    }

    // Populate cloud data into state
    if (cloudPlayers.length > 0 || cloudSessions.length > 0) {
      state.players = cloudPlayers.map(p => ({
        id: p.id,
        name: p.name,
        createdAt: p.created_at
      }));

      const settlementsMap = {};
      cloudSettlements.forEach(st => {
        settlementsMap[st.session_id] = st.details;
      });

      state.sessions = cloudSessions.map(s => ({
        id: s.id,
        date: s.date,
        location: s.location || '',
        memo: s.memo || '',
        playerIds: Array.isArray(s.player_ids) ? s.player_ids : (typeof s.player_ids === 'string' ? JSON.parse(s.player_ids) : []),
        tableFee: parseFloat(s.table_fee) || 0,
        rate: parseFloat(s.rate) || 100,
        createdAt: s.created_at,
        settlement: settlementsMap[s.id] || { rate: parseFloat(s.rate) || 100, tableFee: parseFloat(s.table_fee) || 0, players: {} }
      }));

      // Sort sessions desc
      state.sessions.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));

      state.matches = cloudMatches.map(m => ({
        id: m.id,
        sessionId: m.session_id,
        roundNumber: m.roundNumber || m.round_number,
        records: Array.isArray(m.records) ? m.records : (typeof m.records === 'string' ? JSON.parse(m.records) : []),
        createdAt: m.created_at
      }));

      // Respect session locked mode if set via URL (?session=ID)
      if (state.isSessionLockedMode && state.lockedSessionId) {
        if (state.sessions.some(s => s.id === state.lockedSessionId)) {
          state.currentSessionId = state.lockedSessionId;
        }
      } else if (!state.currentSessionId || !state.sessions.some(s => s.id === state.currentSessionId)) {
        state.currentSessionId = state.sessions[0]?.id || null;
      }

      // Update local storage cache
      localStorage.setItem(STORAGE_KEYS.PLAYERS, JSON.stringify(state.players));
      localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(state.sessions));
      localStorage.setItem(STORAGE_KEYS.MATCHES, JSON.stringify(state.matches));
      if (state.currentSessionId) {
        localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION, state.currentSessionId);
      }

      renderAll();
      updateSessionLockedBadge();
      lucide.createIcons();
      updateCloudSyncUI('synced');
      if (isManual) {
        showToast('クラウドから最新データを反映しました', 'success');
      }
    } else {
      updateCloudSyncUI('synced');
    }
  } catch (err) {
    console.error('Failed to pull from cloud:', err);
    updateCloudSyncUI('error', '取得エラー');
    if (isManual) {
      showToast('クラウドからのデータ取得に失敗しました', 'error');
    }
  }
}

// ----------------------------------------------------------------------------
// クラウド一括アップロード（初回移行やバックアップ時のみ利用）
// ----------------------------------------------------------------------------
let isCloudSyncing = false;
async function pushStateToCloud() {
  if (!supabaseClient || isCloudSyncing) return;
  isCloudSyncing = true;

  try {
    if (state.players.length > 0) {
      const pPayload = state.players.map(p => ({
        id: p.id,
        name: p.name,
        created_at: p.createdAt || new Date().toISOString()
      }));
      await supabaseClient.from('players').upsert(pPayload, { onConflict: 'id' });
    }

    if (state.sessions.length > 0) {
      const sPayload = state.sessions.map(s => ({
        id: s.id,
        date: s.date,
        location: s.location || '',
        memo: s.memo || '',
        player_ids: s.playerIds || [],
        table_fee: s.settlement?.tableFee || s.tableFee || 0,
        rate: s.settlement?.rate || s.rate || 100,
        created_at: s.createdAt || new Date().toISOString()
      }));
      await supabaseClient.from('sessions').upsert(sPayload, { onConflict: 'id' });

      const setPayload = state.sessions
        .filter(s => s.settlement)
        .map(s => ({
          id: 'set_' + s.id,
          session_id: s.id,
          details: s.settlement,
          updated_at: new Date().toISOString()
        }));
      if (setPayload.length > 0) {
        await supabaseClient.from('settlements').upsert(setPayload, { onConflict: 'id' });
      }
    }

    if (state.matches.length > 0) {
      const mPayload = state.matches.map(m => ({
        id: m.id,
        session_id: m.sessionId,
        round_number: m.roundNumber,
        records: m.records || [],
        created_at: m.createdAt || new Date().toISOString()
      }));
      await supabaseClient.from('matches').upsert(mPayload, { onConflict: 'id' });
    }

    updateCloudSyncUI('synced');
  } catch (err) {
    console.error('Failed to sync to cloud:', err);
    updateCloudSyncUI('error', '保存エラー');
  } finally {
    isCloudSyncing = false;
  }
}

async function migrateLocalDataToCloud(isSilent = false) {
  if (!supabaseClient) {
    showToast('Supabaseクライアントが利用できません', 'error');
    return;
  }

  if (!isSilent) {
    if (!confirm('現在の端末に保存されているデータをクラウドデータベースへアップロードしますか？')) {
      return;
    }
  }

  updateCloudSyncUI('syncing');
  if (!isSilent) showToast('クラウドへデータをアップロード中...', 'info');

  try {
    await pushStateToCloud();
    updateCloudSyncUI('synced');
    if (!isSilent) showToast('クラウドへのデータ移行が完了しました！', 'success');

    const resultMsg = document.getElementById('cloud-sync-result-msg');
    if (resultMsg) {
      resultMsg.classList.remove('hidden');
      resultMsg.innerHTML = `<span class="text-emerald-400 font-semibold">✓ クラウドDB同期完了:</span> プレイヤー${state.players.length}名 / セッション${state.sessions.length}件 / 対局${state.matches.length}戦 を反映しました (${new Date().toLocaleTimeString()})`;
    }
  } catch (err) {
    console.error('Migration error:', err);
    updateCloudSyncUI('error', '移行エラー');
    if (!isSilent) showToast('クラウドへの移行中にエラーが発生しました', 'error');
  }
}

function manualCloudSync() {
  pullLatestDataFromCloud(true);
}

// ----------------------------------------------------------------------------
// Realtimeスマート購読（他セッションの更新で自卓の入力フォームを壊さない）
// ----------------------------------------------------------------------------
function setupRealtimeSubscription() {
  if (!supabaseClient) return;

  try {
    realtimeChannel = supabaseClient
      .channel('scoretrack-app-smart-realtime-channel')
      .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
        handleRealtimeChange(payload);
      })
      .subscribe();
  } catch (err) {
    console.warn('Realtime subscription skipped or error:', err);
  }
}

function handleRealtimeChange(payload) {
  const { table, eventType, new: newRec, old: oldRec } = payload;
  console.log(`Realtime change [${table}][${eventType}]:`, payload);

  if (table === 'matches') {
    const matchId = newRec?.id || oldRec?.id;
    const matchSessionId = newRec?.session_id || oldRec?.session_id;

    // 自分の直近の更新（2秒以内）であればエコーバックによる再描画を完全に無視
    if (isMyRecentUpdate(matchId)) {
      console.log('Skipping echo-back re-render for self-updated match:', matchId);
      return;
    }

    if (eventType === 'DELETE') {
      state.matches = state.matches.filter(m => m.id !== matchId);
      localStorage.setItem(STORAGE_KEYS.MATCHES, JSON.stringify(state.matches));
      if (matchSessionId === state.currentSessionId) {
        renderSessionView();
      }
      return;
    }

    // INSERT or UPDATE
    const formattedMatch = {
      id: newRec.id,
      sessionId: newRec.session_id,
      roundNumber: newRec.round_number,
      records: Array.isArray(newRec.records) ? newRec.records : (typeof newRec.records === 'string' ? JSON.parse(newRec.records) : []),
      createdAt: newRec.created_at
    };

    const existingIdx = state.matches.findIndex(m => m.id === formattedMatch.id);
    if (existingIdx >= 0) {
      state.matches[existingIdx] = formattedMatch;
    } else {
      state.matches.unshift(formattedMatch);
    }
    localStorage.setItem(STORAGE_KEYS.MATCHES, JSON.stringify(state.matches));

    // セッション判定
    if (matchSessionId === state.currentSessionId) {
      // 担当中の卓に外部から更新が届いた場合
      renderSessionView();
      showToast(`第${formattedMatch.roundNumber}戦のスコアが更新されました`, 'info');
    } else {
      // 他セッションの更新！現在の対局入力フォームは一切触らず、裏の集計データのみ更新
      console.log(`他卓 (${matchSessionId}) の対局が更新されました。現在の入力画面は安全に保護されました。`);
    }

  } else if (table === 'sessions') {
    if (eventType === 'DELETE') {
      state.sessions = state.sessions.filter(s => s.id !== oldRec.id);
    } else {
      const formattedSession = {
        id: newRec.id,
        date: newRec.date,
        location: newRec.location || '',
        memo: newRec.memo || '',
        playerIds: Array.isArray(newRec.player_ids) ? newRec.player_ids : (typeof newRec.player_ids === 'string' ? JSON.parse(newRec.player_ids) : []),
        tableFee: parseFloat(newRec.table_fee) || 0,
        rate: parseFloat(newRec.rate) || 100,
        createdAt: newRec.created_at
      };
      const existingIdx = state.sessions.findIndex(s => s.id === formattedSession.id);
      if (existingIdx >= 0) {
        state.sessions[existingIdx] = { ...state.sessions[existingIdx], ...formattedSession };
      } else {
        state.sessions.unshift(formattedSession);
      }
    }
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(state.sessions));
    renderSessionSelector();

  } else if (table === 'players') {
    if (eventType === 'DELETE') {
      state.players = state.players.filter(p => p.id !== oldRec.id);
    } else {
      const p = { id: newRec.id, name: newRec.name, createdAt: newRec.created_at };
      const idx = state.players.findIndex(x => x.id === p.id);
      if (idx >= 0) state.players[idx] = p;
      else state.players.push(p);
    }
    localStorage.setItem(STORAGE_KEYS.PLAYERS, JSON.stringify(state.players));
  }
}

function initializeDefaultData() {
  const now = new Date();
  const todayStr = getTodayDateString();

  const defaultPlayers = [
    { id: 'p_1', name: 'プレイヤー1', createdAt: now.toISOString() },
    { id: 'p_2', name: 'プレイヤー2', createdAt: now.toISOString() },
    { id: 'p_3', name: 'プレイヤー3', createdAt: now.toISOString() },
    { id: 'p_4', name: 'プレイヤー4', createdAt: now.toISOString() },
  ];

  const defaultSession = {
    id: 's_default_' + Date.now(),
    date: todayStr,
    location: '自宅卓',
    playerIds: ['p_1', 'p_2', 'p_3', 'p_4'],
    createdAt: now.toISOString()
  };

  state.players = defaultPlayers;
  state.sessions = [defaultSession];
  state.currentSessionId = defaultSession.id;
  state.matches = [];
  saveData();
}

// ============================================================================
// Navigation & Tab Switching
// ============================================================================
function switchTab(tabName) {
  state.activeTab = tabName;
  const tabs = ['session', 'settlement', 'settlement-history', 'stats', 'players', 'data'];

  tabs.forEach(tab => {
    const content = document.getElementById(`tab-content-${tab}`);
    const deskBtn = document.getElementById(`tab-btn-${tab}`);
    const mobBtn = document.getElementById(`mobile-tab-${tab}`);

    if (tab === tabName) {
      if (content) content.classList.remove('hidden');
      if (deskBtn) {
        deskBtn.className = 'tab-btn px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 flex items-center gap-1.5 bg-brand-500 text-white shadow-sm';
      }
      if (mobBtn) {
        mobBtn.className = 'flex flex-col items-center py-1 px-1.5 rounded-lg text-brand-400';
      }
    } else {
      if (content) content.classList.add('hidden');
      if (deskBtn) {
        deskBtn.className = 'tab-btn px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 flex items-center gap-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60';
      }
      if (mobBtn) {
        mobBtn.className = 'flex flex-col items-center py-1 px-1.5 rounded-lg text-slate-400';
      }
    }
  });

  if (tabName === 'settlement') {
    renderSettlementView();
  } else if (tabName === 'settlement-history') {
    populateSettlementHistoryLocationFilter();
    renderSettlementHistoryView();
  } else if (tabName === 'stats') {
    populateStatsLocationFilter();
    renderStatsTable();
  } else if (tabName === 'players') {
    renderPlayersList();
  } else if (tabName === 'session') {
    renderSessionView();
  }

  lucide.createIcons();
}

// ============================================================================
// Render Dispatcher
// ============================================================================
function renderAll() {
  renderSessionSelector();
  renderSessionView();
  renderSettlementView();
  renderPlayersList();
  populateStatsLocationFilter();
  renderStatsTable();
  lucide.createIcons();
}

// ============================================================================
// Session Management
// ============================================================================
function getCurrentSession() {
  return state.sessions.find(s => s.id === state.currentSessionId) || null;
}

function renderSessionSelector() {
  const selector = document.getElementById('session-selector');
  if (!selector) return;

  selector.innerHTML = '';
  if (state.sessions.length === 0) {
    selector.innerHTML = '<option value="">(セッションがありません)</option>';
    return;
  }

  // Sort sessions descending by date, then createdAt
  const sortedSessions = [...state.sessions].sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  sortedSessions.forEach(session => {
    const opt = document.createElement('option');
    opt.value = session.id;
    const matchCount = state.matches.filter(m => m.sessionId === session.id).length;
    opt.textContent = `${session.date} | ${session.location} (${matchCount}戦)`;
    if (session.id === state.currentSessionId) {
      opt.selected = true;
    }
    selector.appendChild(opt);
  });
}

function onSelectSession(sessionId) {
  if (!sessionId) return;
  state.currentSessionId = sessionId;
  saveData();

  const targetSession = state.sessions.find(s => s.id === sessionId);
  if (targetSession) {
    checkSessionEditorLock(targetSession);
  }

  renderSessionView();
  updateSessionLockedBadge();
  lucide.createIcons();
}

function renderSessionView() {
  const session = getCurrentSession();
  const sessionDateBadge = document.getElementById('session-date-badge');
  const sessionLocBadge = document.getElementById('session-location-badge');
  const sessionMatchBadge = document.getElementById('session-match-count-badge');
  const sessionTitle = document.getElementById('session-title-display');

  updateSessionLockedBadge();

  if (!session) {
    if (sessionDateBadge) sessionDateBadge.textContent = '-';
    if (sessionLocBadge) sessionLocBadge.textContent = '-';
    if (sessionMatchBadge) sessionMatchBadge.textContent = '0戦';
    if (sessionTitle) sessionTitle.textContent = 'セッションを作成してください';
    document.getElementById('sticky-player-cards').innerHTML = '';
    document.getElementById('matches-list-container').innerHTML = '';
    document.getElementById('matches-empty-state').classList.remove('hidden');
    return;
  }

  const currentMatches = state.matches.filter(m => m.sessionId === session.id);
  sessionDateBadge.textContent = session.date;
  sessionLocBadge.textContent = session.location;
  sessionMatchBadge.textContent = `全${currentMatches.length}戦`;
  sessionTitle.textContent = `${session.location} (${session.date})`;

  document.getElementById('matches-status-pill').textContent = `${currentMatches.length} 半荘`;
  document.getElementById('sticky-rounds-count').textContent = `（全${currentMatches.length}戦）`;

  // Render Seat selects inside drawer
  renderSeatPlayerSelects(session);

  // Render Sticky Header cards
  renderStickySummaryCards(session, currentMatches);

  // Render Matches List
  renderMatchesList(session, currentMatches);
}

function renderSeatPlayerSelects(session) {
  for (let i = 0; i < 4; i++) {
    const select = document.getElementById(`seat-player-${i}`);
    if (!select) continue;
    select.innerHTML = '<option value="">(未選択)</option>';
    state.players.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (session.playerIds && session.playerIds[i] === p.id) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }
}

function updateSeatPlayer(seatIndex, playerId) {
  const session = getCurrentSession();
  if (!session) return;
  if (!session.playerIds) session.playerIds = ['', '', '', ''];
  session.playerIds[seatIndex] = playerId;

  claimSessionEditorLock(session);
  saveData();
  syncSingleSession(session);
  renderSessionView();
  showToast(`席${seatIndex + 1}のプレイヤーを更新しました`, 'info');
}

function togglePlayerSelectSection() {
  const drawer = document.getElementById('player-select-drawer');
  if (drawer) {
    drawer.classList.toggle('hidden');
  }
}

// ============================================================================
// Sticky Header Live Summary
// ============================================================================
function renderStickySummaryCards(session, currentMatches) {
  const container = document.getElementById('sticky-player-cards');
  if (!container) return;

  container.innerHTML = '';
  const playerIds = session.playerIds || ['', '', '', ''];

  playerIds.forEach((pid, seatIdx) => {
    const player = state.players.find(p => p.id === pid);
    const playerName = player ? player.name : `席${seatIdx + 1}(未設定)`;

    // Calculate sum of scores and average rank in this session
    let totalScore = 0;
    let rankSum = 0;
    let matchCount = 0;

    currentMatches.forEach(m => {
      const record = m.records.find(r => r.playerId === pid);
      if (record && record.score !== null && record.score !== undefined && record.score !== '') {
        const val = parseFloat(record.score);
        if (!isNaN(val)) {
          totalScore += val;
          rankSum += parseInt(record.rank || 0, 10);
          matchCount++;
        }
      }
    });

    // Round totalScore to 1 decimal place
    totalScore = Math.round(totalScore * 10) / 10;
    const avgRank = matchCount > 0 ? (rankSum / matchCount).toFixed(2) : '-';

    const card = document.createElement('div');
    card.className = `bg-dark-900/90 rounded-xl p-2 sm:p-2.5 border-l-4 ${SEAT_BORDER_CLASSES[seatIdx]} border border-slate-700/60 shadow flex flex-col justify-between`;

    const scoreColor = totalScore > 0 ? 'text-emerald-400 font-bold' : totalScore < 0 ? 'text-rose-400 font-bold' : 'text-slate-300';
    const scoreSign = totalScore > 0 ? '+' : '';

    card.innerHTML = `
      <div class="flex items-center justify-between gap-1 mb-1">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-[10px] font-black px-1 rounded bg-slate-800 ${SEAT_COLORS[seatIdx]}">${SEAT_SHORT[seatIdx]}</span>
          <span class="text-xs font-semibold text-slate-200 truncate" title="${escapeHtml(playerName)}">${escapeHtml(playerName)}</span>
        </div>
        <span class="text-[10px] text-slate-400 font-mono">${matchCount}戦</span>
      </div>
      <div class="flex items-baseline justify-between mt-0.5">
        <div class="text-sm sm:text-base font-mono-score ${scoreColor}">
          ${scoreSign}${totalScore.toFixed(1)}
        </div>
        <div class="text-[10px] sm:text-xs text-slate-400">
          平: <span class="font-mono-score text-slate-200 font-semibold">${avgRank}</span><span class="text-[10px]">位</span>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

// ============================================================================
// Matches Input & Validation
// ============================================================================
function renderMatchesList(session, currentMatches) {
  const container = document.getElementById('matches-list-container');
  const emptyState = document.getElementById('matches-empty-state');
  if (!container) return;

  container.innerHTML = '';
  if (currentMatches.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }
  if (emptyState) emptyState.classList.add('hidden');

  // Sort matches by roundNumber
  const sortedMatches = [...currentMatches].sort((a, b) => a.roundNumber - b.roundNumber);

  sortedMatches.forEach((match, matchIndex) => {
    const card = createMatchCardElement(match, session);
    container.appendChild(card);
  });
}

function createMatchCardElement(match, session) {
  const card = document.createElement('div');
  card.id = `match-card-${match.id}`;
  card.className = 'bg-dark-800/95 border border-slate-700/80 rounded-2xl p-3 sm:p-4 shadow-md transition space-y-3';

  // Calculate sum and validation state
  const { sum, isZero } = calculateMatchScoreSum(match);
  const sumFormatted = (sum > 0 ? '+' : '') + sum.toFixed(1);

  // Validation pill
  let validationPillHtml = '';
    // Validation pill container
    const validationPillContainer = `
      <div id="validation-pill-${match.id}" class="inline-flex items-center">
        ${getValidationPillHtml(sum, isZero)}
      </div>
    `;

  // Header of match card
  let html = `
    <div class="flex items-center justify-between border-b border-slate-700/60 pb-2.5">
      <div class="flex items-center gap-2">
        <span class="w-6 h-6 rounded-lg bg-slate-700 flex items-center justify-center text-xs font-bold text-white">
          ${match.roundNumber}
        </span>
        <h4 class="text-sm font-bold text-white">第${match.roundNumber}戦</h4>
        ${validationPillContainer}
      </div>
      <div class="flex items-center gap-1">
        <button onclick="deleteMatch('${match.id}')" title="この対局を削除" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
    </div>
  `;

  // Grid for 4 players' score inputs & ranks
  html += `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">`;

  const sessionPlayers = session.playerIds || [];

  for (let seatIdx = 0; seatIdx < 4; seatIdx++) {
    const playerId = sessionPlayers[seatIdx] || '';
    const player = state.players.find(p => p.id === playerId);
    const playerName = player ? player.name : `席${seatIdx + 1}(未設定)`;

    // Find record for this seat / player
    let record = match.records.find(r => r.playerId === playerId);
    if (!record) {
      record = match.records[seatIdx] || { playerId: playerId, score: '', rank: seatIdx + 1, manualRank: false };
    }

    const currentScore = record.score !== null && record.score !== undefined ? record.score : '';
    const currentRank = record.rank || (seatIdx + 1);
    const rankBadgeClass = getRankBadgeClass(currentRank);

    html += `
      <div class="bg-dark-900/90 rounded-xl p-2.5 border-l-4 ${SEAT_BORDER_CLASSES[seatIdx]} border border-slate-700/60 space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="text-[10px] font-black px-1 rounded bg-slate-800 ${SEAT_COLORS[seatIdx]}">${SEAT_SHORT[seatIdx]}</span>
            <span class="text-xs font-semibold text-slate-200 truncate" title="${escapeHtml(playerName)}">${escapeHtml(playerName)}</span>
          </div>
          
          <!-- Rank Dropdown (Auto-calculated, manually overridable) -->
          <div class="flex items-center gap-1">
            <select
              id="rank-select-${match.id}-${playerId || seatIdx}"
              onchange="handleRankChange('${match.id}', '${playerId || seatIdx}', this.value)"
              class="text-[11px] font-bold py-0.5 px-1.5 rounded border ${rankBadgeClass} bg-dark-850 cursor-pointer focus:outline-none transition"
            >
              <option value="1" ${currentRank == 1 ? 'selected' : ''}>1位</option>
              <option value="2" ${currentRank == 2 ? 'selected' : ''}>2位</option>
              <option value="3" ${currentRank == 3 ? 'selected' : ''}>3位</option>
              <option value="4" ${currentRank == 4 ? 'selected' : ''}>4位</option>
            </select>
          </div>
        </div>

        <!-- Score Input & Quick +/- Toggle -->
        <div class="flex items-center gap-1.5">
          <div class="relative flex-1">
            <input
              type="number"
              step="any"
              inputmode="decimal"
              placeholder="0.0"
              value="${currentScore}"
              oninput="handleScoreInput('${match.id}', '${playerId || seatIdx}', this.value)"
              class="w-full bg-dark-850 border ${!isZero ? 'border-slate-700 focus:border-rose-400' : 'border-slate-700 focus:border-brand-500'} rounded-lg py-1.5 px-2.5 text-right text-sm sm:text-base font-mono-score font-bold text-white focus:outline-none transition"
            >
          </div>
          <button
            type="button"
            onclick="toggleScoreSign('${match.id}', '${playerId || seatIdx}')"
            title="正負（+/-）を切り替え"
            class="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-mono text-xs font-bold transition flex-shrink-0"
          >
            ±
          </button>
        </div>
      </div>
    `;
  }

  html += `</div>`;
  card.innerHTML = html;
  return card;
}

function calculateMatchScoreSum(match) {
  let sum = 0;
  let hasInputs = false;

  match.records.forEach(r => {
    if (r.score !== null && r.score !== undefined && r.score !== '') {
      const val = parseFloat(r.score);
      if (!isNaN(val)) {
        sum += val;
        hasInputs = true;
      }
    }
  });

  // Precision fix for floating point
  sum = Math.round(sum * 100) / 100;
  const isZero = Math.abs(sum) < 0.0001;
  return { sum, isZero, hasInputs };
}

function addNewMatch() {
  const session = getCurrentSession();
  if (!session) {
    showToast('先にセッションを作成してください', 'warning');
    return;
  }

  // Verify that 4 players exist in the session
  const playerIds = session.playerIds || [];
  if (playerIds.filter(Boolean).length < 4) {
    togglePlayerSelectSection();
    showToast('席順に4名のプレイヤーを割り当ててください', 'warning');
    return;
  }

  claimSessionEditorLock(session);

  const currentMatches = state.matches.filter(m => m.sessionId === session.id);
  const nextRoundNumber = currentMatches.length + 1;

  const newMatch = {
    id: 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    sessionId: session.id,
    roundNumber: nextRoundNumber,
    records: playerIds.map((pid, idx) => ({
      playerId: pid,
      score: '',
      rank: idx + 1,
      manualRank: false
    })),
    createdAt: new Date().toISOString()
  };

  state.matches.push(newMatch);
  saveData();
  syncSingleMatch(newMatch);
  renderSessionView();
  lucide.createIcons();

  // Scroll smoothly to the newly created match card
  setTimeout(() => {
    const el = document.getElementById(`match-card-${newMatch.id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const firstInput = el.querySelector('input[type="number"]');
      if (firstInput) firstInput.focus();
    }
  }, 100);

  showToast(`第${nextRoundNumber}戦を追加しました`, 'info');
}

function deleteMatch(matchId) {
  if (!confirm('この対局レコードを削除してもよろしいですか？')) return;

  const match = state.matches.find(m => m.id === matchId);
  const sessionId = match ? match.sessionId : state.currentSessionId;
  const session = getCurrentSession();
  if (session) claimSessionEditorLock(session);

  state.matches = state.matches.filter(m => m.id !== matchId);

  // Renumber remaining rounds in this session
  const sessionMatches = state.matches
    .filter(m => m.sessionId === sessionId)
    .sort((a, b) => (new Date(a.createdAt) - new Date(b.createdAt)));

  sessionMatches.forEach((m, idx) => {
    m.roundNumber = idx + 1;
    syncSingleMatch(m);
  });

  saveData();
  syncDeleteMatch(matchId);
  renderSessionView();
  lucide.createIcons();
  showToast('対局を削除しました', 'info');
}

function handleScoreInput(matchId, playerIdentifier, value) {
  const match = state.matches.find(m => m.id === matchId);
  if (!match) return;

  const session = getCurrentSession();
  if (session) claimSessionEditorLock(session);

  let record = match.records.find(r => r.playerId === playerIdentifier);
  if (!record && !isNaN(parseInt(playerIdentifier, 10))) {
    record = match.records[parseInt(playerIdentifier, 10)];
  }
  if (!record) return;

  record.score = value;

  // Auto-calculate ranks based on scores, unless manually locked
  recalculateRanksForMatch(match);

  saveData();
  debounceSyncMatch(match);

  // Re-render Sticky Summary and this match card (for instant validation reflection)
  const currentMatches = state.matches.filter(m => m.sessionId === session?.id);
  renderStickySummaryCards(session, currentMatches);

  // Update only validation pill & rank select in current match without breaking input focus
  updateMatchCardUIOnly(match, session);
}

function toggleScoreSign(matchId, playerIdentifier) {
  const match = state.matches.find(m => m.id === matchId);
  if (!match) return;

  const session = getCurrentSession();
  if (session) claimSessionEditorLock(session);

  let record = match.records.find(r => r.playerId === playerIdentifier);
  if (!record && !isNaN(parseInt(playerIdentifier, 10))) {
    record = match.records[parseInt(playerIdentifier, 10)];
  }
  if (!record) return;

  if (record.score === '' || record.score === null || record.score === undefined) {
    record.score = '-';
  } else {
    const val = parseFloat(record.score);
    if (!isNaN(val)) {
      record.score = (-val).toString();
    } else if (record.score.startsWith('-')) {
      record.score = record.score.replace('-', '');
    } else {
      record.score = '-' + record.score;
    }
  }

  recalculateRanksForMatch(match);
  saveData();
  debounceSyncMatch(match);
  renderSessionView();
  lucide.createIcons();
}

function handleRankChange(matchId, playerIdentifier, newRank) {
  const match = state.matches.find(m => m.id === matchId);
  if (!match) return;

  const session = getCurrentSession();
  if (session) claimSessionEditorLock(session);

  let record = match.records.find(r => r.playerId === playerIdentifier);
  if (!record && !isNaN(parseInt(playerIdentifier, 10))) {
    record = match.records[parseInt(playerIdentifier, 10)];
  }
  if (!record) return;

  record.rank = parseInt(newRank, 10);
  record.manualRank = true; // flag that user manually overrode rank

  saveData();
  debounceSyncMatch(match);
  renderSessionView();
  lucide.createIcons();
}

function recalculateRanksForMatch(match) {
  // If user has not set manual rank overrides, sort by scores descending
  const hasManual = match.records.some(r => r.manualRank);
  if (hasManual) return; // Respect manual overrides

  // Check if at least one score is numeric
  const numericRecords = match.records.map((r, originalIdx) => {
    const val = parseFloat(r.score);
    return {
      record: r,
      originalIdx,
      scoreVal: isNaN(val) ? -999999 : val
    };
  });

  // Sort by score descending; if tied, retain seat order
  numericRecords.sort((a, b) => {
    if (b.scoreVal !== a.scoreVal) {
      return b.scoreVal - a.scoreVal;
    }
    return a.originalIdx - b.originalIdx;
  });

  numericRecords.forEach((item, sortedIdx) => {
    item.record.rank = sortedIdx + 1;
  });
}

function getValidationPillHtml(sum, isZero) {
  const sumFormatted = (sum > 0 ? '+' : '') + sum.toFixed(1);
  if (isZero) {
    return `
      <div class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-semibold border border-emerald-500/30">
        <i data-lucide="check-circle" class="w-3.5 h-3.5"></i>
        <span>合計 ±0.0 (OK)</span>
      </div>
    `;
  } else {
    const diff = (0 - sum).toFixed(1);
    const diffText = diff > 0 ? `+${diff}` : `${diff}`;
    return `
      <div class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 text-xs font-bold border border-rose-500/40 validation-error-glow">
        <i data-lucide="alert-circle" class="w-3.5 h-3.5"></i>
        <span>合計: ${sumFormatted} (差分: ${diffText})</span>
      </div>
    `;
  }
}

function getRankBadgeClass(rank) {
  const rankColors = {
    1: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    2: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    3: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
    4: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  };
  return rankColors[rank] || 'bg-slate-700 text-slate-200 border-slate-600';
}

function updateMatchCardUIOnly(match, session) {
  const { sum, isZero } = calculateMatchScoreSum(match);

  // Update validation pill smoothly without re-rendering the whole card or breaking input focus
  const pillContainer = document.getElementById(`validation-pill-${match.id}`);
  if (pillContainer) {
    pillContainer.innerHTML = getValidationPillHtml(sum, isZero);
  }

  // Update rank selects
  const sessionPlayers = session.playerIds || [];
  for (let seatIdx = 0; seatIdx < 4; seatIdx++) {
    const playerId = sessionPlayers[seatIdx] || '';
    let record = match.records.find(r => r.playerId === playerId);
    if (!record) {
      record = match.records[seatIdx];
    }
    if (!record) continue;

    const rankSelect = document.getElementById(`rank-select-${match.id}-${playerId || seatIdx}`);
    if (rankSelect) {
      rankSelect.value = record.rank;
      rankSelect.className = `text-[11px] font-bold py-0.5 px-1.5 rounded border ${getRankBadgeClass(record.rank)} bg-dark-850 cursor-pointer focus:outline-none transition`;
    }
  }

  lucide.createIcons();
}

// ============================================================================
// Stats & Aggregation
// ============================================================================
function populateStatsLocationFilter() {
  const filterSelect = document.getElementById('stats-location-filter');
  if (!filterSelect) return;

  const currentValue = filterSelect.value;
  filterSelect.innerHTML = '<option value="ALL">すべての場所・卓（全期間）</option>';

  const locations = [...new Set(state.sessions.map(s => s.location).filter(Boolean))];
  locations.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc;
    opt.textContent = loc;
    if (loc === currentValue) opt.selected = true;
    filterSelect.appendChild(opt);
  });
}

function onStatsDateChange() {
  // Clear preset active styling when manual dates are changed
  document.querySelectorAll('.stats-preset-btn').forEach(btn => {
    btn.className = 'stats-preset-btn px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition active:scale-95 border border-slate-700/80';
  });
  renderStatsTable();
}

function setStatsDatePreset(preset) {
  const fromInput = document.getElementById('stats-date-from');
  const toInput = document.getElementById('stats-date-to');
  if (!fromInput || !toInput) return;

  const now = new Date();
  const todayStr = getTodayDateString();

  if (preset === 'ALL') {
    fromInput.value = '';
    toInput.value = '';
  } else if (preset === 'THIS_MONTH') {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    fromInput.value = `${year}-${month}-01`;
    toInput.value = todayStr;
  } else if (preset === 'LAST_30') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const y = thirtyDaysAgo.getFullYear();
    const m = String(thirtyDaysAgo.getMonth() + 1).padStart(2, '0');
    const d = String(thirtyDaysAgo.getDate()).padStart(2, '0');
    fromInput.value = `${y}-${m}-${d}`;
    toInput.value = todayStr;
  } else if (preset === 'THIS_YEAR') {
    const year = now.getFullYear();
    fromInput.value = `${year}-01-01`;
    toInput.value = todayStr;
  }

  // Update button active state
  document.querySelectorAll('.stats-preset-btn').forEach(btn => {
    btn.className = 'stats-preset-btn px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition active:scale-95 border border-slate-700/80';
  });
  const activeBtn = document.getElementById(`preset-btn-${preset}`);
  if (activeBtn) {
    activeBtn.className = 'stats-preset-btn px-2.5 py-1 rounded-lg text-xs font-semibold bg-brand-500 text-white transition active:scale-95 shadow-sm';
  }

  renderStatsTable();
}

function renderStatsTable() {
  const filterSelect = document.getElementById('stats-location-filter');
  const selectedLocation = filterSelect ? filterSelect.value : 'ALL';
  const fromDateInput = document.getElementById('stats-date-from');
  const toDateInput = document.getElementById('stats-date-to');
  const fromDate = fromDateInput ? fromDateInput.value : '';
  const toDate = toDateInput ? toDateInput.value : '';

  // Filter sessions by selected location AND date range
  let filteredSessions = state.sessions.filter(s => {
    if (selectedLocation !== 'ALL' && s.location !== selectedLocation) {
      return false;
    }
    if (fromDate && s.date < fromDate) {
      return false;
    }
    if (toDate && s.date > toDate) {
      return false;
    }
    return true;
  });
  const sessionIds = new Set(filteredSessions.map(s => s.id));

  // Filter matches belonging to these sessions
  const filteredMatches = state.matches.filter(m => sessionIds.has(m.sessionId));

  // Update summary counts
  document.getElementById('stats-total-sessions').textContent = filteredSessions.length;
  document.getElementById('stats-total-matches').textContent = filteredMatches.length;
  document.getElementById('stats-location-count').textContent = new Set(filteredSessions.map(s => s.location)).size;

  // Aggregate stats per player
  const playerStats = {};

  // Initialize for all existing players
  state.players.forEach(p => {
    playerStats[p.id] = {
      id: p.id,
      name: p.name,
      matchCount: 0,
      r1: 0,
      r2: 0,
      r3: 0,
      r4: 0,
      rankSum: 0,
      totalScore: 0,
    };
  });

  // Calculate from matches
  filteredMatches.forEach(m => {
    m.records.forEach(r => {
      if (!r.playerId) return;
      if (!playerStats[r.playerId]) {
        playerStats[r.playerId] = {
          id: r.playerId,
          name: `不明(${r.playerId})`,
          matchCount: 0,
          r1: 0,
          r2: 0,
          r3: 0,
          r4: 0,
          rankSum: 0,
          totalScore: 0,
        };
      }

      const st = playerStats[r.playerId];
      const val = parseFloat(r.score);
      const hasScore = !isNaN(val);

      if (hasScore || r.rank) {
        st.matchCount++;
        if (hasScore) {
          st.totalScore += val;
        }
        const rank = parseInt(r.rank, 10);
        if (rank === 1) st.r1++;
        else if (rank === 2) st.r2++;
        else if (rank === 3) st.r3++;
        else if (rank === 4) st.r4++;
        if (rank >= 1 && rank <= 4) {
          st.rankSum += rank;
        }
      }
    });
  });

  // Active players count (with at least 1 match)
  const activeCount = Object.values(playerStats).filter(st => st.matchCount > 0).length;
  document.getElementById('stats-active-players').textContent = activeCount;

  // Convert to array and compute rates
  let statsArray = Object.values(playerStats).map(st => {
    const count = st.matchCount;
    const r1Rate = count > 0 ? (st.r1 / count) * 100 : 0;
    const r2Rate = count > 0 ? (st.r2 / count) * 100 : 0;
    const r3Rate = count > 0 ? (st.r3 / count) * 100 : 0;
    const r4Rate = count > 0 ? (st.r4 / count) * 100 : 0;
    const rentai = count > 0 ? ((st.r1 + st.r2) / count) * 100 : 0;
    const avgRank = count > 0 ? st.rankSum / count : 0;
    const avgScore = count > 0 ? st.totalScore / count : 0;

    return {
      ...st,
      totalScore: Math.round(st.totalScore * 10) / 10,
      r1Rate,
      r2Rate,
      r3Rate,
      r4Rate,
      rentai,
      avgRank,
      avgScore
    };
  });

  // Filter out players who have never played if desired (or keep players with >0 matches first)
  // Let's show all registered players, but players with 0 matches come at the bottom when sorting
  const sortCol = state.statsSort.column;
  const sortDir = state.statsSort.direction === 'asc' ? 1 : -1;

  statsArray.sort((a, b) => {
    // If one has 0 matches, rank them lower
    if (a.matchCount === 0 && b.matchCount > 0) return 1;
    if (b.matchCount === 0 && a.matchCount > 0) return -1;

    let valA = a[sortCol];
    let valB = b[sortCol];

    if (sortCol === 'name') {
      return sortDir * a.name.localeCompare(b.name, 'ja');
    }
    if (sortCol === 'avgRank') {
      // For average rank, lower number (1.00) is better
      return (valA - valB) * (state.statsSort.direction === 'asc' ? 1 : -1);
    }

    return (valA - valB) * sortDir;
  });

  // Render Table Body
  const tbody = document.getElementById('stats-table-body');
  const emptyState = document.getElementById('stats-empty-state');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (filteredMatches.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }
  if (emptyState) emptyState.classList.add('hidden');

  statsArray.forEach((st, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/40 transition border-b border-slate-800/60';

    const scoreColor = st.totalScore > 0 ? 'text-emerald-400 font-bold' : st.totalScore < 0 ? 'text-rose-400 font-bold' : 'text-slate-400';
    const avgScoreColor = st.avgScore > 0 ? 'text-emerald-400' : st.avgScore < 0 ? 'text-rose-400' : 'text-slate-400';
    const scoreSign = st.totalScore > 0 ? '+' : '';
    const avgScoreSign = st.avgScore > 0 ? '+' : '';

    tr.innerHTML = `
      <td class="py-3 px-3 sm:px-4 font-medium text-slate-200 flex items-center gap-2">
        <span class="w-5 text-center text-xs text-slate-500 font-mono">${idx + 1}</span>
        <span class="font-sans font-semibold">${escapeHtml(st.name)}</span>
      </td>
      <td class="py-3 px-2 sm:px-3 text-right text-slate-300 font-bold">${st.matchCount}</td>
      <td class="py-3 px-2 sm:px-3 text-right text-amber-300">
        ${st.r1} <span class="text-[10px] text-slate-400">(${st.r1Rate.toFixed(1)}%)</span>
      </td>
      <td class="py-3 px-2 sm:px-3 text-right text-blue-300">
        ${st.r2} <span class="text-[10px] text-slate-400">(${st.r2Rate.toFixed(1)}%)</span>
      </td>
      <td class="py-3 px-2 sm:px-3 text-right text-slate-300">
        ${st.r3} <span class="text-[10px] text-slate-400">(${st.r3Rate.toFixed(1)}%)</span>
      </td>
      <td class="py-3 px-2 sm:px-3 text-right text-rose-300">
        ${st.r4} <span class="text-[10px] text-slate-400">(${st.r4Rate.toFixed(1)}%)</span>
      </td>
      <td class="py-3 px-2 sm:px-3 text-right text-slate-200 font-semibold">${st.rentai.toFixed(1)}%</td>
      <td class="py-3 px-2 sm:px-3 text-right text-slate-200 font-bold">${st.matchCount > 0 ? st.avgRank.toFixed(2) : '-'}</td>
      <td class="py-3 px-3 sm:px-4 text-right ${scoreColor}">${scoreSign}${st.totalScore.toFixed(1)}</td>
      <td class="py-3 px-3 sm:px-4 text-right ${avgScoreColor}">${st.matchCount > 0 ? avgScoreSign + st.avgScore.toFixed(2) : '-'}</td>
    `;

    tbody.appendChild(tr);
  });

  updateSortIcons();
}

function sortStats(column) {
  if (state.statsSort.column === column) {
    state.statsSort.direction = state.statsSort.direction === 'desc' ? 'asc' : 'desc';
  } else {
    state.statsSort.column = column;
    // For avgRank, default to asc (1.0 is top rank)
    state.statsSort.direction = (column === 'avgRank' || column === 'name') ? 'asc' : 'desc';
  }
  renderStatsTable();
}

function updateSortIcons() {
  const columns = ['name', 'matchCount', 'r1', 'r2', 'r3', 'r4', 'rentai', 'avgRank', 'totalScore', 'avgScore'];
  columns.forEach(col => {
    const el = document.getElementById(`sort-icon-${col}`);
    if (!el) return;
    if (state.statsSort.column === col) {
      el.textContent = state.statsSort.direction === 'asc' ? '▲' : '▼';
      el.className = 'text-[10px] text-brand-400 font-bold';
    } else {
      el.textContent = '↕';
      el.className = 'text-[10px] text-slate-500';
    }
  });
}

// ============================================================================
// Players Management
// ============================================================================
function renderPlayersList() {
  const container = document.getElementById('players-list-grid');
  const totalBadge = document.getElementById('players-total-badge');
  const emptyState = document.getElementById('players-empty-state');
  if (!container) return;

  container.innerHTML = '';
  totalBadge.textContent = `${state.players.length}人`;

  if (state.players.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }
  if (emptyState) emptyState.classList.add('hidden');

  state.players.forEach(p => {
    // Count matches participated
    const matchCount = state.matches.filter(m => m.records.some(r => r.playerId === p.id)).length;

    const card = document.createElement('div');
    card.className = 'bg-dark-900 border border-slate-700/80 rounded-xl p-3 flex items-center justify-between shadow-sm';
    card.innerHTML = `
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center font-bold text-xs text-brand-400">
          ${escapeHtml(p.name.charAt(0))}
        </div>
        <div class="min-w-0">
          <h4 class="text-sm font-bold text-white truncate" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h4>
          <span class="text-[10px] text-slate-400">参加対局: ${matchCount}戦</span>
        </div>
      </div>
      <div class="flex items-center gap-1">
        <button onclick="openEditPlayerModal('${p.id}')" title="名前を変更" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
          <i data-lucide="edit" class="w-4 h-4"></i>
        </button>
        <button onclick="deletePlayer('${p.id}')" title="削除" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

function handleCreatePlayer(e) {
  e.preventDefault();
  const input = document.getElementById('new-player-name-input');
  const name = input.value.trim();
  if (!name) return;

  const newPlayer = {
    id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    name: name,
    createdAt: new Date().toISOString()
  };

  state.players.push(newPlayer);
  input.value = '';
  saveData();
  syncSinglePlayer(newPlayer);
  renderAll();
  showToast(`プレイヤー「${name}」を登録しました`, 'success');
}

function openEditPlayerModal(playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;

  document.getElementById('edit-player-id').value = player.id;
  document.getElementById('edit-player-name-input').value = player.name;
  document.getElementById('edit-player-modal').classList.remove('hidden');
  document.getElementById('edit-player-name-input').focus();
  lucide.createIcons();
}

function closeEditPlayerModal() {
  document.getElementById('edit-player-modal').classList.add('hidden');
}

function handleUpdatePlayerName(e) {
  e.preventDefault();
  const id = document.getElementById('edit-player-id').value;
  const newName = document.getElementById('edit-player-name-input').value.trim();
  if (!newName) return;

  const player = state.players.find(p => p.id === id);
  if (player) {
    player.name = newName;
    saveData();
    syncSinglePlayer(player);
    renderAll();
    closeEditPlayerModal();
    showToast(`名前を「${newName}」に更新しました`, 'success');
  }
}

function deletePlayer(playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;

  const matchCount = state.matches.filter(m => m.records.some(r => r.playerId === playerId)).length;
  if (matchCount > 0) {
    if (!confirm(`プレイヤー「${player.name}」には${matchCount}回の対局記録があります。削除すると戦績の表示に影響が出る可能性がありますが、削除しますか？`)) {
      return;
    }
  } else {
    if (!confirm(`プレイヤー「${player.name}」を削除しますか？`)) return;
  }

  state.players = state.players.filter(p => p.id !== playerId);

  // Clear from current session if sitting
  state.sessions.forEach(s => {
    if (s.playerIds) {
      s.playerIds = s.playerIds.map(pid => pid === playerId ? '' : pid);
    }
  });

  saveData();
  syncDeletePlayer(playerId);
  renderAll();
  showToast(`プレイヤー「${player.name}」を削除しました`, 'info');
}

// ============================================================================
// Session Modals & Actions
// ============================================================================
function openNewSessionModal() {
  document.getElementById('session-modal-title').innerHTML = `
    <i data-lucide="plus-circle" class="w-5 h-5 text-brand-400"></i>
    新規対局セッションを作成
  `;
  document.getElementById('modal-session-id').value = '';
  document.getElementById('modal-session-date').value = getTodayDateString();
  document.getElementById('modal-session-location').value = '自宅卓';

  // Hide delete button on new session creation
  const delBtn = document.getElementById('modal-delete-session-btn');
  if (delBtn) delBtn.classList.add('hidden');

  populateModalPlayerSelects(['', '', '', '']);
  populateModalLocationSuggestions();

  document.getElementById('session-modal').classList.remove('hidden');
  lucide.createIcons();
}

function openEditCurrentSessionModal() {
  const session = getCurrentSession();
  if (!session) return;

  document.getElementById('session-modal-title').innerHTML = `
    <i data-lucide="settings" class="w-5 h-5 text-brand-400"></i>
    セッション設定を変更
  `;
  document.getElementById('modal-session-id').value = session.id;
  document.getElementById('modal-session-date').value = session.date;
  document.getElementById('modal-session-location').value = session.location;

  // Show delete button on existing session edit
  const delBtn = document.getElementById('modal-delete-session-btn');
  if (delBtn) delBtn.classList.remove('hidden');

  populateModalPlayerSelects(session.playerIds || ['', '', '', '']);
  populateModalLocationSuggestions();

  document.getElementById('session-modal').classList.remove('hidden');
  lucide.createIcons();
}

function setModalDateShortcut(offsetDays) {
  const dateInput = document.getElementById('modal-session-date');
  if (!dateInput) return;
  if (offsetDays === 0) {
    dateInput.value = getTodayDateString();
  } else if (offsetDays === -1) {
    dateInput.value = getYesterdayDateString();
  } else {
    const d = new Date(Date.now() + offsetDays * 86400000);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dateInput.value = `${year}-${month}-${day}`;
  }
}

function handleDeleteCurrentSessionClick() {
  const session = getCurrentSession();
  if (!session) {
    showToast('削除対象のセッションがありません', 'warning');
    return;
  }
  deleteSession(session.id);
}

function deleteSession(sessionId) {
  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return;

  const sessionMatches = state.matches.filter(m => m.sessionId === sessionId);
  const matchCount = sessionMatches.length;

  const msg = `セッション「${session.date} ${session.location || '卓'}」を削除しますか？\n\n※このセッションに含まれる全${matchCount}戦の対局記録・精算データもすべて削除されます。この操作は取り消せません。`;
  if (!confirm(msg)) {
    return;
  }

  // Filter out session and its matches
  state.sessions = state.sessions.filter(s => s.id !== sessionId);
  state.matches = state.matches.filter(m => m.sessionId !== sessionId);

  // Switch current session if deleted
  if (state.currentSessionId === sessionId) {
    state.currentSessionId = state.sessions.length > 0 ? state.sessions[0].id : null;
  }

  // If no sessions left, create a fresh default session
  if (state.sessions.length === 0) {
    const now = new Date();
    const defaultSession = {
      id: 's_default_' + Date.now(),
      date: getTodayDateString(),
      location: '自宅卓',
      playerIds: state.players.slice(0, 4).map(p => p.id),
      createdAt: now.toISOString()
    };
    state.sessions = [defaultSession];
    state.currentSessionId = defaultSession.id;
  }

  saveData();
  syncDeleteSession(sessionId);
  closeSessionModal();
  renderAll();
  showToast('セッションを削除しました', 'info');
}

function closeSessionModal() {
  document.getElementById('session-modal').classList.add('hidden');
}

function populateModalPlayerSelects(currentSelectedIds) {
  for (let i = 0; i < 4; i++) {
    const sel = document.getElementById(`modal-seat-${i}`);
    if (!sel) continue;
    sel.innerHTML = `<option value="">(席${i + 1}: 未選択)</option>`;
    state.players.forEach((p, pIdx) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      // If currentSelectedIds has value, select it, otherwise default to pIdx if available
      if (currentSelectedIds[i] === p.id || (!currentSelectedIds[i] && pIdx === i)) {
        opt.selected = true;
      }
      sel.appendChild(opt);
    });
  }
}

function populateModalLocationSuggestions() {
  const container = document.getElementById('modal-location-suggestions');
  if (!container) return;

  const pastLocations = [...new Set(state.sessions.map(s => s.location).filter(Boolean))];
  const defaults = ['自宅卓', '新宿A卓', '新宿B卓', '秋葉原卓', '部室卓', '大会予選'];
  const allSuggestions = [...new Set([...pastLocations, ...defaults])].slice(0, 6);

  container.innerHTML = '';
  allSuggestions.forEach(loc => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 hover:bg-brand-600 hover:text-white transition';
    btn.textContent = loc;
    btn.onclick = () => {
      document.getElementById('modal-session-location').value = loc;
    };
    container.appendChild(btn);
  });
}

function handleSaveSession(e) {
  e.preventDefault();
  const sessionId = document.getElementById('modal-session-id').value;
  const date = document.getElementById('modal-session-date').value;
  const location = document.getElementById('modal-session-location').value.trim();

  const playerIds = [
    document.getElementById('modal-seat-0').value,
    document.getElementById('modal-seat-1').value,
    document.getElementById('modal-seat-2').value,
    document.getElementById('modal-seat-3').value,
  ];

  let savedSession = null;

  if (!sessionId) {
    // Create new
    const newSession = {
      id: 's_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      date: date,
      location: location,
      playerIds: playerIds,
      createdAt: new Date().toISOString()
    };
    state.sessions.unshift(newSession);
    state.currentSessionId = newSession.id;
    savedSession = newSession;
    showToast('新しい対局セッションを作成しました', 'success');
  } else {
    // Update existing
    const session = state.sessions.find(s => s.id === sessionId);
    if (session) {
      session.date = date;
      session.location = location;
      session.playerIds = playerIds;
      savedSession = session;
      showToast('セッション設定を更新しました', 'success');
    }
  }

  saveData();
  if (savedSession) {
    claimSessionEditorLock(savedSession);
    syncSingleSession(savedSession);
  }
  closeSessionModal();
  renderAll();
}

// ============================================================================
// Data Backup, Import & Export
// ============================================================================
function exportDataToFile() {
  const exportPayload = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    players: state.players,
    sessions: state.sessions,
    matches: state.matches
  };

  const jsonStr = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = getTodayDateString().replace(/-/g, '');
  a.href = url;
  a.download = `scoretrack_backup_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('JSONファイルをダウンロードしました', 'success');
}

function copyDataToClipboard() {
  const exportPayload = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    players: state.players,
    sessions: state.sessions,
    matches: state.matches
  };
  const jsonStr = JSON.stringify(exportPayload, null, 2);
  navigator.clipboard.writeText(jsonStr).then(() => {
    showToast('クリップボードにバックアップJSONをコピーしました', 'success');
  }).catch(() => {
    showToast('コピーに失敗しました', 'error');
  });
}

function handleFileImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      applyImportedData(data);
    } catch (err) {
      showToast('無効なJSONファイルです', 'error');
    }
  };
  reader.readAsText(file);
}

function handleTextImport() {
  const textarea = document.getElementById('json-import-textarea');
  const text = textarea.value.trim();
  if (!text) {
    showToast('JSON文字列を入力してください', 'warning');
    return;
  }
  try {
    const data = JSON.parse(text);
    applyImportedData(data);
    textarea.value = '';
  } catch (err) {
    showToast('JSONの解析に失敗しました。書式をご確認ください', 'error');
  }
}

function applyImportedData(data) {
  if (!data || (!data.players && !data.sessions && !data.matches)) {
    showToast('復元に必要なデータが含まれていません', 'error');
    return;
  }

  if (!confirm('既存のデータが上書きされます。インポートを実行しますか？')) {
    return;
  }

  state.players = Array.isArray(data.players) ? data.players : [];
  state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
  state.matches = Array.isArray(data.matches) ? data.matches : [];
  state.currentSessionId = state.sessions[0]?.id || null;

  saveData();
  renderAll();
  showToast('データを正常に復元しました', 'success');
}

function loadSampleData() {
  if (!confirm('デモ用のサンプル対局データをロードしますか？（現在のデータは置き換えられます）')) {
    return;
  }

  const now = new Date();
  const players = [
    { id: 'p_sakura', name: '佐倉', createdAt: now.toISOString() },
    { id: 'p_takahashi', name: '高橋', createdAt: now.toISOString() },
    { id: 'p_watanabe', name: '渡辺', createdAt: now.toISOString() },
    { id: 'p_kobayashi', name: '小林', createdAt: now.toISOString() },
    { id: 'p_suzuki', name: '鈴木', createdAt: now.toISOString() },
  ];

  const session1 = {
    id: 's_sample_1',
    date: getTodayDateString(),
    location: '新宿A卓',
    playerIds: ['p_sakura', 'p_takahashi', 'p_watanabe', 'p_kobayashi'],
    createdAt: now.toISOString()
  };

  const session2 = {
    id: 's_sample_2',
    date: getYesterdayDateString(),
    location: '自宅卓',
    playerIds: ['p_sakura', 'p_suzuki', 'p_watanabe', 'p_kobayashi'],
    createdAt: new Date(Date.now() - 86400000).toISOString()
  };

  const matches = [
    // Session 1: 3 matches
    {
      id: 'm_s1_1',
      sessionId: 's_sample_1',
      roundNumber: 1,
      records: [
        { playerId: 'p_sakura', score: '48.5', rank: 1, manualRank: false },
        { playerId: 'p_takahashi', score: '12.2', rank: 2, manualRank: false },
        { playerId: 'p_watanabe', score: '-15.4', rank: 3, manualRank: false },
        { playerId: 'p_kobayashi', score: '-45.3', rank: 4, manualRank: false },
      ],
      createdAt: now.toISOString()
    },
    {
      id: 'm_s1_2',
      sessionId: 's_sample_1',
      roundNumber: 2,
      records: [
        { playerId: 'p_sakura', score: '-18.0', rank: 3, manualRank: false },
        { playerId: 'p_takahashi', score: '35.6', rank: 1, manualRank: false },
        { playerId: 'p_watanabe', score: '14.4', rank: 2, manualRank: false },
        { playerId: 'p_kobayashi', score: '-32.0', rank: 4, manualRank: false },
      ],
      createdAt: now.toISOString()
    },
    {
      id: 'm_s1_3',
      sessionId: 's_sample_1',
      roundNumber: 3,
      records: [
        { playerId: 'p_sakura', score: '52.1', rank: 1, manualRank: false },
        { playerId: 'p_takahashi', score: '-38.4', rank: 4, manualRank: false },
        { playerId: 'p_watanabe', score: '-22.7', rank: 3, manualRank: false },
        { playerId: 'p_kobayashi', score: '9.0', rank: 2, manualRank: false },
      ],
      createdAt: now.toISOString()
    },
    // Session 2: 2 matches
    {
      id: 'm_s2_1',
      sessionId: 's_sample_2',
      roundNumber: 1,
      records: [
        { playerId: 'p_sakura', score: '24.0', rank: 2, manualRank: false },
        { playerId: 'p_suzuki', score: '41.5', rank: 1, manualRank: false },
        { playerId: 'p_watanabe', score: '-18.5', rank: 3, manualRank: false },
        { playerId: 'p_kobayashi', score: '-47.0', rank: 4, manualRank: false },
      ],
      createdAt: new Date(Date.now() - 86400000).toISOString()
    },
    {
      id: 'm_s2_2',
      sessionId: 's_sample_2',
      roundNumber: 2,
      records: [
        { playerId: 'p_sakura', score: '-36.2', rank: 4, manualRank: false },
        { playerId: 'p_suzuki', score: '-12.0', rank: 3, manualRank: false },
        { playerId: 'p_watanabe', score: '15.8', rank: 2, manualRank: false },
        { playerId: 'p_kobayashi', score: '32.4', rank: 1, manualRank: false },
      ],
      createdAt: new Date(Date.now() - 86400000).toISOString()
    },
  ];

  state.players = players;
  state.sessions = [session1, session2];
  state.matches = matches;
  state.currentSessionId = session1.id;

  saveData();
  renderAll();
  switchTab('session');
  showToast('サンプル対局データを投入しました', 'success');
}

function confirmResetAllData() {
  if (!confirm('本当にすべてのデータを初期化しますか？この操作は取り消せません。')) return;

  localStorage.removeItem(STORAGE_KEYS.PLAYERS);
  localStorage.removeItem(STORAGE_KEYS.SESSIONS);
  localStorage.removeItem(STORAGE_KEYS.MATCHES);
  localStorage.removeItem(STORAGE_KEYS.CURRENT_SESSION);

  initializeDefaultData();
  renderAll();
  switchTab('session');
  showToast('データを全初期化しました', 'info');
}

// ============================================================================
// Utilities
// ============================================================================
function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getYesterdayDateString() {
  const d = new Date(Date.now() - 86400000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
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
  const typeStyles = {
    success: 'bg-emerald-600 text-white border-emerald-400',
    error: 'bg-rose-600 text-white border-rose-400',
    warning: 'bg-amber-600 text-white border-amber-400',
    info: 'bg-slate-800 text-slate-100 border-slate-600'
  };

  const icons = {
    success: 'check-circle-2',
    error: 'alert-triangle',
    warning: 'alert-circle',
    info: 'info'
  };

  toast.className = `flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-medium shadow-2xl transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto ${typeStyles[type] || typeStyles.info}`;
  toast.innerHTML = `
    <i data-lucide="${icons[type] || 'info'}" class="w-4 h-4 flex-shrink-0"></i>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// ============================================================================
// TAB: 精算・会計（Settlement View & Calculations）
// ============================================================================

function ensureSessionSettlement(session) {
  if (!session) return null;
  if (!session.settlement) {
    session.settlement = {
      rate: 100,
      tableFee: 0,
      players: {}
    };
  }
  if (session.settlement.rate === undefined || session.settlement.rate === null) {
    session.settlement.rate = 100;
  }
  if (session.settlement.tableFee === undefined || session.settlement.tableFee === null) {
    session.settlement.tableFee = 0;
  }
  if (!session.settlement.players) {
    session.settlement.players = {};
  }
  return session.settlement;
}

function renderSettlementView() {
  const session = getCurrentSession();
  const dateEl = document.getElementById('settlement-session-date');
  const locEl = document.getElementById('settlement-session-location');
  const matchesEl = document.getElementById('settlement-session-matches');
  const container = document.getElementById('settlement-player-cards');
  const rateInput = document.getElementById('settlement-rate-input');
  const tableFeeInput = document.getElementById('settlement-table-fee-input');

  if (!session) {
    if (dateEl) dateEl.textContent = '-';
    if (locEl) locEl.textContent = '-';
    if (matchesEl) matchesEl.textContent = '0戦';
    if (container) container.innerHTML = '<div class="col-span-full text-center py-10 text-slate-400 text-xs">セッションが選択されていません</div>';
    return;
  }

  const currentMatches = state.matches.filter(m => m.sessionId === session.id);
  const settlement = ensureSessionSettlement(session);

  if (dateEl) dateEl.textContent = session.date;
  if (locEl) locEl.textContent = session.location;
  if (matchesEl) matchesEl.textContent = `全${currentMatches.length}戦`;

  // Sync inputs with state
  if (rateInput && document.activeElement !== rateInput) {
    rateInput.value = settlement.rate;
  }
  if (tableFeeInput && document.activeElement !== tableFeeInput) {
    tableFeeInput.value = settlement.tableFee || '';
  }

  const feePerPerson = Math.round((parseFloat(settlement.tableFee) || 0) / 4);
  const feeDisplay = document.getElementById('settlement-fee-per-person');
  if (feeDisplay) {
    feeDisplay.textContent = `1人あたり: ¥${feePerPerson.toLocaleString()}`;
  }

  // Render 4 player cards
  renderSettlementPlayerCards(session, currentMatches, settlement);

  // Update Summary & Integrity Check
  updateSettlementSummary(session, currentMatches, settlement);
}

function renderSettlementPlayerCards(session, currentMatches, settlement) {
  const container = document.getElementById('settlement-player-cards');
  if (!container) return;

  container.innerHTML = '';
  const playerIds = session.playerIds || ['', '', '', ''];
  const rate = parseFloat(settlement.rate) || 0;
  const tableFee = parseFloat(settlement.tableFee) || 0;
  const feeShare = Math.round(tableFee / 4);

  playerIds.forEach((pid, seatIdx) => {
    const player = state.players.find(p => p.id === pid);
    const playerName = player ? player.name : `席${seatIdx + 1}(未設定)`;

    // Calculate total points
    let totalPoints = 0;
    let matchCount = 0;
    currentMatches.forEach(m => {
      const rec = m.records.find(r => r.playerId === pid);
      if (rec && rec.score !== '' && rec.score !== null && rec.score !== undefined) {
        const s = parseFloat(rec.score);
        if (!isNaN(s)) {
          totalPoints += s;
          matchCount++;
        }
      }
    });
    totalPoints = Math.round(totalPoints * 10) / 10;

    // Get settlement data for this player
    const pData = settlement.players[pid] || { food: 0, paid: 0 };
    const food = parseFloat(pData.food) || 0;
    const paid = parseFloat(pData.paid) || 0;

    // Game Profit
    const gameProfit = Math.round(totalPoints * rate);

    // Due Amount = (Fee / 4) + Food - GameProfit
    // Positive = Pay, Negative = Receive
    const dueAmount = Math.round(feeShare + food - gameProfit);

    const card = document.createElement('div');
    card.id = `settlement-card-${pid || seatIdx}`;
    card.className = `bg-dark-900/90 border border-slate-700/80 rounded-2xl p-3.5 border-l-4 ${SEAT_BORDER_CLASSES[seatIdx]} shadow-md space-y-3`;

    // Points display formatting
    const ptSign = totalPoints > 0 ? '+' : '';
    const ptColor = totalPoints > 0 ? 'text-emerald-400 font-bold' : totalPoints < 0 ? 'text-rose-400 font-bold' : 'text-slate-300';

    // Game Profit display formatting
    const profitSign = gameProfit > 0 ? '+' : '';
    const profitColor = gameProfit > 0 ? 'text-emerald-400' : gameProfit < 0 ? 'text-rose-400' : 'text-slate-300';
    const profitLabel = gameProfit > 0 ? '(勝ち)' : gameProfit < 0 ? '(負け)' : '';

    // Due Amount Box styling
    let dueBoxHtml = '';
    if (dueAmount > 0) {
      dueBoxHtml = `
        <div class="p-2.5 rounded-xl bg-rose-950/30 border border-rose-900/60">
          <div class="flex items-center justify-between text-[11px] text-rose-300">
            <span class="font-bold flex items-center gap-1"><i data-lucide="arrow-up-right" class="w-3.5 h-3.5"></i>支払う金額</span>
            <span class="text-[10px] text-rose-400">請求額</span>
          </div>
          <div class="text-xl sm:text-2xl font-black text-rose-300 font-mono-score mt-0.5" id="due-display-${pid || seatIdx}">
            ¥${dueAmount.toLocaleString()}
          </div>
        </div>
      `;
    } else if (dueAmount < 0) {
      const receiveAmount = Math.abs(dueAmount);
      dueBoxHtml = `
        <div class="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-900/60">
          <div class="flex items-center justify-between text-[11px] text-emerald-300">
            <span class="font-bold flex items-center gap-1"><i data-lucide="arrow-down-left" class="w-3.5 h-3.5"></i>受け取る金額</span>
            <span class="text-[10px] text-emerald-400">配分額</span>
          </div>
          <div class="text-xl sm:text-2xl font-black text-emerald-300 font-mono-score mt-0.5" id="due-display-${pid || seatIdx}">
            ¥${receiveAmount.toLocaleString()}
          </div>
        </div>
      `;
    } else {
      dueBoxHtml = `
        <div class="p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/60">
          <div class="flex items-center justify-between text-[11px] text-slate-400">
            <span class="font-bold">精算なし</span>
          </div>
          <div class="text-xl font-black text-slate-300 font-mono-score mt-0.5" id="due-display-${pid || seatIdx}">
            ¥0
          </div>
        </div>
      `;
    }

    // Change Calculation
    const changeHtml = getPlayerChangeHtml(dueAmount, paid, pid || seatIdx);

    card.innerHTML = `
      <!-- Player Header -->
      <div class="flex items-center justify-between border-b border-slate-700/60 pb-2">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-slate-800 ${SEAT_COLORS[seatIdx]}">${SEAT_SHORT[seatIdx]}</span>
          <span class="text-sm font-bold text-white truncate" title="${escapeHtml(playerName)}">${escapeHtml(playerName)}</span>
        </div>
        <span class="text-[10px] text-slate-400 font-mono">${matchCount}戦参加</span>
      </div>

      <!-- 1. Game Results & Profit -->
      <div class="bg-dark-850 p-2.5 rounded-xl border border-slate-700/60 space-y-1 text-xs">
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-slate-400">① 対局結果:</span>
          <span class="font-mono-score text-xs ${ptColor}">${ptSign}${totalPoints.toFixed(1)} pt</span>
        </div>
        <div class="flex items-center justify-between pt-1 border-t border-slate-800">
          <span class="text-[11px] text-slate-400">② ゲーム損益:</span>
          <div class="text-right">
            <span class="font-mono-score text-sm font-bold ${profitColor}" id="profit-display-${pid || seatIdx}">
              ${profitSign}¥${gameProfit.toLocaleString()}
            </span>
            <span class="text-[10px] text-slate-400 block">${profitLabel}</span>
          </div>
        </div>
      <!-- 3. Food Cost Input (Simple numeric textbox without presets) -->
      <div>
        <label class="block text-[11px] font-semibold text-amber-300 mb-1 flex items-center justify-between">
          <span class="flex items-center gap-1"><i data-lucide="utensils" class="w-3 h-3"></i>③ 飲食代（個別）</span>
          <span class="text-[10px] text-slate-500 font-normal">各自の飲食費</span>
        </label>
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xs">¥</span>
          <input
            type="number"
            id="input-food-${pid || seatIdx}"
            min="0"
            step="1"
            inputmode="numeric"
            value="${food || ''}"
            placeholder="0"
            oninput="handlePlayerFoodChange('${pid || seatIdx}', this.value)"
            class="w-full bg-dark-850 border border-slate-700 focus:border-amber-400 rounded-lg py-2 pl-7 pr-8 text-right text-sm font-mono-score font-bold text-white focus:outline-none transition"
          >
          <span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-[10px]">円</span>
        </div>
      </div>

      <!-- 4. Due Amount Display -->
      <div id="due-box-container-${pid || seatIdx}">
        ${dueBoxHtml}
      </div>

      <!-- 5. Paid Cash Input (Simple numeric textbox without preset buttons) -->
      <div class="space-y-1.5 pt-1 border-t border-slate-800">
        <label class="block text-[11px] font-semibold text-slate-300 flex items-center justify-between">
          <span class="flex items-center gap-1"><i data-lucide="wallet" class="w-3 h-3 text-brand-400"></i>⑤ 出したお金（預かり金）</span>
          <span class="text-[10px] text-slate-500 font-normal">財布から出された現金</span>
        </label>
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xs">¥</span>
          <input
            type="number"
            id="input-paid-${pid || seatIdx}"
            min="0"
            step="1"
            inputmode="numeric"
            value="${paid || ''}"
            placeholder="0"
            oninput="handlePlayerPaidChange('${pid || seatIdx}', this.value)"
            class="w-full bg-dark-850 border border-slate-700 focus:border-brand-500 rounded-lg py-2 pl-7 pr-8 text-right text-sm font-mono-score font-bold text-white focus:outline-none transition"
          >
          <span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-[10px]">円</span>
        </div>
      </div>

      <!-- 6. Change Display -->
      <div id="change-display-${pid || seatIdx}">
        ${changeHtml}
      </div>
    `;

    container.appendChild(card);
  });
}

function getDueBoxHtml(dueAmount, pid) {
  if (dueAmount > 0) {
    return `
      <div class="p-2.5 rounded-xl bg-rose-950/30 border border-rose-900/60">
        <div class="flex items-center justify-between text-[11px] text-rose-300">
          <span class="font-bold flex items-center gap-1"><i data-lucide="arrow-up-right" class="w-3.5 h-3.5"></i>支払う金額</span>
          <span class="text-[10px] text-rose-400">請求額</span>
        </div>
        <div class="text-xl sm:text-2xl font-black text-rose-300 font-mono-score mt-0.5" id="due-display-${pid}">
          ¥${dueAmount.toLocaleString()}
        </div>
      </div>
    `;
  } else if (dueAmount < 0) {
    const receiveAmount = Math.abs(dueAmount);
    return `
      <div class="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-900/60">
        <div class="flex items-center justify-between text-[11px] text-emerald-300">
          <span class="font-bold flex items-center gap-1"><i data-lucide="arrow-down-left" class="w-3.5 h-3.5"></i>受け取る金額</span>
          <span class="text-[10px] text-emerald-400">配分額</span>
        </div>
        <div class="text-xl sm:text-2xl font-black text-emerald-300 font-mono-score mt-0.5" id="due-display-${pid}">
          ¥${receiveAmount.toLocaleString()}
        </div>
      </div>
    `;
  } else {
    return `
      <div class="p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/60">
        <div class="flex items-center justify-between text-[11px] text-slate-400">
          <span class="font-bold">精算なし</span>
        </div>
        <div class="text-xl font-black text-slate-300 font-mono-score mt-0.5" id="due-display-${pid}">
          ¥0
        </div>
      </div>
    `;
  }
}

function getPlayerChangeHtml(dueAmount, paid, playerKey) {
  if (dueAmount > 0) {
    // Player has to pay
    if (!paid || paid === 0) {
      return `
        <div class="p-2 rounded-lg bg-slate-800/60 border border-slate-700 text-xs text-slate-400 flex items-center justify-between">
          <span>⑥ お釣り状況:</span>
          <span class="text-slate-400">未払い</span>
        </div>
      `;
    }

    const change = paid - dueAmount;
    if (change === 0) {
      return `
        <div class="p-2 rounded-lg bg-emerald-950/30 border border-emerald-900/60 text-xs text-emerald-300 flex items-center justify-between">
          <span>⑥ お釣り:</span>
          <span class="font-bold flex items-center gap-1 font-mono-score"><i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400"></i>お釣りなし (ピッタリ)</span>
        </div>
      `;
    } else if (change > 0) {
      return `
        <div class="p-2 rounded-lg bg-teal-950/40 border border-teal-900/60 text-xs text-teal-200 flex items-center justify-between">
          <span>⑥ お釣り:</span>
          <span class="font-bold text-sm text-teal-300 font-mono-score">¥${change.toLocaleString()} を返却</span>
        </div>
      `;
    } else {
      const shortage = Math.abs(change);
      return `
        <div class="p-2 rounded-lg bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300 flex items-center justify-between validation-error-glow">
          <span>⑥ 不足金額:</span>
          <span class="font-bold text-sm text-rose-400 font-mono-score">あと ¥${shortage.toLocaleString()} 必要</span>
        </div>
      `;
    }
  } else if (dueAmount < 0) {
    // Player is receiving payout
    const receiveAmount = Math.abs(dueAmount);
    return `
      <div class="p-2 rounded-lg bg-emerald-950/40 border border-emerald-900/60 text-xs text-emerald-300 flex items-center justify-between">
        <span>⑥ 配分受け取り:</span>
        <span class="font-bold text-sm text-emerald-400 font-mono-score">¥${receiveAmount.toLocaleString()} を渡す</span>
      </div>
    `;
  } else {
    return `
      <div class="p-2 rounded-lg bg-slate-800/40 border border-slate-700/60 text-xs text-slate-400 flex items-center justify-between">
        <span>⑥ 精算なし:</span>
        <span class="font-mono-score">¥0</span>
      </div>
    `;
  }
}

function updateSettlementSummary(session, currentMatches, settlement) {
  const venueTotalEl = document.getElementById('summary-venue-total');
  const collectTotalEl = document.getElementById('summary-collect-total');
  const cashCollectedEl = document.getElementById('summary-cash-collected');
  const changeTotalEl = document.getElementById('summary-change-total');
  const badgeEl = document.getElementById('settlement-integrity-badge');
  const notesText = document.getElementById('settlement-notes-text');

  if (!venueTotalEl || !settlement) return;

  const tableFee = parseFloat(settlement.tableFee) || 0;
  const rate = parseFloat(settlement.rate) || 0;
  const feeShare = Math.round(tableFee / 4);

  const playerIds = session.playerIds || ['', '', '', ''];
  let totalFood = 0;
  let totalDue = 0;
  let totalCashCollected = 0;
  let totalChangeToReturn = 0;
  let totalPointsSum = 0;

  playerIds.forEach(pid => {
    // Score sum
    let pScore = 0;
    currentMatches.forEach(m => {
      const rec = m.records.find(r => r.playerId === pid);
      if (rec && rec.score !== '' && rec.score !== null && rec.score !== undefined) {
        const s = parseFloat(rec.score);
        if (!isNaN(s)) pScore += s;
      }
    });
    totalPointsSum += pScore;

    const pData = settlement.players[pid] || { food: 0, paid: 0 };
    const food = parseFloat(pData.food) || 0;
    const paid = parseFloat(pData.paid) || 0;

    totalFood += food;
    totalCashCollected += paid;

    const gameProfit = Math.round(pScore * rate);
    const due = Math.round(feeShare + food - gameProfit);
    totalDue += due;

    if (due > 0 && paid > due) {
      totalChangeToReturn += (paid - due);
    }
  });

  const venueTotal = tableFee + totalFood;

  venueTotalEl.textContent = `¥${venueTotal.toLocaleString()}`;
  collectTotalEl.textContent = `¥${totalDue.toLocaleString()}`;
  cashCollectedEl.textContent = `¥${totalCashCollected.toLocaleString()}`;
  changeTotalEl.textContent = `¥${totalChangeToReturn.toLocaleString()}`;

  // Integrity validation
  const diff = venueTotal - totalDue;
  const isConsistent = Math.abs(diff) < 2; // allowance for rounding

  if (isConsistent) {
    badgeEl.innerHTML = `
      <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/40">
        <i data-lucide="check-circle-2" class="w-4 h-4"></i>
        <span>✓ 合計金額が一致しています（整合性OK）</span>
      </div>
    `;
    notesText.innerHTML = `
      <span class="text-emerald-300 font-semibold">整合性正常:</span> 会場への総支払額（¥${venueTotal.toLocaleString()}）とテーブル全体の徴収合計（¥${totalDue.toLocaleString()}）が完全に一致しています。幹事は集まった現金からお釣りを返却し、会場へお支払いください。
    `;
  } else {
    const diffText = diff > 0 ? `+¥${diff.toLocaleString()} 不足` : `-¥${Math.abs(diff).toLocaleString()} 超過`;
    badgeEl.innerHTML = `
      <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/20 text-rose-400 text-xs font-bold border border-rose-500/40 validation-error-glow">
        <i data-lucide="alert-triangle" class="w-4 h-4"></i>
        <span>⚠ 金額不一致: 差額 ${diffText}</span>
      </div>
    `;
    notesText.innerHTML = `
      <span class="text-rose-400 font-semibold">差額警告:</span> 対局画面のポイント合計が0になっていないか、場代・飲食代の入力をご確認ください。（現在のポイント合計: ${totalPointsSum.toFixed(1)} pt）
    `;
  }

  lucide.createIcons();
}

// ----------------------------------------------------------------------------
// Settlement Input Handlers
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// Settlement Input Handlers & Non-Destructive Live Recalculation
// ----------------------------------------------------------------------------

function updateSettlementCalculationsOnly(session, currentMatches, settlement) {
  const rate = parseFloat(settlement.rate) || 0;
  const tableFee = parseFloat(settlement.tableFee) || 0;
  const feeShare = Math.round(tableFee / 4);
  const playerIds = session.playerIds || ['', '', '', ''];

  playerIds.forEach((pid, seatIdx) => {
    const key = pid || seatIdx;
    let totalPoints = 0;
    currentMatches.forEach(m => {
      const rec = m.records.find(r => r.playerId === pid);
      if (rec && rec.score !== '' && rec.score !== null && rec.score !== undefined) {
        const s = parseFloat(rec.score);
        if (!isNaN(s)) totalPoints += s;
      }
    });
    totalPoints = Math.round(totalPoints * 10) / 10;

    const pData = settlement.players[pid] || { food: 0, paid: 0 };
    const food = parseFloat(pData.food) || 0;
    const paid = parseFloat(pData.paid) || 0;

    const gameProfit = Math.round(totalPoints * rate);
    const dueAmount = Math.round(feeShare + food - gameProfit);

    // Update profit text
    const profitEl = document.getElementById(`profit-display-${key}`);
    if (profitEl) {
      const profitSign = gameProfit > 0 ? '+' : '';
      const profitColor = gameProfit > 0 ? 'text-emerald-400' : gameProfit < 0 ? 'text-rose-400' : 'text-slate-300';
      profitEl.className = `font-mono-score text-sm font-bold ${profitColor}`;
      profitEl.textContent = `${profitSign}¥${gameProfit.toLocaleString()}`;
    }

    // Update due box container
    const dueBoxContainer = document.getElementById(`due-box-container-${key}`);
    if (dueBoxContainer) {
      dueBoxContainer.innerHTML = getDueBoxHtml(dueAmount, key);
    }

    // Update change display
    const changeDisplay = document.getElementById(`change-display-${key}`);
    if (changeDisplay) {
      changeDisplay.innerHTML = getPlayerChangeHtml(dueAmount, paid, key);
    }
  });

  // Update overall summary & integrity
  updateSettlementSummary(session, currentMatches, settlement);
  lucide.createIcons();
}

function handleRateChange(val) {
  const session = getCurrentSession();
  if (!session) return;
  const settlement = ensureSessionSettlement(session);
  settlement.rate = parseFloat(val) || 0;
  saveData();
  debounceSyncSession(session);

  const currentMatches = state.matches.filter(m => m.sessionId === session.id);
  updateSettlementCalculationsOnly(session, currentMatches, settlement);
}

function setQuickRate(rate) {
  const input = document.getElementById('settlement-rate-input');
  if (input) input.value = rate;
  handleRateChange(rate);
  showToast(`レートを 1pt＝${rate}円 に設定しました`, 'info');
}

function handleTableFeeChange(val) {
  const session = getCurrentSession();
  if (!session) return;
  const settlement = ensureSessionSettlement(session);
  settlement.tableFee = parseFloat(val) || 0;
  saveData();
  debounceSyncSession(session);

  const feePerPerson = Math.round((parseFloat(settlement.tableFee) || 0) / 4);
  const feeDisplay = document.getElementById('settlement-fee-per-person');
  if (feeDisplay) {
    feeDisplay.textContent = `1人あたり: ¥${feePerPerson.toLocaleString()}`;
  }

  const currentMatches = state.matches.filter(m => m.sessionId === session.id);
  updateSettlementCalculationsOnly(session, currentMatches, settlement);
}

function setQuickFee(fee) {
  const input = document.getElementById('settlement-table-fee-input');
  if (input) input.value = fee;
  handleTableFeeChange(fee);
  showToast(`場代を ¥${fee.toLocaleString()} に設定しました`, 'info');
}

function handlePlayerFoodChange(playerKey, val) {
  const session = getCurrentSession();
  if (!session) return;
  const settlement = ensureSessionSettlement(session);
  if (!settlement.players[playerKey]) {
    settlement.players[playerKey] = { food: 0, paid: 0 };
  }
  settlement.players[playerKey].food = parseFloat(val) || 0;
  saveData();
  debounceSyncSession(session);

  const currentMatches = state.matches.filter(m => m.sessionId === session.id);
  updateSettlementCalculationsOnly(session, currentMatches, settlement);
}

function handlePlayerPaidChange(playerKey, val) {
  const session = getCurrentSession();
  if (!session) return;
  const settlement = ensureSessionSettlement(session);
  if (!settlement.players[playerKey]) {
    settlement.players[playerKey] = { food: 0, paid: 0 };
  }
  settlement.players[playerKey].paid = parseFloat(val) || 0;
  saveData();
  debounceSyncSession(session);

  const currentMatches = state.matches.filter(m => m.sessionId === session.id);
  updateSettlementCalculationsOnly(session, currentMatches, settlement);
}

// ============================================================================
// TAB: 精算履歴一覧（Settlement History View）
// ============================================================================

function populateSettlementHistoryLocationFilter() {
  const filterSelect = document.getElementById('settlement-history-filter');
  if (!filterSelect) return;

  const currentValue = filterSelect.value || 'ALL';
  filterSelect.innerHTML = '<option value="ALL">すべての場所・卓（全期間）</option>';

  const locations = [...new Set(state.sessions.map(s => s.location).filter(Boolean))];
  locations.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc;
    opt.textContent = loc;
    if (loc === currentValue) opt.selected = true;
    filterSelect.appendChild(opt);
  });
}

function renderSettlementHistoryView() {
  const tableBody = document.getElementById('settlement-history-table-body');
  const sessionContainer = document.getElementById('settlement-history-list-container');
  const emptyState = document.getElementById('settlement-history-empty-state');
  const filterSelect = document.getElementById('settlement-history-filter');
  const countBadge = document.getElementById('settlement-history-count-badge');
  const totalSessionsEl = document.getElementById('history-total-sessions');
  const totalVenueEl = document.getElementById('history-total-venue');
  const totalMatchesEl = document.getElementById('history-total-matches');
  const totalPlayersEl = document.getElementById('history-total-players');

  if (!tableBody) return;

  const selectedLocation = filterSelect ? filterSelect.value : 'ALL';

  // Filter sessions by selected location
  let filteredSessions = [...state.sessions];
  if (selectedLocation !== 'ALL') {
    filteredSessions = filteredSessions.filter(s => s.location === selectedLocation);
  }

  // Sort sessions by date descending
  filteredSessions.sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  if (countBadge) countBadge.textContent = `${filteredSessions.length} セッション`;
  if (totalSessionsEl) totalSessionsEl.textContent = filteredSessions.length;

  if (filteredSessions.length === 0) {
    tableBody.innerHTML = '';
    if (sessionContainer) sessionContainer.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    if (totalVenueEl) totalVenueEl.textContent = '¥0';
    if (totalMatchesEl) totalMatchesEl.textContent = '0';
    if (totalPlayersEl) totalPlayersEl.textContent = '0';
    return;
  }
  if (emptyState) emptyState.classList.add('hidden');

  let grandTotalVenuePayment = 0;
  let grandTotalMatchesCount = 0;

  // Initialize aggregated stats per player
  const playerStatsMap = {};
  state.players.forEach(p => {
    playerStatsMap[p.id] = {
      id: p.id,
      name: p.name,
      sessionCount: 0,
      matchCount: 0,
      totalPoints: 0,   // 対戦結果(pt)合計
      gameProfit: 0,    // ① ゲーム損益合計
      expenseTotal: 0,  // ② 場代＋飲食代合計
      finalNet: 0       // ③ 総合計 (① - ②)
    };
  });

  // Calculate per session and aggregate into playerStatsMap
  filteredSessions.forEach(session => {
    const sessionMatches = state.matches.filter(m => m.sessionId === session.id);
    grandTotalMatchesCount += sessionMatches.length;

    const settlement = ensureSessionSettlement(session);
    const rate = parseFloat(settlement.rate) || 100;
    const tableFee = parseFloat(settlement.tableFee) || 0;
    const feeShare = Math.round(tableFee / 4);

    const playerIds = session.playerIds || ['', '', '', ''];
    let sessionTotalFood = 0;

    playerIds.forEach((pid, seatIdx) => {
      if (!pid) return;
      if (!playerStatsMap[pid]) {
        playerStatsMap[pid] = {
          id: pid,
          name: `不明(${pid})`,
          sessionCount: 0,
          matchCount: 0,
          totalPoints: 0,
          gameProfit: 0,
          expenseTotal: 0,
          finalNet: 0
        };
      }

      const pStat = playerStatsMap[pid];
      pStat.sessionCount++;

      // Session score sum
      let pScore = 0;
      let sessionMatchesPlayed = 0;
      sessionMatches.forEach(m => {
        const rec = m.records.find(r => r.playerId === pid);
        if (rec && rec.score !== '' && rec.score !== null && rec.score !== undefined) {
          const s = parseFloat(rec.score);
          if (!isNaN(s)) {
            pScore += s;
            sessionMatchesPlayed++;
          }
        }
      });
      pStat.matchCount += sessionMatchesPlayed;

      const pData = settlement.players[pid] || { food: 0, paid: 0 };
      const food = parseFloat(pData.food) || 0;
      sessionTotalFood += food;

      const gameProfit = Math.round(pScore * rate);
      const expense = feeShare + food;

      pStat.totalPoints += pScore;
      pStat.gameProfit += gameProfit;
      pStat.expenseTotal += expense;
    });

    const venueTotal = tableFee + sessionTotalFood;
    grandTotalVenuePayment += venueTotal;
  });

  // Compute finalNet and round points
  let statsList = Object.values(playerStatsMap).map(st => {
    const roundedPoints = Math.round(st.totalPoints * 10) / 10;
    const finalNet = st.gameProfit - st.expenseTotal;
    return {
      ...st,
      totalPoints: roundedPoints,
      finalNet: finalNet
    };
  });

  // Active players (participated in at least 1 match or session)
  const activePlayers = statsList.filter(st => st.sessionCount > 0 || st.matchCount > 0);
  if (totalPlayersEl) totalPlayersEl.textContent = activePlayers.length;

  // Sort statsList
  const sortCol = state.settlementHistorySort.column || 'finalNet';
  const sortDir = state.settlementHistorySort.direction === 'asc' ? 1 : -1;

  statsList.sort((a, b) => {
    // Players with 0 sessions/matches placed at bottom
    if (a.sessionCount === 0 && b.sessionCount > 0) return 1;
    if (b.sessionCount === 0 && a.sessionCount > 0) return -1;

    let valA = a[sortCol];
    let valB = b[sortCol];

    if (sortCol === 'name') {
      return sortDir * a.name.localeCompare(b.name, 'ja');
    }
    return (valA - valB) * sortDir;
  });

  // 1. Render Table Rows (Designated 5 columns)
  tableBody.innerHTML = '';
  statsList.forEach((st, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/40 transition border-b border-slate-800/60';

    // Formattings
    const ptSign = st.totalPoints > 0 ? '+' : '';
    const ptColor = st.totalPoints > 0 ? 'text-emerald-400 font-bold' : st.totalPoints < 0 ? 'text-rose-400 font-bold' : 'text-slate-400';

    const profitSign = st.gameProfit > 0 ? '+' : '';
    const profitColor = st.gameProfit > 0 ? 'text-emerald-400 font-bold' : st.gameProfit < 0 ? 'text-rose-400 font-bold' : 'text-slate-400';

    const netSign = st.finalNet > 0 ? '+' : '';
    const netColor = st.finalNet > 0 ? 'text-emerald-400 font-black text-sm sm:text-base' : st.finalNet < 0 ? 'text-rose-400 font-black text-sm sm:text-base' : 'text-slate-300 font-bold';

    tr.innerHTML = `
      <td class="py-3 px-3 sm:px-4 font-medium text-slate-200 flex items-center gap-2">
        <span class="w-5 text-center text-xs text-slate-500 font-mono">${idx + 1}</span>
        <span class="font-sans font-semibold text-white">${escapeHtml(st.name)}</span>
        <span class="text-[10px] text-slate-500">(${st.sessionCount}卓/${st.matchCount}戦)</span>
      </td>
      <td class="py-3 px-3 sm:px-4 text-right ${ptColor}">
        ${ptSign}${st.totalPoints.toFixed(1)} pt
      </td>
      <td class="py-3 px-3 sm:px-4 text-right ${profitColor}">
        ${profitSign}¥${st.gameProfit.toLocaleString()}
      </td>
      <td class="py-3 px-3 sm:px-4 text-right text-slate-200">
        ¥${st.expenseTotal.toLocaleString()}
      </td>
      <td class="py-3 px-3 sm:px-4 text-right ${netColor}">
        ${netSign}¥${st.finalNet.toLocaleString()}
      </td>
    `;

    tableBody.appendChild(tr);
  });

  // 2. Render Collapsible Session-by-Session Breakdown Cards
  if (sessionContainer) {
    sessionContainer.innerHTML = '';
    filteredSessions.forEach(session => {
      const card = createSessionHistoryCardElement(session);
      sessionContainer.appendChild(card);
    });
  }

  // Update Summary numbers
  if (totalVenueEl) totalVenueEl.textContent = `¥${grandTotalVenuePayment.toLocaleString()}`;
  if (totalMatchesEl) totalMatchesEl.textContent = `${grandTotalMatchesCount}`;

  updateSettlementHistorySortIcons();
  lucide.createIcons();
}

function createSessionHistoryCardElement(session) {
  const sessionMatches = state.matches.filter(m => m.sessionId === session.id);
  const settlement = ensureSessionSettlement(session);
  const rate = parseFloat(settlement.rate) || 100;
  const tableFee = parseFloat(settlement.tableFee) || 0;
  const feeShare = Math.round(tableFee / 4);

  const playerIds = session.playerIds || ['', '', '', ''];
  let sessionTotalFood = 0;
  let sessionTotalDue = 0;

  const playerSummaries = playerIds.map((pid, seatIdx) => {
    const player = state.players.find(p => p.id === pid);
    const playerName = player ? player.name : `席${seatIdx + 1}(未設定)`;

    let totalPoints = 0;
    sessionMatches.forEach(m => {
      const rec = m.records.find(r => r.playerId === pid);
      if (rec && rec.score !== '' && rec.score !== null && rec.score !== undefined) {
        const s = parseFloat(rec.score);
        if (!isNaN(s)) totalPoints += s;
      }
    });
    totalPoints = Math.round(totalPoints * 10) / 10;

    const pData = settlement.players[pid] || { food: 0, paid: 0 };
    const food = parseFloat(pData.food) || 0;
    sessionTotalFood += food;

    const gameProfit = Math.round(totalPoints * rate);
    const dueAmount = Math.round(feeShare + food - gameProfit);
    sessionTotalDue += dueAmount;

    return { seatIdx, playerName, totalPoints, gameProfit, food, dueAmount };
  });

  const venueTotal = tableFee + sessionTotalFood;
  const diff = venueTotal - sessionTotalDue;
  const isConsistent = Math.abs(diff) < 2;

  const integrityBadgeHtml = isConsistent
    ? `<span class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30"><i data-lucide="check" class="w-3 h-3"></i>整合性OK</span>`
    : `<span class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 font-semibold border border-rose-500/30"><i data-lucide="alert-triangle" class="w-3 h-3"></i>差額 ¥${Math.abs(diff).toLocaleString()}</span>`;

  const isActiveSession = session.id === state.currentSessionId;

  const card = document.createElement('div');
  card.className = `bg-dark-900 border ${isActiveSession ? 'border-brand-500/80 shadow-brand-500/10' : 'border-slate-700/60'} rounded-xl p-3.5 space-y-2.5`;

  let playersGridHtml = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1">`;
  playerSummaries.forEach(ps => {
    const ptSign = ps.totalPoints > 0 ? '+' : '';
    const ptColor = ps.totalPoints > 0 ? 'text-emerald-400 font-bold' : ps.totalPoints < 0 ? 'text-rose-400 font-bold' : 'text-slate-300';

    let dueBadgeHtml = '';
    if (ps.dueAmount > 0) {
      dueBadgeHtml = `<span class="text-[11px] font-bold text-rose-400 bg-rose-950/40 border border-rose-900/60 px-2 py-0.5 rounded font-mono-score">¥${ps.dueAmount.toLocaleString()} 支払</span>`;
    } else if (ps.dueAmount < 0) {
      dueBadgeHtml = `<span class="text-[11px] font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-900/60 px-2 py-0.5 rounded font-mono-score">¥${Math.abs(ps.dueAmount).toLocaleString()} 受取</span>`;
    } else {
      dueBadgeHtml = `<span class="text-[11px] font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded font-mono-score">¥0 (精算なし)</span>`;
    }

    playersGridHtml += `
      <div class="bg-dark-850 rounded-lg p-2 border-l-4 ${SEAT_BORDER_CLASSES[ps.seatIdx]} border border-slate-700/60 text-xs space-y-1">
        <div class="flex items-center justify-between">
          <span class="font-semibold text-slate-200 truncate">${escapeHtml(ps.playerName)}</span>
          <span class="font-mono-score ${ptColor}">${ptSign}${ps.totalPoints.toFixed(1)} pt</span>
        </div>
        <div class="flex items-center justify-between text-[10px] text-slate-400">
          <span>飲食: ¥${ps.food.toLocaleString()}</span>
          <span>損益: ${ps.gameProfit >= 0 ? '+' : ''}¥${ps.gameProfit.toLocaleString()}</span>
        </div>
        <div class="pt-0.5 flex items-center justify-between">
          <span class="text-[10px] text-slate-400 font-medium">最終精算:</span>
          ${dueBadgeHtml}
        </div>
      </div>
    `;
  });
  playersGridHtml += `</div>`;

  card.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700/60 pb-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="font-mono text-xs font-bold text-white">${session.date}</span>
        <span class="text-xs px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 font-semibold">${escapeHtml(session.location)}</span>
        <span class="text-xs text-slate-400 font-mono">全${sessionMatches.length}戦</span>
        ${integrityBadgeHtml}
        ${isActiveSession ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">編集中</span>` : ''}
        <span class="text-xs text-slate-400">レート: <strong>1pt＝${rate}円</strong></span>
        <span class="text-xs text-slate-400">場代: <strong>¥${tableFee.toLocaleString()}</strong></span>
      </div>
      <button onclick="openSettlementSession('${session.id}')" class="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-brand-600 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1 transition self-end sm:self-center">
        <i data-lucide="edit-3" class="w-3 h-3"></i>
        <span>この精算を開く</span>
      </button>
    </div>
    ${playersGridHtml}
  `;

  return card;
}

function sortSettlementHistory(column) {
  if (state.settlementHistorySort.column === column) {
    state.settlementHistorySort.direction = state.settlementHistorySort.direction === 'desc' ? 'asc' : 'desc';
  } else {
    state.settlementHistorySort.column = column;
    state.settlementHistorySort.direction = column === 'name' ? 'asc' : 'desc';
  }
  renderSettlementHistoryView();
}

function updateSettlementHistorySortIcons() {
  const columns = ['name', 'totalPoints', 'gameProfit', 'expenseTotal', 'finalNet'];
  columns.forEach(col => {
    const el = document.getElementById(`sh-sort-icon-${col}`);
    if (!el) return;
    if (state.settlementHistorySort.column === col) {
      el.textContent = state.settlementHistorySort.direction === 'asc' ? '▲' : '▼';
      el.className = 'text-[10px] text-brand-400 font-bold';
    } else {
      el.textContent = '↕';
      el.className = 'text-[10px] text-slate-500';
    }
  });
}

function toggleSessionBreakdownList() {
  const container = document.getElementById('settlement-history-list-container');
  const text = document.getElementById('toggle-breakdown-text');
  const icon = document.getElementById('toggle-breakdown-icon');
  if (!container) return;

  const isHidden = container.classList.contains('hidden');
  if (isHidden) {
    container.classList.remove('hidden');
    if (text) text.textContent = '内訳を閉じる';
    if (icon) icon.setAttribute('data-lucide', 'chevron-up');
  } else {
    container.classList.add('hidden');
    if (text) text.textContent = '内訳を表示する';
    if (icon) icon.setAttribute('data-lucide', 'chevron-down');
  }
  lucide.createIcons();
}

function openSettlementSession(sessionId) {
  if (!sessionId) return;
  state.currentSessionId = sessionId;
  saveData();
  renderSessionSelector();
  renderSessionView();
  switchTab('settlement');
  showToast('選択したセッションの精算画面を開きました', 'info');
}



