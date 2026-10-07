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
    // 5-3: 剔除氣泡/引號內對話後再計算第一與第二人稱
    var pureNarration = text.replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/g, ' ');
    var woCount = (pureNarration.match(/我/g) || []).length;
    var niLead = (pureNarration.match(/(^|\n)\s*你/g) || []).length;
    var taLead = (pureNarration.match(/(^|\n)\s*他(?!人)/g) || []).length;
    if (woCount === 0 && (niLead + taLead) > 0) {
      return { ok: false, reason: 'POV drift: missing 第一人稱我' };
    }
    // 5-3: 你開頭>=2 即打回（嚴格防止第二人稱漂移）
    if (niLead >= 2) {
      return { ok: false, reason: 'POV drift: 第二人稱主導 (你開頭>=2)' };
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
  // 5-2: 僅允許 title===s 或 title去掉前綴===s，刪子字串匹配，防止誤配導致非法瞬移
  window.normalizeSceneKey = function (rawScene, world) {
    if (rawScene === null || rawScene === undefined) return null;
    var s = String(rawScene).trim();
    if (!s || /^(null|none|無|nan)$/i.test(s)) return null;
    if (!world || !world.scenes) return s;
    if (world.scenes[s]) return s;
    // 去掉 title 前綴「xxx：key」精確對齊
    var keys = Object.keys(world.scenes);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var title = (world.scenes[k] && world.scenes[k].title) || '';
      if (s === title) return k;
      if (title) {
        var cleanTitle = title.replace(/^.+?[：:]\s*/, '').trim();
        if (cleanTitle && cleanTitle === s) return k;
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
    // 5-1: 數值欄位一律調用 parseDeltaNumberStrict，裸數字直接打回
    var numericFields = ['hp', 'sp', 'threat'];
    for (var i = 0; i < numericFields.length; i++) {
      var f = numericFields[i];
      var v = meta[f];
      if (v === undefined || v === null || v === '') continue;
      var chkNum = window.parseDeltaNumberStrict(v);
      if (!chkNum.ok) {
        return { ok: false, reason: f + ' 格式不合規: ' + chkNum.reason };
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
    // 5-5: options 數量（統一為 3-4 個；排除「繼續敘事」後計入）
    var opts = meta.options !== undefined ? meta.options : meta.suggested_options;
    if (opts !== undefined && !Array.isArray(opts)) {
      return { ok: false, reason: 'options must be array' };
    }
    if (Array.isArray(opts)) {
      var filteredOpts = opts.filter(function (o) { return !/^繼續敘事/i.test(String(o).trim()); });
      if (filteredOpts.length < 3 || filteredOpts.length > 4) {
        return { ok: false, reason: 'options count out of range (expected 3-4, got ' + filteredOpts.length + ')' };
      }
    }
    // scene 白名單（新版相容 player_scene 別名；normalize 後多為 scene）
    var sceneRaw = (meta.scene !== undefined && meta.scene !== null) ? meta.scene : meta.player_scene;
    var norm = window.normalizeSceneKey(sceneRaw, world);
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

  // ---- 5. 結局評估：條件結局（天眼/悟性/威脅/造訪）命中即收束 ----
  // 條件語法：「名 >= 40 && 名 < 30 && visited('場景名')」；default 結局不自動觸發
  // visited 同時比對場景key與場景title（visitedScenes 存 key，條件多寫 title）
  window.checkStoryEnding = function (game, world) {
    if (!game || !world || !world.endings) return null;
    var p = game.player || {};
    var ab = p.abilities || {};
    var statVal = function (name) {
      var n = String(name).trim();
      if (n === 'threat' || n === '業力' || n === '威脅' || n === '天劫預兆') return Number(p.threat) || 0;
      if (n === 'hp' || n === 'HP' || n === '氣血' || n === '生命' || n === '生機') return Number(p.hp) || 0;
      if (n === 'sp' || n === 'SP' || n === '靈力' || n === '靈息') return Number(p.sp) || 0;
      var v = ab[n];
      return (v && typeof v === 'object') ? (Number(v.val) || 0) : (Number(v) || 0);
    };
    // 旗標查詢：game.story_flags（Meta 寫入）優先，其次 game.flags（劇本初始旗標）
    var flagVal = function (name) {
      var n = String(name).trim();
      if (!n) return undefined;
      if (game.story_flags && game.story_flags[n] !== undefined) return game.story_flags[n];
      if (game.flags && game.flags[n] !== undefined) return game.flags[n];
      return undefined;
    };
    var isTruthyFlag = function (v) {
      return v === true || v === 1 || v === 'true' || v === '1';
    };
    var visited = function (name) {
      var list = game.visitedScenes || [];
      var scenes = world.scenes || {};
      return list.some(function (k) {
        if (k === name) return true;
        var sc = scenes[k];
        return !!sc && (sc.title === name || String(k).indexOf(name) !== -1);
      });
    };
    var evalClause = function (clause) {
      var c = String(clause).trim();
      if (!c) return true;
      if (/^default$/i.test(c)) return true;
      var vm = c.match(/^visited\(\s*['"](.+?)['"]\s*\)$/);
      if (vm) return visited(vm[1]);
      // 布林旗標：name == false / name != true（結局如 chainWeakened == false）
      // 未設定的布林旗標視為 false（劇本初始 flags 多為空，「未削弱鐵鎖」即 == false），
      // 否則玩家不經 LLM 明示回填就永遠進不了陷阱結局。
      var fm = c.match(/^(.+?)\s*(==|!=)\s*(true|false)\s*$/i);
      if (fm) {
        var fv = flagVal(fm[1]);
        var want = /^true$/i.test(fm[3]);
        var got = fv === undefined ? false : isTruthyFlag(fv);
        return fm[2] === '==' ? got === want : got !== want;
      }
      // 裸旗標：acceptedHeavenSeal 或 !flag
      if (/^[!～~]/.test(c)) {
        var bv = flagVal(c.replace(/^[!～~]\s*/, ''));
        if (bv === undefined) return false;
        return !isTruthyFlag(bv);
      }
      // 支援中英文裸旗標名稱，如 acceptedHeavenSeal 或 有犧牲flag
      if (/^[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]*$/.test(c)) {
        var bv2 = flagVal(c);
        if (bv2 === undefined) return false;
        return isTruthyFlag(bv2);
      }
      var cm = c.match(/^(.+?)\s*(>=|<=|==|>|<)\s*(-?\d+(?:\.\d+)?)$/);
      if (cm) {
        var name = cm[1].trim();
        var target = Number(cm[3]);
        var op = cm[2];
        // 內建數值 / 能力優先；其餘名稱若為旗標（如 heaven_alert >= 5）則取旗標值
        var val;
        if (ab[name] !== undefined || /^(threat|業力|威脅|天劫預兆|hp|HP|氣血|生命|生機|sp|SP|靈力|靈息)$/.test(name)) {
          val = statVal(name);
        } else {
          var f = flagVal(name);
          val = (f === undefined || f === null || typeof f === 'object') ? 0 : (Number(f) || 0);
        }
        if (op === '>=') return val >= target;
        if (op === '<=') return val <= target;
        if (op === '>') return val > target;
        if (op === '<') return val < target;
        return val === target;
      }
      return false;
    };
    var evalCond = function (cond) {
      if (cond === undefined || cond === null) return false;
      return String(cond).split('||').some(function (orPart) {
        return orPart.split('&&').every(evalClause);
      });
    };
    var keys = Object.keys(world.endings);
    var defaultEnding = null;
    for (var i = 0; i < keys.length; i++) {
      var e = world.endings[keys[i]];
      var cond = (e && e.condition) || '';
      if (/^default$/i.test(String(cond).trim())) {
        defaultEnding = { id: keys[i], condition: cond, result: (e && e.result) || '' };
        continue;
      }
      if (!cond) continue;
      if (evalCond(cond)) return { id: keys[i], condition: cond, result: (e && e.result) || '' };
    }
    // 3-4: 檢查 countdown <= 0 且無其他結局命中時觸發 defaultEnding
    var countdown = game && game.current_arc && game.current_arc.countdown;
    if (typeof countdown === 'number' && countdown <= 0 && defaultEnding) {
      return defaultEnding;
    }
    return null;
  };
})();
