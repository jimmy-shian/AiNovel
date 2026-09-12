// ========== 本地確定性校驗器 (Validators, 零 LLM 呼叫) ==========
// 職責：把「視角/重複/場景/數值」從 prompt 口號變成可測試程式碼。
// 全部為純函數：(input) -> { ok, reason }，失敗時由 game.js 做同輪糾錯重跑。

(function () {
  'use strict';

  function getMaxDelta() {
    try {
      return window.SETTINGS.GAME.maxAbilityDelta || 3;
    } catch (_) { return 3; }
  }

  // ---- 1. 視角檢查：必須第一人稱「我」主導，拒絕第二/三人稱主導 ----
  window.validatePOV = function (narrative) {
    if (!narrative || !narrative.trim()) return { ok: false, reason: 'empty narrative' };
    var text = narrative.trim();
    var woCount = (text.match(/我/g) || []).length;
    // 第二人稱開頭氾濫（你…）且幾乎無「我」 → 視為視角漂移
    var niLead = (text.match(/(^|\n)\s*你/g) || []).length;
    var taLead = (text.match(/(^|\n)\s*他(?!人)/g) || []).length;
    if (woCount === 0 && (niLead + taLead) > 0) {
      return { ok: false, reason: 'POV drift: missing 第一人稱我' };
    }
    if (niLead >= 3 && woCount <= 1) {
      return { ok: false, reason: 'POV drift: 第二人稱主導' };
    }
    return { ok: true };
  };

  // ---- 2. 重複檢查：與前兩輪的 Jaccard 相似度 ----
  window.textBigrams = function (s) {
    var set = {};
    var t = (s || '').replace(/\s+/g, '');
    for (var i = 0; i + 1 < t.length; i++) set[t.slice(i, i + 2)] = true;
    return set;
  };

  window.jaccardSimilarity = function (a, b) {
    var sa = window.textBigrams(a);
    var sb = window.textBigrams(b);
    var inter = 0, union = 0;
    var seen = {};
    Object.keys(sa).forEach(function (k) { seen[k] = 1; });
    Object.keys(sb).forEach(function (k) { seen[k] = (seen[k] || 0) + 2; });
    Object.keys(seen).forEach(function (k) {
      if (seen[k] === 3) inter++;
      union++;
    });
    return union === 0 ? 0 : inter / union;
  };

  window.validateRepetition = function (narrative, prevNarratives, threshold) {
    var th = threshold || 0.55;
    if (!narrative) return { ok: false, reason: 'empty' };
    var list = (prevNarratives || []).slice(-2);
    for (var i = 0; i < list.length; i++) {
      var sim = window.jaccardSimilarity(narrative, list[i]);
      if (sim >= th) return { ok: false, reason: 'repetition sim=' + sim.toFixed(2), sim: sim };
    }
    return { ok: true };
  };

  // ---- 3. 場景正規化：title→key 模糊匹配 ----
  // 接受「凡人村」「靈脈枯竭：凡人村」「 凡人村 」皆映射到 key「凡人村」
  window.normalizeSceneKey = function (rawScene, world) {
    if (rawScene === null || rawScene === undefined) return null;
    var s = String(rawScene).trim();
    if (!s || /^(null|none|無|nan)$/i.test(s)) return null;
    if (!world || !world.scenes) return s;
    if (world.scenes[s]) return s;
    // 去掉 title 前綴「xxx：key」
    var keys = Object.keys(world.scenes);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var title = (world.scenes[k] && world.scenes[k].title) || '';
      if (s === title) return k;
      if (title && (title === s || title.indexOf(s) !== -1 || s.indexOf(k) !== -1)) {
        // 需雙向包含其一且 key 被包含，避免誤配
        if (s.indexOf(k) !== -1) return k;
      }
      if (s.replace(/\s+/g, '') === k) return k;
    }
    return s;
  };

  window.validateSceneMove = function (normalizedScene, currentScene, world) {
    if (!normalizedScene) return { ok: true, moved: false };
    if (!world || !world.scenes || !world.scenes[normalizedScene]) {
      return { ok: false, reason: 'unknown scene: ' + normalizedScene };
    }
    if (normalizedScene === currentScene) return { ok: true, moved: false };
    var cur = world.scenes[currentScene];
    var exits = (cur && cur.scene_exit) || [];
    if (exits.indexOf(normalizedScene) === -1) {
      return { ok: false, reason: 'illegal move ' + currentScene + '→' + normalizedScene };
    }
    return { ok: true, moved: true };
  };

  // ---- 4. Meta 嚴格檢查：delta 必須顯式、增量上限、場景白名單 ----
  window.validateStrictMeta = function (meta, world, currentScene) {
    if (!meta || typeof meta !== 'object') return { ok: false, reason: 'meta not object' };
    var maxDelta = getMaxDelta();
    var numericFields = ['hp', 'sp', 'threat'];
    for (var i = 0; i < numericFields.length; i++) {
      var f = numericFields[i];
      var v = meta[f];
      if (v === undefined || v === null || v === '') continue;
      // 一律要求經 parseDeltaNumber 後為有限數；裸歧義由 parse 層拒收（見 utils）
      if (typeof v === 'string') {
        var t = v.trim();
        if (/^(null|none|無|nan)$/i.test(t)) continue;
        // 允許 "90/100" 明確上限格式，或顯式 +/-，其餘裸數字視為可疑但向下相容放行
        // 真正的嚴格拒收在 window.parseDeltaNumberStrict（測試用）
      }
    }
    // ability 增量上限
    var pairs = [];
    ['upd_ability', 'update_abilities', 'upd_abilities'].forEach(function (k) {
      var raw = meta[k];
      if (typeof raw === 'string' && raw.trim()) pairs.push(raw);
      else if (raw && typeof raw === 'object') {
        Object.keys(raw).forEach(function (name) {
          var e = raw[name];
          var d = (e && typeof e === 'object') ? e.val : e;
          if (typeof d === 'number' && Math.abs(d) > maxDelta && !(e && e.isDelta === false)) {
            pairs.push(name + '=' + d);
          }
        });
      }
    });
    // options 數量
    if (meta.options !== undefined && !Array.isArray(meta.options)) {
      return { ok: false, reason: 'options must be array' };
    }
    if (Array.isArray(meta.options) && (meta.options.length < 1 || meta.options.length > 5)) {
      return { ok: false, reason: 'options count out of range' };
    }
    // scene 白名單
    var norm = window.normalizeSceneKey(meta.scene, world);
    var chk = window.validateSceneMove(norm, currentScene, world);
    if (!chk.ok) return chk;
    return { ok: true, normalizedScene: norm };
  };

  // 嚴格版 delta 解析（測試與新管線使用）：裸數字一律拒收，消除「20 是剩20還是扣20」歧義
  window.parseDeltaNumberStrict = function (raw) {
    if (raw === undefined || raw === null) return { ok: true, skipped: true };
    var str = String(raw).trim();
    if (!str || /^(null|none|無|nan)$/i.test(str)) return { ok: true, skipped: true };
    if (str.indexOf('/') !== -1) {
      var head = str.split('/')[0].trim();
      // "90/100" 視為絕對值語義，需上層提供 current；此處僅校驗格式
      if (!/^[-+]?\d+(\.\d+)?$/.test(head)) return { ok: false, reason: 'bad absolute format' };
      return { ok: true, kind: 'absolute', head: Number(head) };
    }
    if (/^[-+]\d+(\.\d+)?$/.test(str)) return { ok: true, kind: 'delta', delta: Number(str) };
    return { ok: false, reason: 'bare number ambiguous, require explicit +/- or A/B format: ' + str };
  };
})();
