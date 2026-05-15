// ========== 全域參數（集中管理） ==========
const SETTINGS = {
  VERSION: "v1.4.0",

  STORAGE_KEYS: {
    apiKey: 'tianyan_api_key',
    useProxy: 'tianyan_use_proxy',
    gameSave: 'tianyan_game_save',
  },

  ENDPOINTS: {
    localProxy: 'http://127.0.0.1:4444/v1/chat/completions',
    remoteProxy: 'https://restless-hat-8ef5.jimmy910824.workers.dev/v1/chat/completions',
    direct: 'https://integrate.api.nvidia.com/v1/chat/completions',
  },

  LLM: {
    defaults: {
      temperature: 0.5,
      top_p: 1,
      max_tokens: 131072,
      stream: false,
      response_format: { type: "json_object" },
    },
    qwen: {
      temperature: 0.6,
      top_p: 0.95,
      max_tokens: 16384,
      enable_thinking: true,
    },
    gptOssReasoningHints: {
      high: "\n\nReasoning: Medium",
      low: "\n\nReasoning: Low",
    },
    deepseek: {
      temperature: 1.0,
      top_p: 0.95,
      max_tokens: 16384,
      thinking: true,
      reasoning_effort: "Low"
    }
  },

  UI: {
    mobileWidthPx: 768,
    stickToBottomThresholdPx: 15,
    typewriterDelayMs: 75,
    floatingImpactDurationMs: 3000,
    floatingImpactStaggerMs: 1000,
  },

  GAME: {
    historyLimit: 15,
  },
};

// 提示詞改由 world.json 載入，此處僅保留變數佔位
let DIRECTOR_PROMPT = "";
let NARRATIVE_PROMPT = "";
let META_PROMPT = "";

// 雙階段 Prompt 改由 world.json 動態載入

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const VERSION = SETTINGS.VERSION;

// 讓單一換行也能在畫面上保留，避免敘事擠成一大段
if (window.marked?.setOptions) {
  marked.setOptions({ breaks: true });
}

// 執行期設定（由 UI / localStorage 驅動）
const CONFIG = {
  useProxy: localStorage.getItem(SETTINGS.STORAGE_KEYS.useProxy) === 'true',
  proxyUrl: isLocal
    ? SETTINGS.ENDPOINTS.localProxy
    : SETTINGS.ENDPOINTS.remoteProxy,
  directUrl: SETTINGS.ENDPOINTS.direct,
};

// 全域狀態
const state = {
  world: null,
  game: null,
  historyLimit: SETTINGS.GAME.historyLimit,
  isThinking: false,
  currentTypewriter: null,
  quickActionIndex: -1,
  lastStats: {}, // 用於紀錄上次渲染的數值以判斷是否需要動畫
};

// DOM 快取（避免反覆 query）
const selectors = {
  storyLog: document.getElementById('story-log'),
  quickActions: document.getElementById('quick-actions'),
  playerAction: document.getElementById('player-action'),
  actionForm: document.getElementById('action-form'),
  sceneTitle: document.getElementById('scene-title'),
  settingsModal: document.getElementById('settings-modal'),
  apiKey: document.getElementById('api-key'),
  modelSelect: document.getElementById('model-select'),
  proxyToggle: document.getElementById('proxy-toggle'),
  saveModal: document.getElementById('save-modal'),
  saveModalTitle: document.getElementById('save-modal-title'),
  saveCode: document.getElementById('save-code'),
  btnConfirmSave: document.getElementById('confirm-save-action'),
  btnCloseSave: document.getElementById('close-save-modal'),
  btnCloseSettings: document.getElementById('close-settings'),
  sidebar: document.getElementById('sidebar'),
  sidebarContent: document.getElementById('sidebar-content'),
  sidebarExpanded: document.getElementById('sidebar-expanded'),
  sidebarCollapsed: document.getElementById('sidebar-collapsed'),
  btnToggleSidebar: document.getElementById('toggle-sidebar'),
  // Custom Select Selectors
  modelSelectContainer: document.getElementById('model-select-container'),
  modelSelectTrigger: document.getElementById('model-select-trigger'),
  modelSelectOptions: document.getElementById('model-select-options'),
  modelSelectedValue: document.querySelector('#model-select-trigger .selected-value'),
};

let currentSaveMode = 'export';
state.thinkingEntry = null;

function splitMetaBlock(text) {
  const trimmed = text.trim();
  if (!trimmed) return { narrative: "", meta: null, isJson: false, isComplete: false };

  // 判斷是否可能是 JSON (以 { 開頭)
  const isPossiblyJson = trimmed.startsWith('{');

  try {
    const data = JSON.parse(text);
    return {
      narrative: data.narrative || "",
      meta: data.meta || {},
      isJson: true,
      isComplete: true
    };
  } catch (e) {
    if (isPossiblyJson) {
      // 串流中，尋找 "narrative": "..."
      const narrativeMatch = text.match(/"narrative"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (narrativeMatch) {
        let rawContent = narrativeMatch[1];
        let narrative = rawContent
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\t/g, '\t')
          .replace(/\\\\/g, '\\');
        return { narrative, meta: null, isJson: true, isComplete: false };
      }
      // 如果是 JSON 格式但還沒看到 narrative，回傳空字串但標記為 JSON
      return { narrative: "", meta: null, isJson: true, isComplete: false };
    }
    // 非 JSON 格式，直接當作 narrative (Fallback)
    return { narrative: text, meta: null, isJson: false, isComplete: false };
  }
}

function parseMeta(meta) {
  if (!meta) return { impact: {}, suggested_options: [] };
  const impact = {};
  const suggested_options = meta.options || [];

  const parseDeltaNumber = (raw, current) => {
    if (raw === undefined || raw === null) return undefined;
    const str = String(raw).trim();
    // 支援 XX/TotalLimit 格式，計算為 delta
    if (str.includes('/')) {
      const val = Number(str.split('/')[0]);
      return Number.isFinite(val) ? val - current : undefined;
    }
    const v = Number(str.replace('+', '').trim());
    return Number.isFinite(v) ? v : undefined;
  };

  const parsePairs = (raw) => {
    const out = {};
    if (!raw || /^(none|無|null|nan)$/i.test(String(raw).trim())) return out;
    if (typeof raw === 'object') return raw; 
    const parts = String(raw).split(/[;；]/).map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const k = part.slice(0, eq).trim();
      const vStr = part.slice(eq + 1).trim();
      
      if (vStr.includes('/')) {
        const segments = vStr.split('/').map(s => s.trim());
        if (segments.length === 3) {
          out[k] = { 
            val: Number(segments[0]), 
            min: Number(segments[1]), 
            max: Number(segments[2]) 
          };
        } else if (segments.length === 2) {
          // 支援 增減值/上限 格式，預設下限為 0
          out[k] = {
            val: Number(segments[0]),
            min: 0,
            max: Number(segments[1])
          };
        }
      } else {
        const v = Number(vStr);
        if (k && Number.isFinite(v)) out[k] = v;
      }
    }
    return out;
  };

  if (meta.hp) impact.hp = parseDeltaNumber(meta.hp, state.game.player.hp);
  if (meta.sp) impact.sp = parseDeltaNumber(meta.sp, state.game.player.sp);
  if (meta.threat) impact.threat = parseDeltaNumber(meta.threat, state.game.player.threat);
  if (meta.scene && meta.scene !== 'null') impact.scene = meta.scene;
  if (meta.new_ability) impact.new_abilities = parsePairs(meta.new_ability);
  if (meta.upd_ability) impact.update_abilities = parsePairs(meta.upd_ability);

  return { impact, suggested_options };
}

// 基本的字串脫殼處理
function cleanText(text) {
  if (!text) return "";
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

// 敘事格式化處理 (包含脫殼與段落自動換行)
function formatNarrative(text) {
  if (!text) return "";
  const cleaned = cleanText(text);
  // 在句號後添加雙換行，但若後方已有換行則跳過
  return cleaned.replace(/。([」』"'〉》）］｝]*)(?!\n)/g, '。$1\n\n');
}

// 從串流結果中提取 narrative（優先解析 JSON，否則做容錯擷取）
function extractNarrative(text) {
  if (!text.trim()) return null;
  try {
    const data = JSON.parse(text);
    // 檢測空或無效的 JSON 物件
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      console.warn('[extractNarrative] 模型返回空 JSON 物件');
      return null;
    }
    // 檢測 narrative 欄位是否存在且有內容
    if (data.narrative === undefined || data.narrative === null) {
      console.warn('[extractNarrative] JSON 中缺少 narrative 欄位');
      return null;
    }
    if (typeof data.narrative !== 'string' || !data.narrative.trim()) {
      console.warn('[extractNarrative] narrative 欄位為空');
      return null;
    }
    return cleanText(data.narrative);
  } catch (e) {
    const match = text.match(/"narrative"\s*:\s*"((?:[^"\\]|\\.)*)/);
    if (match) {
      return cleanText(match[1]);
    }
    if (!text.trim().startsWith('{')) return cleanText(text);
    return null;
  }
}

// 從串流結果中提取 meta（支援 { meta: {...} } 或直接回傳 meta 物件）
function extractMeta(text) {
  if (!text.trim()) return null;
  try {
    const data = JSON.parse(text);
    if (data.meta) return data.meta;
    if (data.options || data.hp !== undefined) return data;
    return null;
  } catch (e) {
    return null;
  }
}

function appendThinking(timestamp = null) {
  const entry = document.createElement('div');
  entry.className = 'story-entry thinking';
  const date = timestamp ? new Date(timestamp) : new Date();
  const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  entry.innerHTML = `
    <div class="entry-header">
      <span class="sender">AI</span> <span class="time">${timeStr}</span>
    </div>
    <div class="entry-content">
      <div class="thinking-wrapper">
        <div class="spinner-core">
          <div class="ring"></div>
          <div class="ring"></div>
          <div class="ring"></div>
        </div>
        <span class="thinking-text">正在推演天機</span>
        <div class="fb-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>`;
  const wasAtBottom = selectors.storyLog.scrollHeight - selectors.storyLog.scrollTop - selectors.storyLog.clientHeight < SETTINGS.UI.stickToBottomThresholdPx;
  selectors.storyLog.appendChild(entry);
  if (wasAtBottom) {
    selectors.storyLog.scrollTop = selectors.storyLog.scrollHeight;
  }
  return entry;
}

async function init() {
  state.world = await fetch('world.json').then((res) => res.json());

  // 載入 Prompt 設定
  DIRECTOR_PROMPT = state.world.prompts.director;
  NARRATIVE_PROMPT = state.world.prompts.narrative;
  META_PROMPT = state.world.prompts.meta;

  const savedKey = localStorage.getItem(SETTINGS.STORAGE_KEYS.apiKey);
  if (savedKey) selectors.apiKey.value = savedKey;
  selectors.proxyToggle.checked = CONFIG.useProxy;

  const saved = loadFromStorage();

  // 手機版預設收合狀態欄與調整輸入框提示
  if (window.innerWidth <= SETTINGS.UI.mobileWidthPx) {
    selectors.sidebar.classList.add('collapsed');
    selectors.playerAction.placeholder = "輸入行動，改變因果...";
  }

  if (saved) {
    state.game = saved;
    if (state.game.history.length === 0) {
      appendStory('系統：初始化完成。請在設置中輸入 API Key 並儲存以開始故事。', 'system');
    } else {
      state.game.history.forEach(entry => {
        if (entry.action) appendStory(entry.action, 'action', entry.timestamp);
        if (entry.result) appendStory(entry.result.narrative, entry.result.success ? 'narrative' : 'system', entry.timestamp);
      });
    }
  } else {
    state.game = JSON.parse(JSON.stringify(state.world.startingState));
    appendStory('系統：等待鏈接中... 請在設置中輸入 API Key 並點擊儲存。', 'system');
  }

  render();
  setupEventListeners();
  setupCustomSelect();
}

function setupCustomSelect() {
  const container = selectors.modelSelectContainer;
  const trigger = selectors.modelSelectTrigger;
  const optionsList = selectors.modelSelectOptions;
  const nativeSelect = selectors.modelSelect;
  const displayValue = selectors.modelSelectedValue;

  // 動態生成選項以同步原生 Select
  function syncOptions() {
    optionsList.innerHTML = '';
    Array.from(nativeSelect.options).forEach(opt => {
      const optionEl = document.createElement('div');
      optionEl.className = `option ${opt.value === nativeSelect.value ? 'selected' : ''}`;
      optionEl.dataset.value = opt.value;
      optionEl.textContent = opt.textContent;

      optionEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = optionEl.dataset.value;
        nativeSelect.value = val;
        displayValue.textContent = opt.textContent;

        optionsList.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
        optionEl.classList.add('selected');

        container.classList.remove('active');
        optionsList.classList.add('hidden');
      });

      optionsList.appendChild(optionEl);
    });
    displayValue.textContent = nativeSelect.options[nativeSelect.selectedIndex]?.textContent || nativeSelect.value;
  }

  syncOptions();

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = container.classList.contains('active');

    document.querySelectorAll('.custom-select').forEach(cs => cs.classList.remove('active'));
    document.querySelectorAll('.select-options').forEach(so => so.classList.add('hidden'));

    if (!isActive) {
      container.classList.add('active');
      optionsList.classList.remove('hidden');
    }
  });

  // Close on click outside
  document.addEventListener('click', () => {
    container.classList.remove('active');
    optionsList.classList.add('hidden');
  });
}

function setupEventListeners() {
  // 基礎按鈕監聽 (如果是靜態存在的)
  document.getElementById('btn-settings')?.addEventListener('click', () => selectors.settingsModal.classList.remove('hidden'));
  selectors.btnCloseSettings.addEventListener('click', async () => {
    const key = selectors.apiKey.value.trim();
    CONFIG.useProxy = selectors.proxyToggle.checked;
    localStorage.setItem(SETTINGS.STORAGE_KEYS.apiKey, key);
    localStorage.setItem(SETTINGS.STORAGE_KEYS.useProxy, CONFIG.useProxy);
    selectors.settingsModal.classList.add('hidden');

    if (key && state.game.history.length === 0) {
      handleAction(null, true);
    }
  });

  // 側邊欄靜態按鈕監聽 (手機版收合按鈕)
  selectors.btnToggleSidebar.addEventListener('click', (e) => {
    e.stopPropagation();
    selectors.sidebar.classList.toggle('collapsed');
  });

  // 點擊外部區域收合狀態欄 (僅限手機版)
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= SETTINGS.UI.mobileWidthPx && !selectors.sidebar.classList.contains('collapsed')) {
      // 如果點擊的是側邊欄以外，且「並非」在彈窗 (Modal) 內，才收合
      if (!selectors.sidebar.contains(e.target) && !e.target.closest('.modal')) {
        selectors.sidebar.classList.add('collapsed');
      }
    }
  });

  selectors.btnCloseSave.addEventListener('click', () => selectors.saveModal.classList.add('hidden'));

  // 點擊彈窗外部關閉
  [selectors.settingsModal, selectors.saveModal].forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  });

  // 👉 點擊頁面其他地方時關閉收合的操作選單
  document.addEventListener('click', (e) => {
    // 如果點擊的不是靈球本身，且「並非」在選單或彈窗內，則關閉選單
    const activeActions = document.querySelector('.collapsed-actions.active');
    if (activeActions && !activeActions.contains(e.target) && !e.target.closest('#mobile-orb') && !e.target.closest('.modal')) {
      activeActions.classList.remove('active');
    }
  });

  selectors.btnConfirmSave.addEventListener('click', () => {
    if (currentSaveMode === 'export') {
      selectors.saveCode.select();
      document.execCommand('copy');
      alert('已複製到剪貼簿');
      selectors.saveModal.classList.add('hidden');
    } else {
      importSave();
    }
  });

  // 移除重複或無效的監聽器，功能已移至 attachSidebarListeners


  selectors.actionForm.addEventListener('submit', handleAction);
  selectors.playerAction.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      selectors.actionForm.dispatchEvent(new Event('submit'));
    }
  });

  // Tab 鍵循環選擇快捷動作
  selectors.playerAction.addEventListener('keydown', (e) => {
    const btns = selectors.quickActions.querySelectorAll('.quick-btn');
    if (btns.length === 0) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      state.quickActionIndex = (state.quickActionIndex + 1) % btns.length;
      updateQuickActionSelection(btns);
    } else if (e.key === 'ArrowDown' && state.quickActionIndex === -1) {
      e.preventDefault();
      state.quickActionIndex = 0;
      updateQuickActionSelection(btns);
    } else if (e.key === 'Escape') {
      state.quickActionIndex = -1;
      updateQuickActionSelection(btns);
    } else if (e.key !== 'Enter') {
      // 只要開始輸入其他文字，就取消高亮狀態
      state.quickActionIndex = -1;
      btns.forEach(b => b.classList.remove('selected'));
    }
  });
}

function updateQuickActionSelection(btns) {
  btns.forEach((btn, idx) => {
    if (idx === state.quickActionIndex) {
      btn.classList.add('selected');
      const fullText = btn.querySelector('.quick-tooltip').textContent;
      selectors.playerAction.value = fullText;
      // 保持游標在最後
      selectors.playerAction.setSelectionRange(fullText.length, fullText.length);
    } else {
      btn.classList.remove('selected');
    }
  });
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(SETTINGS.STORAGE_KEYS.gameSave);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveToStorage() {
  localStorage.setItem(SETTINGS.STORAGE_KEYS.gameSave, JSON.stringify(state.game));
}

function render() {
  const p = state.game.player;
  const sceneData = state.world.scenes[state.game.scene] || { title: state.game.scene };

  selectors.sceneTitle.textContent = sceneData.title;

  renderSidebar();

  if (state.game.history.length === 0) {
    renderQuickActions(sceneData.options || []);
  } else {
    const lastEntry = state.game.history[state.game.history.length - 1];
    renderQuickActions(lastEntry?.result?.suggested_options || []);
  }

  // 更新最後渲染的數值快照
  state.lastStats = {
    '生命': p.hp || 0,
    '靈力': p.sp || 0,
    '業力': p.threat || 0,
    ...(p.abilities ? Object.fromEntries(Object.entries(p.abilities).map(([n, v]) => [n, typeof v === 'object' ? v.val : v])) : {})
  };
}

function renderSidebar() {
  const p = state.game.player;
  const sceneData = state.world.scenes[state.game.scene] || { title: state.game.scene };

  renderExpandedView(p, sceneData.title);
  renderCollapsedView(p);

  attachSidebarListeners();
}

function renderExpandedView(p, sceneTitle) {
  selectors.sidebarExpanded.innerHTML = `
    <div class="sidebar-header">
      <div class="logo">
        <span class="logo-text">TIANYAN</span>
        <span class="logo-sub">天機錄 ${VERSION}</span>
      </div>
    </div>

    <div class="stats-group">
      ${renderStatItemHTML('生命', p.hp || 0, '#ef4444')}
      ${renderStatItemHTML('靈力', p.sp || 0, '#3b82f6')}
      ${renderStatItemHTML('業力', p.threat || 0, '#a855f7')}
      ${p.abilities ? Object.entries(p.abilities).map(([name, value]) => renderStatItemHTML(name, value, '#E2B87E')).join('') : ''}
    </div>

    <div class="action-menu">
      <button id="btn-settings-exp" class="icon-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        <span>冥想配置</span>
      </button>
      <button id="export-save-exp" class="icon-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
        <span>匯出命錄</span>
      </button>
      <button id="import-save-exp" class="icon-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        <span>讀取因果</span>
      </button>
      <button id="clear-game-exp" class="icon-btn danger">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        <span>重塑乾坤</span>
      </button>
    </div>

    <div class="location-badge">
      <span class="label">當前坐標</span>
      <span class="value">${sceneTitle}</span>
    </div>
  `;
}

function renderCollapsedView(p) {
  const stats = [
    { label: '生命', value: p.hp || 0, color: '#ef4444' },
    { label: '靈力', value: p.sp || 0, color: '#3b82f6' },
    { label: '業力', value: p.threat || 0, color: '#a855f7' },
    ...(p.abilities ? Object.entries(p.abilities).map(([k, v]) => ({ 
      label: k.slice(0, 2), 
      value: typeof v === 'object' ? `${v.val}/${v.min}/${v.max}` : v, 
      color: '#E2B87E' 
    })) : [])
  ];

  selectors.sidebarCollapsed.innerHTML = `
    <div class="collapsed-block">
      <!-- 桌面版：簡化數據點 -->
      <div class="collapsed-stats desktop-only">
        ${stats.map(s => `
          <div class="stat-dot-wrapper">
            <div class="stat-dot" style="background: ${s.color}; box-shadow: 0 0 8px ${s.color};"></div>
            <div class="dot-tooltip">${s.label}: ${s.label === '解析度' ? s.value + '%' : s.value}</div>
          </div>
        `).join('')}
      </div>

      <!-- 手機版：懸浮靈球 -->
      <div class="stat-orb mobile-only" id="mobile-orb">
        <div class="orb-content">
          ${stats.map((s, i) => {
    const displayVal = s.label === '解析度' ? `${s.value}%` : s.value;
    const hasChanged = state.lastStats[s.label] !== s.value;
    return `
            <div class="orb-stat-slide ${i === 0 ? 'active' : ''}" style="--stat-color: ${s.color}" data-label="${s.label}">
              <span class="orb-label">${s.label}</span>
              <span class="orb-value">${createOdometerHTML(displayVal, hasChanged)}</span>
            </div>
          `;
  }).join('')}
        </div>
        <div class="orb-ring"></div>
      </div>

      <!-- 收合時的操作按鈕 (4個按鈕) -->
      <div class="collapsed-actions">
        <button id="btn-settings-col" class="circle-btn" title="冥想配置"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>
        <button id="export-save-col" class="circle-btn" title="匯出命錄"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg></button>
        <button id="import-save-col" class="circle-btn" title="讀取因果"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>
        <button id="clear-game-col" class="circle-btn danger" title="重塑乾坤"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
      </div>
    </div>
  `;

  // 在渲染後透過 setTimeout 觸發動畫
  setTimeout(() => {
    const strips = document.querySelectorAll('.orb-stat-slide .odo-strip.animate-me');
    strips.forEach(strip => {
      const val = strip.dataset.value;
      strip.style.transform = `translateY(-${val * 1.5}em)`;
    });
  }, 50);

  startOrbCycling();
}

let orbInterval = null;
function startOrbCycling() {
  if (orbInterval) clearInterval(orbInterval);
  const slides = document.querySelectorAll('.orb-stat-slide');
  if (slides.length <= 1) return;

  let current = 0;
  orbInterval = setInterval(() => {
    const currentSlide = slides[current];
    if (currentSlide) currentSlide.classList.remove('active');
    current = (current + 1) % slides.length;
    const nextSlide = slides[current];
    if (nextSlide) nextSlide.classList.add('active');
  }, 2500);
}

function createOdometerHTML(value, animate = true) {
  const str = String(value);
  return `
    <div class="odometer">
      ${str.split('').map(char => {
    if (isNaN(parseInt(char)) || char === ' ') return `<span class="odo-static">${char}</span>`;
    const digit = parseInt(char);
    const initialTransform = animate ? '0em' : `-${digit * 1.5}em`;
    const animateClass = animate ? 'animate-me' : '';
    return `
          <div class="odo-digit">
            <div class="odo-strip ${animateClass}" style="transform: translateY(${initialTransform})" data-value="${digit}">
              ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<span>${n}</span>`).join('')}
            </div>
          </div>
        `;
  }).join('')}
    </div>
  `;
}

function renderStatItemHTML(label, value, color) {
  const safeLabel = btoa(unescape(encodeURIComponent(label))).replace(/=/g, '');
  
  let displayValue = value;
  let progress = 0;
  let hasChanged = false;

  if (typeof value === 'object' && value !== null) {
    displayValue = `${value.val}/${value.min}/${value.max}`;
    progress = value.max > value.min ? ((value.val - value.min) / (value.max - value.min)) * 100 : 0;
    hasChanged = state.lastStats[label] !== value.val;
  } else {
    displayValue = label === '解析度' ? `${value}%` : value;
    progress = Math.min(100, value);
    hasChanged = state.lastStats[label] !== value;
  }

  const odoHTML = createOdometerHTML(displayValue, hasChanged);

  if (hasChanged) {
    setTimeout(() => {
      const strips = document.querySelectorAll(`#stat-item-${safeLabel} .odo-strip.animate-me`);
      strips.forEach(strip => {
        const val = strip.dataset.value;
        strip.style.transform = `translateY(-${val * 1.5}em)`;
      });
    }, 50);
  }

  return `
    <div class="stat-item" id="stat-item-${safeLabel}">
      <span class="label">${label}</span>
      <span class="value">${odoHTML}</span>
      <div class="value-bar-container">
        <div class="value-bar" id="bar-${safeLabel}" style="width: ${Math.max(0, Math.min(100, progress))}%; background: ${color}; box-shadow: 0 0 10px ${color}66;"></div>
      </div>
    </div>
  `;
}

function attachSidebarListeners() {
  const setupBtn = (id, action) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', action);
  };

  const openSettings = () => {
    console.log('Opening settings modal');
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('hidden');
  };
  const openExport = () => {
    console.log('Opening export modal');
    currentSaveMode = 'export';
    selectors.saveModalTitle.textContent = '匯出命錄卷軸';
    selectors.btnConfirmSave.textContent = '烙印至神識 (複製)';
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify(state.game))));
    selectors.saveCode.value = payload;
    const modal = document.getElementById('save-modal');
    if (modal) modal.classList.remove('hidden');
  };
  const openImport = () => {
    console.log('Opening import modal');
    currentSaveMode = 'import';
    selectors.saveModalTitle.textContent = '讀取因果命錄';
    selectors.btnConfirmSave.textContent = '執行推演';
    selectors.saveCode.value = '';
    const modal = document.getElementById('save-modal');
    if (modal) modal.classList.remove('hidden');
  };
  const runClear = () => {
    if (confirm('確定要重塑乾坤（清空所有存檔）嗎？')) clearGame();
  };

  ['exp', 'col'].forEach(suffix => {
    setupBtn(`btn-settings-${suffix}`, openSettings);
    setupBtn(`export-save-${suffix}`, openExport);
    setupBtn(`import-save-${suffix}`, openImport);
    setupBtn(`clear-game-${suffix}`, runClear);
  });

  // 手機版：點擊靈球開關快捷選單
  const orb = document.getElementById('mobile-orb');
  if (orb) {
    orb.addEventListener('click', (e) => {
      e.stopPropagation();
      const actions = orb.parentElement.querySelector('.collapsed-actions');
      if (actions) {
        actions.classList.toggle('active');
      }
    });
  }
}

function renderQuickActions(options) {
  state.quickActionIndex = -1;
  selectors.quickActions.innerHTML = '';
  options.slice(0, 4).forEach((opt, index) => {
    const btn = document.createElement('button');
    btn.className = 'quick-btn glass';

    const displayOpt = opt.length > 5 ? opt.slice(0, 5) + '...' : opt;

    btn.innerHTML = `
      <span class="quick-index">${index + 1}</span>
      <span class="quick-text">${displayOpt}</span>
      <div class="quick-tooltip">${opt}</div>
    `;

    btn.addEventListener('click', () => {
      selectors.playerAction.value = opt;
      selectors.playerAction.focus();
    });
    selectors.quickActions.appendChild(btn);
  });
}

function appendStory(text, type = 'narrative', timestamp = null) {
  const entry = document.createElement('div');
  entry.className = `story-entry ${type}`;
  const date = timestamp ? new Date(timestamp) : new Date();
  const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  const sender = type === 'action' ? 'PLAYER' : (type === 'system' ? 'SYSTEM' : 'AI');

  // 僅對敘事進行段落格式化，其他類型僅做脫殼
  const finalContent = type === 'narrative' ? formatNarrative(text) : cleanText(text);

  entry.innerHTML = `
    <div class="entry-header"><span class="sender">${sender}</span> <span class="time">${timeStr}</span></div>
    <div class="entry-content">${text ? marked.parse(finalContent) : ''}</div>`;

  const wasAtBottom = selectors.storyLog.scrollHeight - selectors.storyLog.scrollTop - selectors.storyLog.clientHeight < SETTINGS.UI.stickToBottomThresholdPx;
  selectors.storyLog.appendChild(entry);
  if (wasAtBottom) {
    selectors.storyLog.scrollTop = selectors.storyLog.scrollHeight;
  }
  return entry;
}

/**
 * 平滑打字機效果器
 */
function createTypewriter(el, scrollContainer) {
  let queue = "";
  let fullContent = "";
  let timer = null;
  let isDone = false;

  const type = () => {
    if (queue.length > 0 || !isDone) {
      if (queue.length > 0) {
        // 固定速度：每次打 1 個字
        const batchSize = 1;
        const chars = queue.substring(0, batchSize);
        queue = queue.substring(batchSize);
        fullContent += chars;

        const wasAtBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 30;
        const formatted = formatNarrative(fullContent);
        el.innerHTML = marked.parse(formatted);

        if (wasAtBottom) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
      timer = setTimeout(type, SETTINGS.UI.typewriterDelayMs);
    } else {
      timer = null;
    }
  };

  return {
    push: (text) => {
      queue += text;
      if (!timer) type();
    },
    finish: () => {
      isDone = true;
    },
    stop: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      isDone = true;
      queue = "";
    },
    wait: () => new Promise(resolve => {
      const check = () => {
        if (isDone && queue.length === 0) resolve();
        else setTimeout(check, 50);
      };
      check();
    })
  };
}

// ========== 雙階段 Pipeline 核心 ==========

// ---------- LLM / API ----------
function buildSystemPromptForModel(model, baseSystemPrompt, enableThinking) {
  if (model.includes('gpt-oss')) {
    return baseSystemPrompt + (enableThinking ? SETTINGS.LLM.gptOssReasoningHints.high : SETTINGS.LLM.gptOssReasoningHints.low);
  }
  return baseSystemPrompt;
}

function buildChatPayload(model, systemPrompt, userContent, enableThinking) {
  const base = SETTINGS.LLM.defaults;
  const payload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: base.temperature,
    top_p: base.top_p,
    max_tokens: base.max_tokens,
    stream: base.stream,
    response_format: base.response_format,
  };

  // 模型特化參數：qwen 系列
  if (model.includes('qwen')) {
    payload.temperature = SETTINGS.LLM.qwen.temperature;
    payload.top_p = SETTINGS.LLM.qwen.top_p;
    payload.max_tokens = SETTINGS.LLM.qwen.max_tokens;
    if (enableThinking && SETTINGS.LLM.qwen.enable_thinking) {
      payload.chat_template_kwargs = { enable_thinking: true };
    }
  }

  // 模型特化參數：deepseek 系列
  if (model.includes('deepseek')) {
    payload.temperature = SETTINGS.LLM.deepseek.temperature;
    payload.top_p = SETTINGS.LLM.deepseek.top_p;
    payload.max_tokens = SETTINGS.LLM.deepseek.max_tokens;
    if (enableThinking && SETTINGS.LLM.deepseek.thinking) {
      payload.extra_body = {
        chat_template_kwargs: {
          thinking: true,
          reasoning_effort: SETTINGS.LLM.deepseek.reasoning_effort
        }
      };
    }
  }

  return payload;
}

// 通用 API 串流呼叫（SSE: data: ...）
async function streamAPICall(systemPrompt, userContent, onDelta, enableThinking = true) {
  const apiKey = selectors.apiKey.value.trim();
  const url = CONFIG.useProxy ? CONFIG.proxyUrl : CONFIG.directUrl;
  const model = selectors.modelSelect.value;

  const finalSystemPrompt = buildSystemPromptForModel(model, systemPrompt, enableThinking);
  const payload = buildChatPayload(model, finalSystemPrompt, userContent, enableThinking);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error(`API 請求失敗 (${response.status})`);

  // --- 支援非串流回傳 (Non-streaming) ---
  if (!payload.stream) {
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || "API 內部錯誤");
    const content = data.choices?.[0]?.message?.content || "";
    if (onDelta && content) onDelta(content, content);
    return content;
  }

  // --- 處理串流回傳 (Streaming) ---
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      const trimmedLine = line.trim();
      if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;
      const dataStr = trimmedLine.slice(6);
      if (dataStr === '[DONE]') break;
      try {
        const data = JSON.parse(dataStr);
        if (data.error) throw new Error(data.error.message || "API 內部錯誤");
        const delta = data.choices?.[0]?.delta?.content || "";
        if (delta) {
          fullText += delta;
          if (onDelta) onDelta(delta, fullText);
        }
      } catch (e) {
        if (e.message !== "JSON.parse error" && !e.name?.includes("SyntaxError")) {
          throw e;
        }
      }
    }
  }

  return fullText;
}

async function handleAction(e, isFirstMove = false, retryAction = null) {
  if (e) e.preventDefault();
  if (state.isThinking) return;

  if (isFirstMove) {
    selectors.storyLog.innerHTML = '';
  }

  const action = retryAction !== null ? retryAction : selectors.playerAction.value.trim();
  if (!action && !isFirstMove) return;

  const apiKey = selectors.apiKey.value.trim();
  if (!apiKey) {
    selectors.settingsModal.classList.remove('hidden');
    return;
  }

  const timestamp = Date.now();
  if (!isFirstMove && retryAction === null) {
    appendStory(action, 'action', timestamp);
    selectors.playerAction.value = '';
  }

  setThinking(true);
  const currentEntry = appendStory('', 'narrative', timestamp);
  const contentEl = currentEntry.querySelector('.entry-content');
  contentEl.innerHTML = '';

  // ========== Phase 0: Director (劇情導演) ==========
  let directorPlan = null;
  try {
    const directorUserContent = buildDirectorPrompt(action, isFirstMove);
    const directorText = await streamAPICall(DIRECTOR_PROMPT, directorUserContent, null, true);
    directorPlan = JSON.parse(directorText);
    console.log("[Phase 0] Director Plan:", directorPlan);
  } catch (err) {
    console.error("[Phase 0] Director Phase Failed:", err);
    directorPlan = {
      scene_goal: "活下去並探索真相",
      dramatic_conflict: "未知的壓迫感與環境威脅",
      reveal: "此地的空間結構正在發生微小坍塌",
      ending_hook: "陰影中似乎有視線在注視著你"
    };
  }

  // ========== Phase 1: 故事生成 ==========
  let narrative = null;
  let narrativeRetries = 0;
  const MAX_NARRATIVE_RETRIES = 3;

  while (!narrative && narrativeRetries < MAX_NARRATIVE_RETRIES) {
    if (narrativeRetries > 0) {
      console.warn(`[Phase1] 故事解析失敗，重跑第 ${narrativeRetries} 次...`);
      if (state.currentTypewriter) state.currentTypewriter.stop();
      contentEl.innerHTML = '';
    }
    try {
      const sceneData = state.world.scenes[state.game.scene];
      let systemPrompt = NARRATIVE_PROMPT;
      if (state.world.globalPrompt) {
        systemPrompt += `\n\n【世界觀全局設定】\n${state.world.globalPrompt}`;
      }

      const userContent = buildNarrativePromptWithDirector(action, directorPlan, isFirstMove);

      let displayedLen = 0;
      const typewriter = createTypewriter(contentEl, selectors.storyLog);
      state.currentTypewriter = typewriter;

      const fullText = await streamAPICall(systemPrompt, userContent, (delta, accumulated) => {
        const currentNarrative = extractNarrative(accumulated) || "";
        if (currentNarrative.length > displayedLen) {
          const newText = currentNarrative.substring(displayedLen);
          displayedLen = currentNarrative.length;
          typewriter.push(newText);
        }
      });

      typewriter.finish();
      narrative = extractNarrative(fullText);
    } catch (err) {
      console.error(`[Phase1] 串流錯誤:`, err.message);
    }
    narrativeRetries++;
  }

  if (!narrative) {
    console.error('[Phase1] 故事生成失敗，已達最大重試次數');
    showRetryError('故事生成失敗', isFirstMove, action, contentEl, currentEntry);
    setThinking(false);
    return;
  }

  // ========== Phase 2: 數據推演 ==========
  let meta = null;
  let metaRetries = 0;
  const MAX_META_RETRIES = 2;

  while (!meta && metaRetries < MAX_META_RETRIES) {
    if (metaRetries > 0) {
      console.warn(`[Phase2] 數據解析失敗，重跑第 ${metaRetries} 次...`);
    }
    try {
      const context = isFirstMove
        ? buildMetaPromptContext("開始遊戲")
        : buildMetaPromptContext(action);

      const metaUserContent = META_PROMPT
        .replace('{{CONTEXT}}', context)
        .replace('{{NARRATIVE}}', narrative);

      const metaText = await streamAPICall(
        '你是《天衍九州》數據裁判。僅回傳 JSON 格式的數值數據。',
        metaUserContent,
        null,
        false // 數據推演階段禁用思考模式
      );
      meta = extractMeta(metaText);
      if (meta) {
        console.log('[Phase2] 數據推演完成', meta);
      } else {
        console.warn(`[Phase2] 未能解析 meta，原始內容:`, metaText.slice(0, 200));
      }
    } catch (err) {
      console.error(`[Phase2] 串流錯誤:`, err.message);
    }
    metaRetries++;
  }

  if (!meta) {
    console.warn('[Phase2] 數據推演失敗，將使用預設空數據');
    meta = { impact: {}, suggested_options: ["繼續探索", "觀察四周", "調息打坐", "查看狀態"] };
  }

  // 重要：在此處等待打字機完全結束，再顯示數據提示泡泡
  if (state.currentTypewriter) {
    await state.currentTypewriter.wait();
  }

  if (narrative) {
    contentEl.innerHTML = marked.parse(formatNarrative(narrative));
  }

  const { impact, suggested_options } = parseMeta(meta);

  // 處理「未完待續」邏輯
  const isContinuation = meta && meta.has_more;
  if (isContinuation) {
    suggested_options.unshift("繼續敘事...");
  }

  // 更新 Flags
  if (meta.flags) {
    state.game.story_flags = { ...(state.game.story_flags || {}), ...meta.flags };
  }

  const resultData = { narrative: narrative.trim(), impact, suggested_options };

  if (!meta) {
    console.warn('[Phase2] 數據推演失敗，已達最大重試次數，僅保存敘事');
    showRetryError('數據推演失敗，故事已保存', isFirstMove, action, contentEl, currentEntry);
  }

  console.log("[System] 雙階段完成", resultData);

  state.game.history.push({ action: isFirstMove ? "START" : action, result: resultData, timestamp });
  if (state.game.history.length > state.historyLimit) state.game.history.shift();
  applyImpact(resultData.impact || {});
  saveToStorage();
  render();
  setThinking(false);
}

function showRetryError(msg, isFirst, act, el, entry) {
  if (state.currentTypewriter) state.currentTypewriter.stop();
  if (el.querySelector('.error-container')) return;

  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-container';
  errorDiv.innerHTML = `
    <div class="error-wrapper glass">
      <span class="error-msg">系統異常：${msg}</span>
      <button class="retry-btn glass" title="點擊重試">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
        重試
      </button>
    </div>`;
  el.appendChild(errorDiv);

  const retryBtn = errorDiv.querySelector('.retry-btn');
  if (retryBtn) {
    retryBtn.onclick = (e) => {
      e.stopPropagation();
      entry.remove();
      handleAction(null, isFirst, act);
    };
  }
}


function setThinking(val) {
  state.isThinking = val;
  if (val) {
    if (!state.thinkingEntry) state.thinkingEntry = appendThinking();
  } else {
    state.thinkingEntry?.remove?.();
    state.thinkingEntry = null;
  }
}


function buildDirectorPrompt(action, isFirstMove) {
  const g = state.game;
  const scene = state.world.scenes[g.scene];

  let content = `【世界規則】\n${(state.world.world_rules || []).join('\n')}\n主線謎團：${state.world.main_mystery || ''}`;

  content += `\n\n【當前階段 (Arc)】
目標：${g.current_arc?.goal || ''}
威脅：${g.current_arc?.villain || ''}
壓力：${g.current_arc?.pressure || ''}`;

  content += `\n\n【劇情狀態 (Flags)】
${JSON.stringify(g.story_flags || {})}`;

  content += `\n\n【當前場景：${scene?.title || g.scene}】
核心目標：${scene?.scene_goal || ''}
主要衝突：${scene?.scene_conflict || ''}
隱藏伏筆：${scene?.scene_twist || ''}
失敗後果：${scene?.scene_fail_state || ''}`;

  if (scene?.npcs?.length > 0) {
    content += `\n登場人物：\n${scene.npcs.map(n => `- ${n.name}: 目標[${n.goal}], 恐懼[${n.fear}], 關係[${n.relationship}]`).join('\n')}`;
  }

  content += `\n\n【玩家狀態】
  氣血 ${g.player.hp}/100, 靈力 ${g.player.sp}/100, 業力 ${g.player.threat}`;
  
  if (g.player.abilities && Object.keys(g.player.abilities).length > 0) {
    content += `\n能力：\n${Object.entries(g.player.abilities).map(([n, v]) => {
      if (typeof v === 'object') return `- ${n}: ${v.val} (範圍: ${v.min}-${v.max})`;
      return `- ${n}: ${v}`;
    }).join('\n')}`;
  }

  content += `\n\n【前情提要】
${g.history?.slice(-2).map(h => `- 行動: ${h.action}\n- 結果: ${h.result?.narrative.slice(0, 100)}...`).join('\n') || '無'}`;

  if (action === "繼續敘事...") {
    content += `\n\n【當前任務】
故事在精彩處截斷了，請繼續接續上文進行敘事，保持張力並給出本段的小結或新的轉折。`;
  }

  content += `\n\n【玩家當前行動】\n${isFirstMove ? '正式開啟這場逆天之旅的第一幕。' : (action === "繼續敘事..." ? "（接續上文）" : action)}`;

  return content;
}

function buildNarrativePromptWithDirector(action, plan, isFirstMove) {
  const g = state.game;
  const scene = state.world.scenes[g.scene];

  return `【導演規劃 (必須嚴格執行)】
1. 本段目標：${plan.scene_goal}
2. 戲劇衝突：${plan.dramatic_conflict}
3. 情報揭露：${plan.reveal}
4. 結尾鉤子：${plan.ending_hook}

【場景細節 (僅供參考素材)】
- 地點：${scene?.title || g.scene}
- 環境：${scene?.location_core || ''}
- 人物：${(scene?.npcs || []).map(n => `${n.name}(說話風格:${n.speaking_style})`).join(', ')}

【玩家行動】
${isFirstMove ? '正式開啟這場逆天之旅的第一幕。' : action}

請開始撰寫敘事：`;
}

// [Phase 2 專用] 包含預設選項、情節大綱與場景連結，引導 AI 產出正確的數據與選項
function buildMetaPromptContext(action) {
  const g = state.game;
  const scene = state.world.scenes[g.scene];

  let content = `【當前情勢】
場景：${scene?.title || g.scene}
行動：${action}

【玩家目前狀態】
氣血: ${g.player.hp}/100
靈力: ${g.player.sp}/100
業力: ${g.player.threat}
能力:
${Object.entries(g.player.abilities || {}).map(([n, v]) => {
  if (typeof v === 'object') return `- ${n}: ${v.val} (範圍: ${v.min}-${v.max})`;
  return `- ${n}: ${v}`;
}).join('\n')}`;

  if (scene?.choices?.length > 0) {
    content += `\n場景預設選擇參考：\n- ${scene.choices.join('\n- ')}`;
  }

  if (scene?.scene_exit?.length > 0) {
    content += `\n可遷移區域：${scene.scene_exit.join('、')}`;
  }

  content += `\n\n請根據敘事內容與上述背景，決定 HP/SP/威脅值 的變動，並生成 3-5 個具備「戲劇後果」的選項。`;

  return content;
}

function showFloatingImpact(label, delta) {
  // 確保容器存在
  let container = document.getElementById('impact-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'impact-container';
    document.body.appendChild(container);
  }

  const el = document.createElement('div');
  const isPos = delta > 0;
  el.className = `floating-impact ${isPos ? 'positive' : 'negative'}`;
  el.innerHTML = `
    <div class="impact-bubble">
      <span class="impact-label">${label}</span>
      <span class="impact-value">${isPos ? '+' : ''}${delta}</span>
    </div>
  `;

  container.appendChild(el);

  // 3秒後淡出並移除
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 300); // 等待 CSS 動畫結束
  }, SETTINGS.UI.floatingImpactDurationMs);

  // 嘗試觸發側邊欄動畫
  const safeLabel = btoa(unescape(encodeURIComponent(label))).replace(/=/g, '');
  const bar = document.getElementById(`bar-${safeLabel}`);
  const item = document.getElementById(`stat-item-${safeLabel}`);
  if (bar) {
    bar.classList.remove('flash');
    void bar.offsetWidth; // trigger reflow
    bar.classList.add('flash');
  }
  if (item) {
    item.classList.remove('pulse');
    void item.offsetWidth;
    item.classList.add('pulse');
  }
}

function applyImpact(impact) {
  const p = state.game.player;
  if (!p.abilities) p.abilities = {};

  const changes = [];

  if (impact.hp !== undefined && impact.hp !== 0) {
    p.hp = Math.min(100, Math.max(0, p.hp + impact.hp));
    changes.push(['生命', impact.hp]);
  }
  if (impact.sp !== undefined && impact.sp !== 0) {
    p.sp = Math.min(100, Math.max(0, p.sp + impact.sp));
    changes.push(['靈力', impact.sp]);
  }
  if (impact.threat !== undefined && impact.threat !== 0) {
    p.threat = Math.max(0, p.threat + impact.threat);
    changes.push(['業力', impact.threat]);
  }

  if (impact.new_abilities) {
    Object.entries(impact.new_abilities).forEach(([n, v]) => {
      p.abilities[n] = v;
      changes.push([n, typeof v === 'object' ? v.val : v]);
    });
  }

  if (impact.update_abilities) {
    Object.entries(impact.update_abilities).forEach(([n, v]) => {
      if (p.abilities[n] !== undefined) {
        if (typeof p.abilities[n] === 'object') {
          // 如果傳入的是物件，直接更新或部分更新
          if (typeof v === 'object') {
             p.abilities[n].val = Math.min(v.max ?? p.abilities[n].max, Math.max(v.min ?? p.abilities[n].min, p.abilities[n].val + v.val));
             if (v.min !== undefined) p.abilities[n].min = v.min;
             if (v.max !== undefined) p.abilities[n].max = v.max;
             changes.push([n, v.val]);
          } else {
             // 僅更新數值
             const oldVal = p.abilities[n].val;
             p.abilities[n].val = Math.min(p.abilities[n].max, Math.max(p.abilities[n].min, p.abilities[n].val + v));
             changes.push([n, p.abilities[n].val - oldVal]);
          }
        } else {
          // 傳統數值更新
          p.abilities[n] = Math.min(100, Math.max(0, p.abilities[n] + v));
          changes.push([n, v]);
        }
      }
    });
  }

  if (impact.scene && state.world.scenes[impact.scene]) {
    state.game.scene = impact.scene;
    // 更新故事進度（天眼）
    if (!state.game.visitedScenes) state.game.visitedScenes = [];
    if (!state.game.visitedScenes.includes(impact.scene)) {
      state.game.visitedScenes.push(impact.scene);
      const totalScenes = Object.keys(state.world.scenes).length;
      const progress = Math.round((state.game.visitedScenes.length / totalScenes) * 100);
      const oldResolution = (typeof state.game.player.abilities['天眼'] === 'object') ? state.game.player.abilities['天眼'].val : (state.game.player.abilities['天眼'] || 0);
      if (progress > oldResolution) {
        if (typeof state.game.player.abilities['天眼'] === 'object') {
          state.game.player.abilities['天眼'].val = progress;
        } else {
          state.game.player.abilities['天眼'] = { val: progress, min: 0, max: 100 };
        }
        changes.push(['天眼', progress - oldResolution]);
      }
    }
  }

  // 自動更新悟性: 根據歷史長度微幅增加，代表修仙路上的領悟
  const computeBonus = Math.floor(state.game.history.length / 5);
  const currentCompute = (typeof state.game.player.abilities['悟性'] === 'object') ? state.game.player.abilities['悟性'].val : (state.game.player.abilities['悟性'] || 0);
  const newCompute = 10 + computeBonus; // 基礎 10 + 每 5 次行動 +1
  if (newCompute > currentCompute) {
    if (typeof state.game.player.abilities['悟性'] === 'object') {
      state.game.player.abilities['悟性'].val = newCompute;
    } else {
      state.game.player.abilities['悟性'] = { val: newCompute, min: 0, max: 100 };
    }
    changes.push(['悟性', newCompute - currentCompute]);
  }

  render();

  // 渲染後執行補間動畫
  changes.forEach(([label, delta], i) => {
    setTimeout(() => showFloatingImpact(label, delta), i * SETTINGS.UI.floatingImpactStaggerMs);
  });
}

function importSave() {
  try {
    const json = decodeURIComponent(escape(atob(selectors.saveCode.value.trim())));
    state.game = JSON.parse(json);
    saveToStorage();
    location.reload();
  } catch (e) { alert('無效數據'); }
}

function clearGame() {
  localStorage.removeItem(SETTINGS.STORAGE_KEYS.gameSave);
  location.reload();
}

init().catch(console.error);
