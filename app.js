const SYSTEM_PROMPT = `你是《天衍九州》的裁判核心。這是一個由高維數據構成的修仙世界，靈氣是數據溢出，修煉是代碼提權。
你的任務是根據玩家行動描述精彩、連貫且具有畫面感的後果。
請保持敘事風格優雅、充滿東方玄幻與賽博龐克交織的氣氛。
描述字數建議在 200-400 字之間，確保故事推進流暢。

請務必在回覆的最後包含一個 JSON 區塊（放在 Markdown 代碼塊之外，或作為最後一部分），包含以下格式：
{
  "success": true,
  "narrative": "這裡重複或總結上述的敘事內容",
  "impact": {
    "hp": 數值變動,
    "sp": 數值變動,
    "threat": 數值變動,
    "scene": "新場景(若有)",
    "new_abilities": {"能力名": 初始值},
    "update_abilities": {"能力名": 變動值},
    "inventory_add": [],
    "inventory_remove": []
  },
  "suggested_options": ["選項1", "選項2", "選項3"]
}`;

const CONFIG = {
  useProxy: localStorage.getItem('tianyan_use_proxy') === 'true',
  proxyUrl: 'http://127.0.0.1:8001/v1/chat/completions',
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
  thinkingIndicator: document.getElementById('thinking-indicator'),
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
};

let currentSaveMode = 'export';

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

  if (state.game.history.length === 0) renderQuickActions(sceneData.options || []);
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
  return `
    <div class="stat-item">
      <span class="label">${label}</span>
      <div class="value-bar-container">
        <div class="value-bar" style="width: ${Math.min(100, value)}%; background: ${color}; box-shadow: 0 0 10px ${color}66;"></div>
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
    btn.className = 'quick-btn';
    btn.textContent = index + 1;
    btn.title = opt; // 懸停時顯示完整文字
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
  entry.innerHTML = `<div class="entry-header"><span class="sender">${sender}</span> <span class="time">${timeStr}</span></div><div class="entry-content">${marked.parse(text)}</div>`;
  selectors.storyLog.appendChild(entry);
  selectors.storyLog.scrollTop = selectors.storyLog.scrollHeight;
  return entry.querySelector('.entry-content');
}

async function handleAction(e, isFirstMove = false) {
  if (e) e.preventDefault();
  if (state.isThinking) return;

  const action = selectors.playerAction.value.trim();
  if (!action && !isFirstMove) return;

  const apiKey = selectors.apiKey.value.trim();
  if (!apiKey) {
    selectors.settingsModal.classList.remove('hidden');
    return;
  }

  const timestamp = Date.now();
  if (!isFirstMove) {
    appendStory(action, 'action', timestamp);
    selectors.playerAction.value = '';
  }

  setThinking(true);
  const contentEl = appendStory('', 'narrative', timestamp);
  let fullText = "";

  try {
    const url = CONFIG.useProxy ? CONFIG.proxyUrl : CONFIG.directUrl;
    const userContent = isFirstMove
      ? `系統初始化完成。請為玩家開始第一幕。當前場景：${state.world.startingState.scene}。`
      : buildPrompt(action);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: selectors.modelSelect.value,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
        temperature: 1.0, stream: true, max_tokens: 16384, chat_template_kwargs: { enable_thinking: true }
      })
    });

    if (!response.ok) throw new Error('API 請求失敗');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          if (dataStr === '[DONE]') break;
          try {
            const data = JSON.parse(dataStr);
            const delta = data.choices[0].delta?.content || "";
            fullText += delta;
            // 過濾 JSON 區塊不顯示在流式輸出中
            const displayDelta = fullText.replace(/\{[\s\S]*\}/, "");
            contentEl.innerHTML = marked.parse(displayDelta);
            selectors.storyLog.scrollTop = selectors.storyLog.scrollHeight;
          } catch (e) { }
        }
      }
    }

    // 結束後解析 JSON
    const jsonMatch = fullText.match(/\{[\s\S]*\}/);
    let resultData = { narrative: fullText, impact: {}, suggested_options: [] };
    if (jsonMatch) {
      try {
        const jsonPart = JSON.parse(jsonMatch[0]);
        resultData = {
          narrative: jsonPart.narrative || fullText.replace(jsonMatch[0], "").trim(),
          impact: jsonPart.impact || {},
          suggested_options: jsonPart.suggested_options || []
        };
      } catch (e) { }
    }

    state.game.history.push({ action: isFirstMove ? "START" : action, result: resultData, timestamp });
    if (state.game.history.length > state.historyLimit) state.game.history.shift();
    applyImpact(resultData.impact || {});
    renderQuickActions(resultData.suggested_options || []);
    saveToStorage();

  } catch (err) {
    contentEl.innerHTML = `系統異常：${err.message}`;
  } finally {
    setThinking(false);
  }
}

function setThinking(val) {
  state.isThinking = val;
  selectors.thinkingIndicator.classList.toggle('hidden', !val);
}

function buildPrompt(action) {
  const g = state.game;
  return `場景：${state.world.scenes[g.scene]?.title} | 描述：${state.world.scenes[g.scene]?.description}
玩家：HP ${g.player.hp}, SP ${g.player.sp}, 威脅 ${g.player.threat}, 能力 ${JSON.stringify(g.player.abilities)}
最近史：${JSON.stringify(g.history?.slice(-3) || [])}
玩家行動：${action}`;
}

function applyImpact(impact) {
  const p = state.game.player;
  if (!p.abilities) p.abilities = {};
  if (impact.hp) p.hp = Math.min(100, Math.max(0, p.hp + impact.hp));
  if (impact.sp) p.sp = Math.min(100, Math.max(0, p.sp + impact.sp));
  if (impact.threat) p.threat = Math.max(0, p.threat + impact.threat);
  if (impact.new_abilities) p.abilities = { ...p.abilities, ...impact.new_abilities };
  if (impact.update_abilities) {
    Object.entries(impact.update_abilities).forEach(([n, v]) => {
      if (p.abilities[n] !== undefined) p.abilities[n] = Math.min(100, Math.max(0, p.abilities[n] + v));
    });
  }
  if (impact.scene && state.world.scenes[impact.scene]) state.game.scene = impact.scene;
  render();
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
