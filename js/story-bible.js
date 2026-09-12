// ========== 故事聖經：Canonical State 唯一真相 (Story Bible) ==========
// 職責：集中保管場景/旗標/弧線/記憶摘要，終結三段管線各說各話。
// 設計：純函數 + 顯式依賴，無 DOM、無 fetch，可單元測試。
// 存檔 schema v2：舊檔視為失效（使用者已確認可斷代），由 game.js 攔截提示重開。

(function () {
  'use strict';

  var RECENT_DEFAULT = 3;
  var SUMMARY_DEFAULT = 1200;

  function getRecentCount() {
    try {
      return window.SETTINGS.GAME.recentFullCount || RECENT_DEFAULT;
    } catch (_) { return RECENT_DEFAULT; }
  }

  function getSummaryMax() {
    try {
      return window.SETTINGS.GAME.summaryMaxChars || SUMMARY_DEFAULT;
    } catch (_) { return SUMMARY_DEFAULT; }
  }

  // 從完整 history 切出「近 N 全文 + 更早摘要」
  // 回傳 { recent: [...], older: [...], summary: string }
  window.splitHistoryMemory = function (history) {
    var list = Array.isArray(history) ? history : [];
    var n = getRecentCount();
    var recent = list.slice(-n);
    var older = list.length > n ? list.slice(0, list.length - n) : [];
    return { recent: recent, older: older, summary: window.summarizeOlderHistory(older) };
  };

  // 本地確定性摘要：不呼叫 LLM，零延遲。只保留因果骨架，避免 token 膨脹。
  window.summarizeOlderHistory = function (olderEntries) {
    var max = getSummaryMax();
    if (!olderEntries || olderEntries.length === 0) return '';
    var lines = olderEntries.map(function (h, idx) {
      var act = (h.action === 'START' ? '開局' : (h.action || '')).toString().slice(0, 60);
      var nar = ((h.result && h.result.narrative) || '').toString()
        .replace(/\s+/g, ' ')
        .slice(0, 120);
      var scene = (h.result && h.result.sceneAfter) ? ('@' + h.result.sceneAfter) : '';
      return ((idx + 1) + '. ' + act + ' → ' + nar + scene);
    });
    var out = '【更早劇情摘要】\n' + lines.join('\n');
    if (out.length > max) out = out.slice(0, max) + '…';
    return out;
  };

  // 渲染給 prompt 的記憶塊：摘要 + 近 N 全文（截斷單輪長度防爆）
  window.renderMemoryBlock = function (history) {
    var parts = window.splitHistoryMemory(history);
    var buf = '';
    if (parts.summary) buf += parts.summary + '\n\n';
    if (parts.recent.length > 0) {
      buf += '【最近劇情（全文）】';
      parts.recent.forEach(function (h, i) {
        var act = h.action || '（開局）';
        var nar = (h.result && h.result.narrative) || '';
        if (nar.length > 800) nar = nar.slice(0, 800) + '…';
        buf += '\n第' + (i + 1) + '輪 - 玩家：' + act + '\n世界反饋：' + nar;
      });
    } else {
      buf += '（尚無歷史，本輪為開局）';
    }
    return buf;
  };

  // 旗標帳本：合併新 flags，回傳是否含關鍵變更
  window.mergeStoryFlags = function (game, nextFlags) {
    if (!game) return {};
    if (!game.story_flags) game.story_flags = {};
    if (!nextFlags || typeof nextFlags !== 'object') return game.story_flags;
    Object.keys(nextFlags).forEach(function (k) {
      game.story_flags[k] = nextFlags[k];
    });
    return game.story_flags;
  };

  // 弧線倒數：current_arc.countdown 若為字串則保留顯示；若為數字則扣 1
  // 不再讓 countdown 永久凍結，但也不做強制結局觸發（由故事設定驅動）。
  window.tickArcCountdown = function (game) {
    if (!game || !game.current_arc) return;
    var cd = game.current_arc.countdown;
    if (typeof cd === 'number' && cd > 0) game.current_arc.countdown = cd - 1;
  };

  // 造訪登記：回傳是否為首次到訪（供天眼進度等顯式獎勵使用，禁止隱性偷加）
  window.registerSceneVisit = function (game, sceneKey) {
    if (!game || !sceneKey) return false;
    if (!Array.isArray(game.visitedScenes)) game.visitedScenes = [];
    if (game.visitedScenes.indexOf(sceneKey) === -1) {
      game.visitedScenes.push(sceneKey);
      return true;
    }
    return false;
  };

  // 存檔版本守衛：v2 以下視為失效
  window.isSaveCompatible = function (save) {
    if (!save || typeof save !== 'object') return false;
    return save.schema === window.SETTINGS.SAVE_SCHEMA;
  };

  window.stampSaveSchema = function (game) {
    if (game && typeof game === 'object') game.schema = window.SETTINGS.SAVE_SCHEMA;
    return game;
  };
})();
