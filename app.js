// ========== 雙階段 Prompt 架構 ==========
// Phase 1: 故事生成（純敘事，無數值）
const NARRATIVE_PROMPT = `你是《天衍九州》裁判。嚴禁廢話，僅回傳標準 JSON。
[風格] 東方玄幻+賽博龐克。將數據融入感官敘事，禁條列。
[格式] {"narrative": "故事內容"}
[限制]
1. 以繁體中文撰寫，嚴格禁止出現任何數值（如 HP-10、+5）。
2. 數值變動需轉化為「可感知的體驗描寫」（如：脈搏加速、代碼在視網膜閃爍）。
3. 使用 Markdown 分段。禁止出現 meta、系統數據等技術資訊。`;

const META_PROMPT = `你是《天衍九州》數據裁判。根據以下背景資訊與本輪故事，推演遊戲數值變化與後續選項。

【背景資訊與狀態】
{{CONTEXT}}

【本輪故事敘事】
「{{NARRATIVE}}」
[格式] 僅回傳 JSON：
{
  "hp": "+0", "sp": "+0", "threat": "+0", "scene": "null",
  "new_ability": "能力=值/none", "upd_ability": "能力=增減/none",
  "options": ["選項1", "選項2", "選項3"]
}
[限制]
1. 所有欄位為必填。若無變動回傳 "+0"、"null" 或 "none"。
2. 選項 3-5 個，禁句號，每項 <20 字。
3. 數值範圍 -30 ~ +30 整數。`;

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const VERSION = "v1.1.6b"; // 基於 Commit 次數更新的版本號 git rev-list --count HEAD

// 讓單一換行也能在畫面上保留，避免敘事擠成一大段
if (window.marked?.setOptions) {
  marked.setOptions({ breaks: true });
}

const CONFIG = {
  useProxy: localStorage.getItem('tianyan_use_proxy') === 'true',
  proxyUrl: isLocal
    ? 'http://127.0.0.1:4444/v1/chat/completions'
    : 'https://restless-hat-8ef5.jimmy910824.workers.dev/v1/chat/completions',
  directUrl: 'https://integrate.api.nvidia.com/v1/chat/completions'
};

const state = {
  world: null,
  game: null,
  historyLimit: 10, // 增加歷史紀錄長度
  isThinking: false,
  currentTypewriter: null,
};

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

  const parseDeltaNumber = (raw) => {
    if (raw === undefined || raw === null) return undefined;
    const v = Number(String(raw).replace('+', '').trim());
    return Number.isFinite(v) ? v : undefined;
  };

  const parsePairs = (raw) => {
    const out = {};
    if (!raw || /^(none|無|null|nan)$/i.test(String(raw).trim())) return out;
    if (typeof raw === 'object') return raw; // 如果已經是物件就直接回傳
    const parts = String(raw).split(/[;；]/).map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const k = part.slice(0, eq).trim();
      const v = Number(part.slice(eq + 1).trim());
      if (k && Number.isFinite(v)) out[k] = v;
    }
    return out;
  };

  if (meta.hp) impact.hp = parseDeltaNumber(meta.hp);
  if (meta.sp) impact.sp = parseDeltaNumber(meta.sp);
  if (meta.threat) impact.threat = parseDeltaNumber(meta.threat);
  if (meta.scene && meta.scene !== 'null') impact.scene = meta.scene;
  if (meta.new_ability) impact.new_abilities = parsePairs(meta.new_ability);
  if (meta.upd_ability) impact.update_abilities = parsePairs(meta.upd_ability);

  return { impact, suggested_options };
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
        <span class="thinking-text">正在演算因果</span>
        <div class="fb-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>`;
  const wasAtBottom = selectors.storyLog.scrollHeight - selectors.storyLog.scrollTop - selectors.storyLog.clientHeight < 50;
  selectors.storyLog.appendChild(entry);
  if (wasAtBottom) {
    selectors.storyLog.scrollTop = selectors.storyLog.scrollHeight;
  }
  return entry;
}

async function init() {
  state.world = await fetch('world.json').then((res) => res.json());

  const savedKey = localStorage.getItem('tianyan_api_key');
  if (savedKey) selectors.apiKey.value = savedKey;
  selectors.proxyToggle.checked = CONFIG.useProxy;

  const saved = loadFromStorage();

  // 手機版預設收合狀態欄與調整輸入框提示
  if (window.innerWidth <= 768) {
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
    localStorage.setItem('tianyan_api_key', key);
    localStorage.setItem('tianyan_use_proxy', CONFIG.useProxy);
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
    if (window.innerWidth <= 768 && !selectors.sidebar.classList.contains('collapsed')) {
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
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('tianyan_game_save');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveToStorage() {
  localStorage.setItem('tianyan_game_save', JSON.stringify(state.game));
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
        <span class="logo-sub">OS ${VERSION}</span>
      </div>
    </div>

    <div class="stats-group">
      ${renderStatItemHTML('生命體徵', p.hp || 0, '#10b981')}
      ${renderStatItemHTML('靈氣能級', p.sp || 0, '#3b82f6')}
      ${renderStatItemHTML('系統威脅', p.threat || 0, '#ef4444')}
      ${p.abilities ? Object.entries(p.abilities).map(([name, value]) => renderStatItemHTML(name, value, '#E2B87E')).join('') : ''}
    </div>

    <div class="action-menu">
      <button id="btn-settings-exp" class="icon-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        <span>系統設置</span>
      </button>
      <button id="export-save-exp" class="icon-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
        <span>匯出數據</span>
      </button>
      <button id="import-save-exp" class="icon-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        <span>讀取序列</span>
      </button>
      <button id="clear-game-exp" class="icon-btn danger">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        <span>格式化</span>
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
    { label: 'HP', value: p.hp || 0, color: '#10b981' },
    { label: 'SP', value: p.sp || 0, color: '#3b82f6' },
    { label: '威脅', value: p.threat || 0, color: '#ef4444' },
    ...(p.abilities ? Object.entries(p.abilities).map(([k, v]) => ({ label: k.slice(0, 2), value: v, color: '#E2B87E' })) : [])
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
          ${stats.map((s, i) => `
            <div class="orb-stat-slide ${i === 0 ? 'active' : ''}" style="--stat-color: ${s.color}">
              <span class="orb-label">${s.label}</span>
              <span class="orb-value">${s.label === '解析度' ? s.value + '%' : s.value}</span>
            </div>
          `).join('')}
        </div>
        <div class="orb-ring"></div>
      </div>

      <!-- 收合時的操作按鈕 (4個按鈕) -->
      <div class="collapsed-actions">
        <button id="btn-settings-col" class="circle-btn" title="系統設置"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>
        <button id="export-save-col" class="circle-btn" title="匯出數據"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg></button>
        <button id="import-save-col" class="circle-btn" title="讀取序列"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>
        <button id="clear-game-col" class="circle-btn danger" title="格式化"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
      </div>
    </div>
  `;

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

function renderStatItemHTML(label, value, color) {
  const safeLabel = btoa(unescape(encodeURIComponent(label))).replace(/=/g, '');
  const displayValue = label === '解析度' ? `${value}%` : value;
  return `
    <div class="stat-item" id="stat-item-${safeLabel}">
      <span class="label">${label}</span>
      <span class="value">${displayValue}</span>
      <div class="value-bar-container">
        <div class="value-bar" id="bar-${safeLabel}" style="width: ${Math.min(100, value)}%; background: ${color}; box-shadow: 0 0 10px ${color}66;"></div>
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
    selectors.saveModalTitle.textContent = '匯出數據序列';
    selectors.btnConfirmSave.textContent = '複製到剪貼簿';
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify(state.game))));
    selectors.saveCode.value = payload;
    const modal = document.getElementById('save-modal');
    if (modal) modal.classList.remove('hidden');
  };
  const openImport = () => {
    console.log('Opening import modal');
    currentSaveMode = 'import';
    selectors.saveModalTitle.textContent = '匯入數據序列';
    selectors.btnConfirmSave.textContent = '執行解析';
    selectors.saveCode.value = '';
    const modal = document.getElementById('save-modal');
    if (modal) modal.classList.remove('hidden');
  };
  const runClear = () => {
    if (confirm('確定要格式化所有數據嗎？')) clearGame();
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
  const formattedText = text ? text.replace(/。([」』"'〉》）］｝]*)/g, '。$1\n\n') : "";
  entry.innerHTML = `<div class="entry-header"><span class="sender">${sender}</span> <span class="time">${timeStr}</span></div><div class="entry-content">${text ? marked.parse(formattedText) : ''}</div>`;
  const wasAtBottom = selectors.storyLog.scrollHeight - selectors.storyLog.scrollTop - selectors.storyLog.clientHeight < 5;
  selectors.storyLog.appendChild(entry);
  if (wasAtBottom) {
    selectors.storyLog.scrollTop = selectors.storyLog.scrollHeight;
  }
  return entry;
}

// ========== 雙階段 Pipeline 核心 ==========

// 通用 API 串流呼叫
async function streamAPICall(systemPrompt, userContent, onDelta) {
  const apiKey = selectors.apiKey.value.trim();
  const url = CONFIG.useProxy ? CONFIG.proxyUrl : CONFIG.directUrl;
  const model = selectors.modelSelect.value;

  const payload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    temperature: 1.0,
    stream: true,
    max_tokens: 16384,
    response_format: { type: "json_object" }
  };

  if (model.includes('qwen')) {
    payload.temperature = 0.60;
    payload.top_p = 0.95;
    payload.chat_template_kwargs = { "enable_thinking": true };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error(`API 請求失敗 (${response.status})`);

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

// 從串流結果中提取 narrative
function extractNarrative(text) {
  if (!text.trim()) return null;
  try {
    const data = JSON.parse(text);
    return data.narrative || null;
  } catch (e) {
    const match = text.match(/"narrative"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (match) {
      return match[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\');
    }
    if (!text.trim().startsWith('{')) return text;
    return null;
  }
}

// 從串流結果中提取 meta
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

  // ========== Phase 1: 故事生成 ==========
  let narrative = null;
  let narrativeRetries = 0;
  const MAX_NARRATIVE_RETRIES = 3;

  while (!narrative && narrativeRetries < MAX_NARRATIVE_RETRIES) {
    if (narrativeRetries > 0) {
      console.warn(`[Phase1] 故事解析失敗，重跑第 ${narrativeRetries} 次...`);
    }
    try {
      const sceneData = state.world.scenes[state.game.scene];
      let systemPrompt = NARRATIVE_PROMPT;
      if (sceneData && sceneData.systemPrompt) {
        systemPrompt += `\n\n【當前場景特殊規則：${sceneData.title}】\n${sceneData.systemPrompt}`;
      }

      const userContent = isFirstMove
        ? `系統初始化完成。請為玩家開始第一幕。當前場景：${state.world.startingState.scene}。`
        : buildPrompt(action);

      let displayedLen = 0;
      const fullText = await streamAPICall(systemPrompt, userContent, (delta, accumulated) => {
        const currentNarrative = extractNarrative(accumulated) || "";
        if (currentNarrative.length > displayedLen) {
          displayedLen = currentNarrative.length;
          const formatted = currentNarrative.replace(/。([」』"'〉》）］｝]*)(?!\n)/g, '。$1\n\n');
          contentEl.innerHTML = marked.parse(formatted);
          const wasAtBottom = selectors.storyLog.scrollHeight - selectors.storyLog.scrollTop - selectors.storyLog.clientHeight < 100;
          if (wasAtBottom) selectors.storyLog.scrollTop = selectors.storyLog.scrollHeight;
        }
      });

      narrative = extractNarrative(fullText);
      if (narrative) {
        console.log(`[Phase1] 故事生成完成 (${narrative.length} 字)`);
        const formatted = narrative.replace(/。([」』"'〉》）］｝]*)(?!\n)/g, '。$1\n\n');
        contentEl.innerHTML = marked.parse(formatted);
      } else {
        console.warn(`[Phase1] 未能從回傳中提取 narrative，原始內容:`, fullText.slice(0, 200));
      }
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
        ? `系統初始化第一幕。場景：${state.world.startingState.scene}。玩家狀態：HP 100, SP 100, 威脅 0`
        : buildPrompt(action);

      const metaUserContent = META_PROMPT
        .replace('{{CONTEXT}}', context)
        .replace('{{NARRATIVE}}', narrative);
        
      const metaText = await streamAPICall(
        '你是《天衍九州》數據裁判。僅回傳 JSON 格式的數值數據。',
        metaUserContent,
        null
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

  const { impact, suggested_options } = parseMeta(meta);
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
  if (state.currentTypewriter) clearInterval(state.currentTypewriter);
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


function buildPrompt(action) {
  const g = state.game;
  return `【環境狀態】
場景：${state.world.scenes[g.scene]?.title}
描述：${state.world.scenes[g.scene]?.description}
玩家狀態：HP ${g.player.hp}, SP ${g.player.sp}, 威脅 ${g.player.threat}, 能力 ${JSON.stringify(g.player.abilities)}

【歷史紀錄】
${g.history?.slice(-3).map(h => `- 行動: ${h.action}\n- 結果: ${h.result?.narrative.slice(0, 50)}...`).join('\n') || '無'}

【玩家當前行動】
${action}

請根據以上資訊，以裁判身份推演結果，並僅回傳符合規範的 JSON 格式。`;
}

function showFloatingImpact(label, delta) {
  const el = document.createElement('div');
  const isPos = delta > 0;
  el.className = `floating-impact ${isPos ? 'positive' : 'negative'}`;
  el.innerHTML = `
    <div class="impact-bubble">
      <span class="impact-label">${label}</span>
      <span class="impact-value">${isPos ? '+' : ''}${delta}</span>
    </div>
  `;

  // 隨機化位置
  const x = window.innerWidth / 2 + (Math.random() - 0.5) * 200;
  const y = window.innerHeight / 2 + (Math.random() - 0.5) * 100;

  el.style.left = `${x}px`;
  el.style.top = `${y}px`;

  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500); // 增加顯示時間

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
    changes.push(['生命體徵', impact.hp]);
  }
  if (impact.sp !== undefined && impact.sp !== 0) {
    p.sp = Math.min(100, Math.max(0, p.sp + impact.sp));
    changes.push(['靈氣能級', impact.sp]);
  }
  if (impact.threat !== undefined && impact.threat !== 0) {
    p.threat = Math.max(0, p.threat + impact.threat);
    changes.push(['系統威脅', impact.threat]);
  }

  if (impact.new_abilities) {
    Object.entries(impact.new_abilities).forEach(([n, v]) => {
      p.abilities[n] = v;
      changes.push([n, v]);
    });
  }

  if (impact.update_abilities) {
    Object.entries(impact.update_abilities).forEach(([n, v]) => {
      if (p.abilities[n] !== undefined) {
        p.abilities[n] = Math.min(100, Math.max(0, p.abilities[n] + v));
        changes.push([n, v]);
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
      const oldResolution = state.game.player.abilities['天眼'] || 0;
      if (progress > oldResolution) {
        state.game.player.abilities['天眼'] = progress;
        changes.push(['天眼', progress - oldResolution]);
      }
    }
  }

  // 自動更新悟性: 根據歷史長度微幅增加，代表修仙路上的領悟
  const computeBonus = Math.floor(state.game.history.length / 5);
  const currentCompute = state.game.player.abilities['悟性'] || 0;
  const newCompute = 10 + computeBonus; // 基礎 10 + 每 5 次行動 +1
  if (newCompute > currentCompute) {
    state.game.player.abilities['悟性'] = newCompute;
    changes.push(['悟性', newCompute - currentCompute]);
  }

  render();

  // 渲染後執行補間動畫
  changes.forEach(([label, delta], i) => {
    setTimeout(() => showFloatingImpact(label, delta), i * 1000);
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
  localStorage.removeItem('tianyan_game_save');
  location.reload();
}

init().catch(console.error);
