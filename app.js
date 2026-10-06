// ========== 天衍九州 劇情引擎入口點 (Entry Point) ==========

async function init() {
  // 載入世界設定檔
  const data = await fetch('world.json?v=' + Date.now()).then((res) => res.json());
  window.state.allStories = data.stories;

  // 決定當前故事 ID
  let storyId = localStorage.getItem('tianyan_current_story_id');
  if (!storyId || !window.state.allStories[storyId]) {
    storyId = Object.keys(window.state.allStories)[0];
  }
  window.state.currentStoryId = storyId;

  // 載入當前選定故事的具體 JSON
  const storyMeta = window.state.allStories[storyId];
  if (!storyMeta) {
    console.error("No story meta found for storyId:", storyId);
    return;
  }
  const storyData = await fetch(storyMeta.file + '?v=' + Date.now()).then((res) => res.json());
  window.state.world = storyData;

  // 載入與初始化 AI 提示詞
  window.DIRECTOR_PROMPT = window.state.world.prompts.director;
  window.NARRATIVE_PROMPT = window.state.world.prompts.narrative;
  window.META_PROMPT = window.state.world.prompts.meta;

  // 載入 API Key 與 Proxy 設定
  const savedKey = localStorage.getItem(window.SETTINGS.STORAGE_KEYS.apiKey);
  if (savedKey) window.selectors.apiKey.value = savedKey;
  window.selectors.proxyToggle.checked = window.CONFIG.useProxy;

  // 載入已快取之模型清單或使用系統預設模型清單
  const savedModel = localStorage.getItem(window.SETTINGS.STORAGE_KEYS.selectedModel) || 'openai/gpt-oss-120b';
  const cachedModelsRaw = localStorage.getItem(window.SETTINGS.STORAGE_KEYS.cachedModels);
  let initialModels = window.SETTINGS.DEFAULT_MODELS;
  if (cachedModelsRaw) {
    try {
      const parsed = JSON.parse(cachedModelsRaw);
      if (Array.isArray(parsed) && parsed.length > 0) initialModels = parsed;
    } catch (e) {}
  }
  if (window.populateModelList) {
    window.populateModelList(initialModels, savedModel);
  }

  // 載入遊戲進度
  const saved = window.loadFromStorage();

  // 手機版預設收合狀態欄
  if (window.innerWidth <= window.SETTINGS.UI.mobileWidthPx) {
    window.selectors.sidebar.classList.add('collapsed');
    window.selectors.playerAction.placeholder = "輸入行動，改變因果...";
  }

  // 初始化狀態
  if (saved && saved.player?.has_selected_character && saved.player?.char_id) {
    window.state.game = saved;
    if (window.state.game.history.length === 0) {
      window.appendStory('系統：初始化完成。請在設置中輸入 API Key 並儲存以開始故事。', 'system');
    } else {
      window.state.game.history.forEach(entry => {
        if (entry.action) window.appendStory(entry.action, 'action', entry.timestamp);
        if (entry.result) window.appendStory(entry.result.narrative, entry.result.success !== false ? 'narrative' : 'system', entry.timestamp);
      });
    }
  } else {
    window.state.game = JSON.parse(JSON.stringify(window.state.world.startingState));
    if (window.stampSaveSchema) window.stampSaveSchema(window.state.game);
    window.state.game.player.has_selected_character = false;
    window.renderStoryWelcomeCard();
    window.lockActionInput('請先點選故事卡片按鈕或左側【魂穿化身】選定角色...');
  }

  window.render();
  setupEventListeners();
  window.setupCustomSelect();

  // 背景自動嘗試同步一次最新模型清單
  setTimeout(() => {
    window.syncModelsFromEndpoint(false);
  }, 800);
}

window.syncModelsFromEndpoint = async function(isManual = true) {
  const statusEl = document.getElementById('models-fetch-status');
  if (isManual && statusEl) {
    statusEl.textContent = '⏳ 正在查詢最新可用模型 (自動容錯)...';
    statusEl.className = 'models-fetch-status loading';
  }

  try {
    const models = await window.fetchDynamicModels();
    if (models && models.length > 0) {
      const currentModel = window.selectors.modelSelect?.value || localStorage.getItem(window.SETTINGS.STORAGE_KEYS.selectedModel) || models[0];
      window.populateModelList(models, currentModel);
      if (statusEl) {
        let endpointName = "代理端點";
        if (window.state.lastModelEndpoint) {
          if (window.state.lastModelEndpoint.includes('127.0.0.1') || window.state.lastModelEndpoint.includes('localhost')) {
            endpointName = "本地伺服器 127.0.0.1:4444";
          } else if (window.state.lastModelEndpoint.includes('workers.dev')) {
            endpointName = "遠端 Cloudflare 代理";
          } else if (window.state.lastModelEndpoint.includes('nvidia.com')) {
            endpointName = "NVIDIA 原廠直連";
          }
        }
        statusEl.textContent = `✅ 成功載入 ${models.length} 個即時端點模型（${endpointName}）`;
        statusEl.className = 'models-fetch-status success';
      }
    } else {
      if (isManual && statusEl) {
        statusEl.textContent = '⚠️ 端點回傳空清單，已載入系統預設推薦模型';
        statusEl.className = 'models-fetch-status error';
      }
    }
  } catch (err) {
    if (isManual && statusEl) {
      const is404 = String(err.message).includes('404');
      const isCors = String(err.message).includes('Failed to fetch') || String(err.message).includes('NetworkError');
      if (is404) {
        statusEl.textContent = '⚠️ 端點 404 (請確認 server.py 運行中)';
      } else if (isCors) {
        statusEl.textContent = '⚠️ CORS 阻擋 (請確認已啟動 python server.py 並勾選「隱匿蹤跡」)';
      } else {
        statusEl.textContent = `❌ 同步失敗: ${err.message}`;
      }
      statusEl.className = 'models-fetch-status error';
    }
  }
};

function setupEventListeners() {
  // 冥想設定按鈕 - 打開時若未拉取過模型，自動連線端點拉取
  const onOpenSettings = () => {
    window.selectors.settingsModal.classList.remove('hidden');
    // 如果目前模型選單只有少數預設項目或無快取，自動同步
    const currentOptionsCount = window.selectors.modelSelect?.options?.length || 0;
    if (currentOptionsCount <= 2) {
      window.syncModelsFromEndpoint(false);
    }
  };

  document.getElementById('btn-settings')?.addEventListener('click', onOpenSettings);
  document.getElementById('btn-settings-exp')?.addEventListener('click', onOpenSettings);
  document.getElementById('btn-settings-col')?.addEventListener('click', onOpenSettings);

  // 關閉魂穿選角彈窗
  window.selectors.btnCloseTransmigrate?.addEventListener('click', () => {
    window.selectors.transmigrateModal?.classList.add('hidden');
  });

  // 同步端點模型按鈕
  document.getElementById('btn-fetch-models')?.addEventListener('click', () => {
    window.syncModelsFromEndpoint(true);
  });
  
  // 儲存設定
  window.selectors.btnCloseSettings.addEventListener('click', async () => {
    const key = window.selectors.apiKey.value.trim();
    const model = window.selectors.modelSelect.value;
    window.CONFIG.useProxy = window.selectors.proxyToggle.checked;
    localStorage.setItem(window.SETTINGS.STORAGE_KEYS.apiKey, key);
    if (model) {
      localStorage.setItem(window.SETTINGS.STORAGE_KEYS.selectedModel, model);
    }
    
    window.selectors.settingsModal.classList.add('hidden');

    // 若尚未選定角色，彈出選角視窗
    if (!window.state.game?.player?.has_selected_character || !window.state.game?.player?.char_id) {
      window.openTransmigrationModal(true);
    } else if (key && window.state.game.history.length === 0) {
      window.handleAction(null, true);
    }
  });

  // 側邊欄收合按鈕 (手機版)
  window.selectors.btnToggleSidebar.addEventListener('click', (e) => {
    e.stopPropagation();
    window.selectors.sidebar.classList.toggle('collapsed');
  });

  // 點擊外部區域收合側邊欄 (手機版)
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= window.SETTINGS.UI.mobileWidthPx && !window.selectors.sidebar.classList.contains('collapsed')) {
      if (!window.selectors.sidebar.contains(e.target) && !e.target.closest('.modal')) {
        window.selectors.sidebar.classList.add('collapsed');
      }
    }
  });

  // 關閉讀檔/存檔彈窗
  window.selectors.btnCloseSave.addEventListener('click', () => window.selectors.saveModal.classList.add('hidden'));

  // 點擊彈窗外部關閉彈窗
  [window.selectors.settingsModal, window.selectors.saveModal].forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  });

  // 點擊頁面其他地方關閉收合的操作選單 (手機版)
  document.addEventListener('click', (e) => {
    const activeActions = document.querySelector('.collapsed-actions.active');
    if (activeActions && !activeActions.contains(e.target) && !e.target.closest('#mobile-orb') && !e.target.closest('.modal')) {
      activeActions.classList.remove('active');
    }
  });

  // 執行存檔/讀檔確認
  window.selectors.btnConfirmSave.addEventListener('click', () => {
    if (window.state.currentSaveMode === 'export') {
      window.selectors.saveCode.select();
      document.execCommand('copy');
      alert('已複製到剪貼簿');
      window.selectors.saveModal.classList.add('hidden');
    } else {
      window.importSave();
    }
  });

  // 行動輸入框提交
  window.selectors.actionForm.addEventListener('submit', window.handleAction);
  
  // Enter 鍵提交行動，Shift+Enter 換行
  window.selectors.playerAction.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      window.selectors.actionForm.dispatchEvent(new Event('submit'));
    }
  });

  // Tab 鍵循環選擇快捷動作
  window.selectors.playerAction.addEventListener('keydown', (e) => {
    const btns = window.selectors.quickActions.querySelectorAll('.quick-btn');
    if (btns.length === 0) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      window.state.quickActionIndex = (window.state.quickActionIndex + 1) % btns.length;
      window.updateQuickActionSelection(btns);
    } else if (e.key === 'ArrowDown' && window.state.quickActionIndex === -1) {
      e.preventDefault();
      window.state.quickActionIndex = 0;
      window.updateQuickActionSelection(btns);
    } else if (e.key === 'Escape') {
      window.state.quickActionIndex = -1;
      window.updateQuickActionSelection(btns);
    } else if (e.key !== 'Enter') {
      window.state.quickActionIndex = -1;
      btns.forEach(b => b.classList.remove('selected'));
    }
  });
}

// 啟動初始化，將 marked 設為段落換行
if (window.marked?.setOptions) {
  window.marked.setOptions({ breaks: true });
}

init().catch(console.error);
