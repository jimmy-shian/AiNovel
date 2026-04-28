const SYSTEM_PROMPT = `[ROLE]
你是《天衍九州》的裁判核心。[使用繁體中文輸出內容]

[STYLE_RULE]
- 東方玄幻 + 賽博龐克
- 至少包含1個數據/系統描寫
- 使用感官描述

[JUDGEMENT]
- 成功 / 部分成功 / 失敗
- 不合理請求 → 系統干涉失敗（需寫入敘事）

[NUMERIC_RULE]
- HP/SP/能力值: -30 ~ +30 整數（代表相對增減，例如 +10 或 -5）
- THREAT: >= 0

[NUMERIC_ENFORCEMENT]
- 若超出範圍，自動修正為邊界值

[LANGUAGE_BOUNDARY]
- 故事中不得出現 HP/SP/THREAT 等系統字眼
- META 不得包含敘事句

[STATE_CONTINUITY]
- 延續既有狀態與能力
- 不得憑空新增設定

[META_DEFINITION]
- HP/SP/解析度/算力/THREAT: 必須使用相對值符號（如 +5, -10, +0），代表對現有數值的增減。
- SCENE: 若要切換地圖，填入目標場景標題；否則填入 null。
- NEW_ABILITY: 獲得新能力或物品。格式：能力名=數值。若無則填 none。
- UPD_ABILITY: 更新現有能力。格式：能力名=增量。若無則填 none。
- OPTIONS: 嚴格遵守 3 行格式。

[FORMAT]
先輸出故事（Markdown 分段）

再輸出：

<META>
HP:+0
SP:+0
THREAT:+0
解析度:+0
算力:+0
SCENE:null
NEW_ABILITY:none
UPD_ABILITY:none
OPTIONS:
- 
- 
- 
</META>

[OPTIONS_RULE]
- 必須剛好3行
- 每行以「- 」開頭
- 每行 <=20字
- 不得解釋或使用句號

[FORMAT_ENFORCEMENT]
- 不得輸出 META 以外內容
- 不得缺少欄位
- 欄位順序必須固定

[FAILSAFE]
若格式可能錯誤，縮短故事但保留完整 META，並且使用繁體中文輸出。`;

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

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
  const startTag = '<META>';
  const endTag = '</META>';
  const start = text.indexOf(startTag);
  if (start === -1) return { narrative: text, metaText: null, hasCompleteMeta: false };
  const end = text.indexOf(endTag, start + startTag.length);
  const narrative = text.slice(0, start).trimEnd();
  if (end === -1) {
    return {
      narrative,
      metaText: text.slice(start + startTag.length).trim(),
      hasCompleteMeta: false
    };
  }
  return {
    narrative,
    metaText: text.slice(start + startTag.length, end).trim(),
    hasCompleteMeta: true
  };
}

function parseMeta(metaText) {
  const impact = {};
  const suggested_options = [];
  if (!metaText) return { impact, suggested_options };

  const lines = metaText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let inOptions = false;

  const parseDeltaNumber = (raw) => {
    if (raw === undefined || raw === null) return undefined;
    const v = Number(String(raw).trim());
    return Number.isFinite(v) ? v : undefined;
  };

  const parsePairs = (raw) => {
    const out = {};
    if (!raw || /^(none|無|null|nan)$/i.test(String(raw).trim())) return out;
    const parts = String(raw)
      .split(/[;；]/)
      .map(s => s.trim())
      .filter(Boolean);
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const k = part.slice(0, eq).trim();
      const vRaw = part.slice(eq + 1).trim();
      const v = Number(vRaw);
      if (!k || !Number.isFinite(v)) continue;
      out[k] = v;
    }
    return out;
  };

  for (const line of lines) {
    if (/^(OPTIONS|選項)\s*:/i.test(line)) {
      inOptions = true;
      continue;
    }
    if (inOptions) {
      // 支援多種格式：- 選項, * 選項, 1. 選項, 或直接是文字
      const opt = line.replace(/^[-*]|\d+\./, '').trim();
      if (opt) suggested_options.push(opt);
      continue;
    }

    const m = line.match(/^([^:：]+)\s*[:：]\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toUpperCase();
    const value = m[2].trim();

    if (key === 'HP' || key === '生命') {
      const v = parseDeltaNumber(value);
      if (v !== undefined) impact.hp = v;
    } else if (key === 'SP' || key === '靈氣') {
      const v = parseDeltaNumber(value);
      if (v !== undefined) impact.sp = v;
    } else if (key === 'THREAT' || key === '威脅') {
      const v = parseDeltaNumber(value);
      if (v !== undefined) impact.threat = v;
    } else if (key === 'SCENE' || key === '場景') {
      const s = String(value || '').trim();
      if (s && s !== 'null' && s !== 'None') impact.scene = s;
    } else if (key === 'NEW_ABILITY' || key === '新增能力') {
      impact.new_abilities = parsePairs(value);
    } else if (key === 'UPD_ABILITY' || key === '更新能力') {
      impact.update_abilities = parsePairs(value);
    } else {
      // 自動檢查是否為已存在的能力（如解析度、算力）
      const p = state.game.player;
      const abilityKey = Object.keys(p.abilities || {}).find(k => k.toUpperCase() === key);
      if (abilityKey) {
        if (!impact.update_abilities) impact.update_abilities = {};
        const v = parseDeltaNumber(value);
        if (v !== undefined) impact.update_abilities[abilityKey] = v;
      }
    }
  }

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
      <div class="thinking-spinner">
        <div class="spinner-core">
          <div class="ring"></div>
          <div class="ring"></div>
          <div class="ring"></div>
        </div>
        <span class="thinking-text">正在演算因果...</span>
      </div>
    </div>`;
  selectors.storyLog.appendChild(entry);
  selectors.storyLog.scrollTop = selectors.storyLog.scrollHeight;
  return entry;
}

async function init() {
  state.world = await fetch('world.json').then((res) => res.json());

  const savedKey = localStorage.getItem('tianyan_api_key');
  if (savedKey) selectors.apiKey.value = savedKey;
  selectors.proxyToggle.checked = CONFIG.useProxy;

  const saved = loadFromStorage();

  // 手機版預設收合狀態欄
  if (window.innerWidth <= 768) {
    selectors.sidebar.classList.add('collapsed');
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
      if (!selectors.sidebar.contains(e.target)) {
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
        <span class="logo-sub">OS v4.31b</span>
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
  selectors.sidebarCollapsed.innerHTML = `
    <div class="collapsed-block">
      <div class="collapsed-stats">
        <div class="stat-dot-wrapper">
          <div class="stat-dot hp"></div>
          <div class="mini-bar-bg"><div class="mini-bar hp" style="width: ${p.hp || 0}%"></div></div>
          <span class="dot-tooltip">生命: ${p.hp || 0}</span>
        </div>
        <div class="stat-dot-wrapper">
          <div class="stat-dot sp"></div>
          <div class="mini-bar-bg"><div class="mini-bar sp" style="width: ${p.sp || 0}%"></div></div>
          <span class="dot-tooltip">靈氣: ${p.sp || 0}</span>
        </div>
      </div>
      <div class="collapsed-actions">
        <button id="btn-settings-col" class="circle-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </button>
        <button id="export-save-col" class="circle-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
        </button>
        <button id="import-save-col" class="circle-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
        <button id="clear-game-col" class="circle-btn danger">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </div>
    </div>
  `;
}

function renderStatItemHTML(label, value, color) {
  const safeLabel = btoa(unescape(encodeURIComponent(label))).replace(/=/g, '');
  return `
    <div class="stat-item" id="stat-item-${safeLabel}">
      <span class="label">${label}</span>
      <div class="value-bar-container">
        <div class="value-bar" id="bar-${safeLabel}" style="width: ${Math.min(100, value)}%; background: ${color}; box-shadow: 0 0 10px ${color}66;"></div>
      </div>
      <span class="value">${value}</span>
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
}

function renderQuickActions(options) {
  selectors.quickActions.innerHTML = '';
  options.slice(0, 4).forEach((opt, index) => {
    const btn = document.createElement('button');
    btn.className = 'quick-btn glass';

    // 限制顯示長度，其餘用 ellipsis
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
  const formattedText = text.replace(/。([」』”’〉》）］｝]*)/g, '。$1\n\n');
  entry.innerHTML = `<div class="entry-header"><span class="sender">${sender}</span> <span class="time">${timeStr}</span></div><div class="entry-content">${marked.parse(formattedText)}</div>`;
  selectors.storyLog.appendChild(entry);
  selectors.storyLog.scrollTop = selectors.storyLog.scrollHeight;
  return entry.querySelector('.entry-content');
}

async function handleAction(e, isFirstMove = false, retryAction = null, existingContentEl = null) {
  if (e) e.preventDefault();
  if (state.isThinking) return;

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
  const contentEl = existingContentEl || appendStory('', 'narrative', timestamp);
  contentEl.innerHTML = '';
  let fullText = "";
  let displayedText = "";
  let isStreamActive = true;

  // 打字機循環
  const typeWriter = setInterval(() => {
    if (displayedText.length < fullText.length) {
      displayedText = fullText.slice(0, displayedText.length + 1);
      const { narrative } = splitMetaBlock(displayedText);
      const formattedNarrative = narrative.replace(/。([」』”’〉》）］｝]*)/g, '。$1\n\n');
      contentEl.innerHTML = marked.parse(formattedNarrative);
      selectors.storyLog.scrollTop = selectors.storyLog.scrollHeight;
    } else if (!isStreamActive) {
      clearInterval(typeWriter);
      finalizeTurn();
    }
  }, 90);

  async function finalizeTurn() {
    try {
      if (!fullText.trim()) throw new Error('AI 未返回任何有效敘事內容。請檢查模型名稱與 API Key 是否正確。');

      const { narrative, metaText, hasCompleteMeta } = splitMetaBlock(fullText);
      const { impact, suggested_options } = hasCompleteMeta ? parseMeta(metaText) : { impact: {}, suggested_options: [] };
      const resultData = { narrative: narrative.trim(), impact, suggested_options };

      state.game.history.push({ action: isFirstMove ? "START" : action, result: resultData, timestamp });
      if (state.game.history.length > state.historyLimit) state.game.history.shift();
      applyImpact(resultData.impact || {});
      saveToStorage();
    } catch (err) {
      showError(err.message, isFirstMove, action, contentEl);
    } finally {
      setThinking(false);
    }
  }

  function showError(msg, isFirst, act, el) {
    el.innerHTML = `
      <div class="error-container">
        <span class="error-msg">系統異常：${msg}</span>
        <button class="retry-btn glass" title="點擊重試">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
          重試
        </button>
      </div>`;
    const retryBtn = el.querySelector('.retry-btn');
    if (retryBtn) {
      retryBtn.onclick = () => handleAction(null, isFirst, act, el);
    }
    setThinking(false);
  }

  try {
    const url = CONFIG.useProxy ? CONFIG.proxyUrl : CONFIG.directUrl;
    const userContent = isFirstMove
      ? `系統初始化完成。請為玩家開始第一幕。當前場景：${state.world.startingState.scene}。`
      : buildPrompt(action);

    const sceneData = state.world.scenes[state.game.scene];
    let dynamicSystemPrompt = SYSTEM_PROMPT;
    if (sceneData && sceneData.systemPrompt) {
      dynamicSystemPrompt += `\n\n【當前場景特殊規則：${sceneData.title}】\n${sceneData.systemPrompt}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: selectors.modelSelect.value,
        messages: [
          { role: 'system', content: dynamicSystemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 1.0, stream: true, max_tokens: 16384
      })
    });

    if (!response.ok) throw new Error('API 請求失敗');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        isStreamActive = false;
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

        const dataStr = trimmedLine.slice(6);
        if (dataStr === '[DONE]') break;

        try {
          const data = JSON.parse(dataStr);
          if (data.error) throw new Error(data.error.message || "API 內部錯誤");

          const choice = data.choices?.[0];
          const delta = choice?.delta?.content || "";
          const reasoning = choice?.delta?.reasoning_content || "";

          if (reasoning && state.thinkingEntry) {
            const textEl = state.thinkingEntry.querySelector('.thinking-text');
            if (textEl) textEl.textContent = "正在演算因果...";
          }

          if (delta) {
            fullText += delta;
          }
        } catch (e) {
          // 如果是從 data.error 拋出的明確錯誤，或者是網路/代理層的嚴重錯誤，則繼續向上拋出
          if (e.message !== "JSON.parse error" && !e.name.includes("SyntaxError")) {
            throw e;
          }
          // 忽略流碎片導致的 JSON 解析錯誤
        }
      }
    }

    if (!fullText.trim()) throw new Error('AI 未返回任何有效敘事內容');


  } catch (err) {
    showError(err.message, isFirstMove, action, contentEl);
  } finally {
    // 這裡不主動關閉，交給 finalizeTurn (打字結束) 或 catch (發生錯誤) 處理
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
  return `場景：${state.world.scenes[g.scene]?.title} | 描述：${state.world.scenes[g.scene]?.description}
玩家：HP ${g.player.hp}, SP ${g.player.sp}, 威脅 ${g.player.threat}, 能力 ${JSON.stringify(g.player.abilities)}
最近史：${JSON.stringify(g.history?.slice(-3) || [])}
玩家行動：${action}`;
}

function showFloatingImpact(label, delta) {
  const el = document.createElement('div');
  const isPos = delta > 0;
  el.className = `floating-impact ${isPos ? 'positive' : 'negative'}`;
  el.textContent = `${label} ${isPos ? '+' : ''}${delta}`;

  // 隨機化位置避免重疊
  const x = window.innerWidth / 2 + (Math.random() - 0.5) * 300;
  const y = window.innerHeight / 2 + (Math.random() - 0.5) * 150;

  el.style.left = `${x}px`;
  el.style.top = `${y}px`;

  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);

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

  if (impact.scene && state.world.scenes[impact.scene]) state.game.scene = impact.scene;

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
