// ========== 全域參數與設定（集中管理） ==========
window.SETTINGS = {
  VERSION: "v1.4.1",

  STORAGE_KEYS: {
    apiKey: 'tianyan_api_key',
    useProxy: 'tianyan_use_proxy',
    gameSave: 'tianyan_game_save',
    selectedModel: 'tianyan_selected_model',
    cachedModels: 'tianyan_cached_models',
  },

  ENDPOINTS: {
    localProxy: 'http://127.0.0.1:4444/v1/chat/completions',
    remoteProxy: 'https://restless-hat-8ef5.jimmy910824.workers.dev/v1/chat/completions',
    direct: 'https://integrate.api.nvidia.com/v1/chat/completions',
    localModels: 'http://127.0.0.1:4444/v1/models',
    remoteModels: 'https://restless-hat-8ef5.jimmy910824.workers.dev/v1/models',
    directModels: 'https://integrate.api.nvidia.com/v1/models',
  },

  DEFAULT_MODELS: [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "deepseek-ai/deepseek-r1",
    "deepseek-ai/deepseek-v3",
    "qwen/qwen3.5-122b-a10b",
    "meta/llama-3.3-70b-instruct",
    "meta/llama-3.1-405b-instruct",
    "meta/llama-3.1-70b-instruct",
    "nvidia/nemotron-4-340b-instruct",
    "mistralai/mistral-large-2-instruct",
  ],

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

// 執行期設定 (以 getters 動態獲取)
window.CONFIG = {
  get isLocal() {
    return window.location.hostname === 'localhost' ||
           window.location.hostname === '127.0.0.1' ||
           window.location.protocol === 'file:';
  },
  get useProxy() {
    const saved = localStorage.getItem(window.SETTINGS.STORAGE_KEYS.useProxy);
    // 預設為 true (因為瀏覽器端直連 NVIDIA API 必遭 CORS 阻擋)
    return saved !== null ? saved === 'true' : true;
  },
  set useProxy(val) {
    localStorage.setItem(window.SETTINGS.STORAGE_KEYS.useProxy, val ? 'true' : 'false');
  },
  get proxyUrl() {
    return this.isLocal
      ? window.SETTINGS.ENDPOINTS.localProxy
      : window.SETTINGS.ENDPOINTS.remoteProxy;
  },
  get modelsUrl() {
    if (this.useProxy) {
      return this.isLocal ? window.SETTINGS.ENDPOINTS.localModels : window.SETTINGS.ENDPOINTS.remoteModels;
    }
    return window.SETTINGS.ENDPOINTS.directModels;
  },
  get directUrl() {
    return window.SETTINGS.ENDPOINTS.direct;
  },
  get candidateModelUrls() {
    const urls = [this.modelsUrl];
    if (this.isLocal) {
      if (!urls.includes(window.SETTINGS.ENDPOINTS.localModels)) urls.push(window.SETTINGS.ENDPOINTS.localModels);
      if (!urls.includes(window.SETTINGS.ENDPOINTS.remoteModels)) urls.push(window.SETTINGS.ENDPOINTS.remoteModels);
    } else {
      if (!urls.includes(window.SETTINGS.ENDPOINTS.remoteModels)) urls.push(window.SETTINGS.ENDPOINTS.remoteModels);
      if (!urls.includes(window.SETTINGS.ENDPOINTS.localModels)) urls.push(window.SETTINGS.ENDPOINTS.localModels);
    }
    if (!urls.includes(window.SETTINGS.ENDPOINTS.directModels)) urls.push(window.SETTINGS.ENDPOINTS.directModels);
    return urls;
  },
  get candidateProxyUrls() {
    const urls = [this.proxyUrl];
    if (this.isLocal) {
      if (!urls.includes(window.SETTINGS.ENDPOINTS.localProxy)) urls.push(window.SETTINGS.ENDPOINTS.localProxy);
      if (!urls.includes(window.SETTINGS.ENDPOINTS.remoteProxy)) urls.push(window.SETTINGS.ENDPOINTS.remoteProxy);
    } else {
      if (!urls.includes(window.SETTINGS.ENDPOINTS.remoteProxy)) urls.push(window.SETTINGS.ENDPOINTS.remoteProxy);
      if (!urls.includes(window.SETTINGS.ENDPOINTS.localProxy)) urls.push(window.SETTINGS.ENDPOINTS.localProxy);
    }
    return urls;
  }
};

// 全域狀態
window.state = {
  world: null,
  game: null,
  allStories: null,
  currentStoryId: "",
  historyLimit: window.SETTINGS.GAME.historyLimit,
  isThinking: false,
  currentTypewriter: null,
  quickActionIndex: -1,
  lastStats: {},
  thinkingEntry: null,
  currentSaveMode: 'export'
};

// DOM 快取 (使用 getters 確保在載入時若 DOM 未就緒，使用時仍能動態獲取)
window.selectors = {
  get storyLog() { return document.getElementById('story-log'); },
  get quickActions() { return document.getElementById('quick-actions'); },
  get playerAction() { return document.getElementById('player-action'); },
  get actionForm() { return document.getElementById('action-form'); },
  get sceneTitle() { return document.getElementById('scene-title'); },
  get settingsModal() { return document.getElementById('settings-modal'); },
  get apiKey() { return document.getElementById('api-key'); },
  get modelSelect() { return document.getElementById('model-select'); },
  get proxyToggle() { return document.getElementById('proxy-toggle'); },
  get saveModal() { return document.getElementById('save-modal'); },
  get saveModalTitle() { return document.getElementById('save-modal-title'); },
  get saveCode() { return document.getElementById('save-code'); },
  get btnConfirmSave() { return document.getElementById('confirm-save-action'); },
  get btnCloseSave() { return document.getElementById('close-save-modal'); },
  get btnCloseSettings() { return document.getElementById('close-settings'); },
  get sidebar() { return document.getElementById('sidebar'); },
  get sidebarContent() { return document.getElementById('sidebar-content'); },
  get sidebarExpanded() { return document.getElementById('sidebar-expanded'); },
  get sidebarCollapsed() { return document.getElementById('sidebar-collapsed'); },
  get btnToggleSidebar() { return document.getElementById('toggle-sidebar'); },
  get modelSelectContainer() { return document.getElementById('model-select-container'); },
  get modelSelectTrigger() { return document.getElementById('model-select-trigger'); },
  get modelSelectOptions() { return document.getElementById('model-select-options'); },
  get modelSelectedValue() { return document.querySelector('#model-select-trigger .selected-value'); },
  get storySelectContainer() { return document.getElementById('story-select-container'); },
  get storySelectTrigger() { return document.getElementById('story-select-trigger'); },
  get storySelectOptions() { return document.getElementById('story-select-options'); },
  get storySelect() { return document.getElementById('story-select'); }
};

// 提示詞與暫存變數
window.DIRECTOR_PROMPT = "";
window.NARRATIVE_PROMPT = "";
window.META_PROMPT = "";
window.orbInterval = null;
