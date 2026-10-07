// ========== 輔助與工具方法 (Utils) ==========

window.cleanText = function(text) {
  if (!text) return "";
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
};

/**
 * 敘事格式化處理 (群聊式多人對話渲染)
 * 支援新契約『角色名：「對話」』獨立行 + 舊式 名字說道：「對話」，
 * 每位發言者渲染為獨立群聊氣泡 (頭像首字 + 名字 + 內容)，說話人色彩由名字雜湊分配。
 */
window.speakerHue = function(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

window.escapeHtml = function(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// 說話動詞（附於角色名尾部的動作描寫），用於還原純淨說話者名稱
const SPEECH_VERB_TAIL = /(?:冷笑道|沉聲道|低聲道|高聲道|微笑道|緩緩道|淡淡道|朗聲道|喃喃道|怒道|嘆道|問道|答道|續道|又道|急道|獰笑道|慘笑道|笑道|說道|說著|續問|又問|冷笑|嗤笑|輕笑|慘笑|獰笑|微笑|冷哼|怒喝|怒斥|驚呼|喃喃|低語|自語|沉聲|低聲|高聲|疾聲|失聲|斷然|嘆息|搖頭|回頭|喘息|道|說)$/;

// 欄位標籤（非角色名）：這些「XX：『…』」是狀態/提示，不應渲染成氣泡
const SPEAKER_STOPLIST = new Set([
  '狀態', '旁白', '提示', '標題', '時間', '地點', '系統', '註解', '備註', '說明',
  '內容', '結果', '選項', '目標', '描述', '標註', '註', '背景', '氣氛', '氛圍',
  '開場', '結語', '視角', '風格', '數值', '能力', '能力值', '警告', '備忘', '摘要',
]);

// 純說話動詞（本身不能當說話者名稱）
const SPEAKER_PURE_VERB = /^(?:說道|說|道|問|答|笑|喊|吼|叫|嘆|冷笑|嗤笑|微笑|喃喃|自語|低語|沉聲|低聲|高聲|疾聲|怒喝|怒斥|驚呼|嘆息|緩緩|淡淡|續道|又道|續問|又問)$/;

// 敘事連接詞/副詞（「老者嘆息，隨即道：「…」」的「隨即」不是說話者）
const SPEAKER_NON_NAME = /^(?:隨即|於是|接著|然後|這時|此時|此刻|突然|驀地|驀然|霎時|頓時|當下|旋即|繼而|同時|最後|首先|其次|方才|適才|霎那|頃刻|隨後|繼而|然後|便|卻|乃|亦|復)$/;

/**
 * 還原純淨說話者名稱。
 * 回傳 '' 代表此片段不是角色名（敘事/欄位標籤），呼叫端應保留原文。
 */
window.cleanSpeakerName = function(raw) {
  let sp = String(raw || '').trim().replace(/^[「『'"\s]+|[」』'"\s]+$/g, '');
  if (!sp || sp.length > 16) return '';

  // 先摘掉尾部說話動詞：「老毒物冷笑」→「老毒物」
  const stripped = sp.replace(SPEECH_VERB_TAIL, '');
  // 摘除後剩代名詞 → 原字串是「他說」「我問」這類敘事片段
  if (/^[我你他她它們]$/.test(stripped)) return stripped === '我' ? '我' : '';
  if (stripped.length >= 2) sp = stripped;

  if (SPEAKER_STOPLIST.has(sp)) return '';
  if (SPEAKER_PURE_VERB.test(sp)) return '';
  if (SPEAKER_NON_NAME.test(sp)) return '';
  // ≥3 字仍含代名詞/指示詞 → 敘事片段（如「他轉頭」「我點點頭」「那人冷笑」）
  if (sp.length >= 3 && /[我你他她它們的了著這那]/.test(sp)) return '';
  return sp;
};

/**
 * 產生單一發言者的群聊氣泡
 */
window.buildChatBubble = function(sp, dialogContent) {
  const hue = window.speakerHue(sp);
  const name = window.escapeHtml(sp);
  const body = window.escapeHtml(String(dialogContent).trim()).replace(/\n/g, '<br>');
  return `<div class="chat-msg" data-speaker="${name}" style="--sp-hue:${hue}"><div class="chat-avatar" aria-hidden="true">${window.escapeHtml(sp.slice(0, 1))}</div><div class="chat-bubble"><div class="chat-name">${name}</div><div class="chat-text">${body}</div></div></div>`;
};

// 對話偵測：『角色名（+說話動詞）：「對話」』
// - 內文用 lazy，遇到第一個右引號即停 → 多句對話（內含句號）完整保留
// - 內文允許跨行 → 對話被 LLM 換行也不會斷
// - 這段必須在「句號分段」之前執行，否則多句對話會被切碎而失去氣泡
// - 前驅字元不併入 match（前驅若吃掉前一句的右引號，緊接的第二句就永遠配不到）
const DIALOGUE_REGEX = /[ \t]*(?:[-*•]\s*|\d+[.、]\s*)?([^\s：:「」『』，。！？]{1,16})[：:][ \t]*[「『]([^」』]+?)[」』]/g;
const DIALOGUE_PREFIX = '\n。；;！？，,『』」';

/**
 * 由「說話者原文」解析出群聊顯示名稱；失敗回傳 ''（保留原文為敘事）。
 */
window.resolveDialogueSpeaker = function(raw) {
  let sp = window.cleanSpeakerName(raw);
  if (!sp) {
    // 「我點點頭：「…」」「我心中一凜：「…」」→ 發話者即宿主本人
    const s = String(raw || '').trim();
    if (s.length <= 8 && s.charAt(0) === '我') sp = '我';
  }
  return sp;
};

/**
 * 敘事格式化處理 (群聊式多人對話渲染)
 * 流程：1) 抽出所有對話轉成氣泡佔位 2) 句號分段排版 3) 還原氣泡
 */
window.formatNarrative = function(text) {
  if (!text) return "";
  const cleaned = window.cleanText(text);
  const bubbles = [];
  const stash = (html) => {
    bubbles.push(html);
    return `\n\n\u0000${bubbles.length - 1}\u0000\n\n`;
  };

  // 1. 對話先抽出（契約獨立行 + 舊式行內）
  let extracted = '';
  let cursor = 0;
  DIALOGUE_REGEX.lastIndex = 0;
  let m;
  while ((m = DIALOGUE_REGEX.exec(cleaned)) !== null) {
    const idx = m.index;
    // 前驅字元（略過行首空白）必須是行首或分隔符，避免中途硬切出假對話
    let p = idx - 1;
    while (p >= 0 && (cleaned.charAt(p) === ' ' || cleaned.charAt(p) === '\t')) p--;
    const prev = p < 0 ? '' : cleaned.charAt(p);
    const prefixOk = p < 0 || DIALOGUE_PREFIX.indexOf(prev) !== -1;
    const sp = prefixOk ? window.resolveDialogueSpeaker(m[1]) : '';
    const dc = String(m[2] || '').trim();
    if (!sp || !dc) continue;
    extracted += cleaned.slice(cursor, idx) + stash(window.buildChatBubble(sp, dc));
    cursor = idx + m[0].length;
  }
  extracted += cleaned.slice(cursor);

  // 2. 句號後添加雙換行（對話內文已抽出，不會被切碎）；後方已有換行則跳過
  const formatted = extracted
    .replace(/。([」』"'〉》）］｝]*)(?!\n)/g, '。$1\n\n')
    .replace(/\n{3,}/g, '\n\n');

  // 3. 剝除契約格式殘留的外層『』（regex 只消耗「角色名：「內容」」，外殼會遺留在氣泡前後）
  const unwrapped = formatted
    .replace(/『\s*(\u0000\d+\u0000)/g, '\n\n$1')
    .replace(/(\u0000\d+\u0000)\s*』/g, '$1\n\n')
    .replace(/\n{3,}/g, '\n\n');

  // 4. 還原氣泡（前後各留空行，讓 marked 視為 HTML 區塊）
  return unwrapped.replace(/\u0000(\d+)\u0000/g, function(_, idx) {
    return bubbles[Number(idx)] || '';
  });
};

/**
 * 特殊情報塊 (肉身閃回 / 破綻反應 / 遠方傳聞)：群聊時間線上的系統插播
 */
window.formatSpecialBlock = function(kind, text) {
  const t = window.escapeHtml(String(text || '').trim());
  if (!t) return '';
  if (kind === 'flashback') {
    return `\n\n<div class="special-block flashback-block"><span class="special-tag">[FLASHBACK]</span><span>肉身記憶閃回：${t}</span></div>`;
  }
  if (kind === 'dissonance') {
    return `\n\n<div class="special-block dissonance-block"><span class="special-tag">[DISSONANCE]</span><span>破綻反應：${t}</span></div>`;
  }
  if (kind === 'ending') {
    return `<div class="special-block ending-block"><span class="special-tag">[ENDING]</span><span>${t}</span></div>`;
  }
  return `\n\n<div class="special-block rumor-block"><span class="special-tag">[RUMOR]</span><span>遠方異動：${t}</span></div>`;
};

window.extractJson = function(text) {
  if (!text || typeof text !== 'string') return null;
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  try {
    return JSON.parse(clean);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_) {}
    }
    return null;
  }
};

window.extractNarrative = function(text) {
  if (!text || !text.trim()) return null;
  
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  // 1. 嘗試完整 JSON 解析
  try {
    const data = JSON.parse(clean);
    if (data && typeof data === 'object') {
      const candidate = data.narrative ?? data.story ?? data.content ?? data.text ?? data.response;
      if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
        return window.cleanText(String(candidate));
      }
    }
  } catch (e) {
    // 2. 串流中或非完整 JSON 正則匹配
    const match = text.match(/"(?:narrative|story|content|text)"\s*:\s*"((?:[^"\\]|\\.)*)/);
    if (match) {
      return window.cleanText(match[1]);
    }
    // 3. 若非 JSON 格式，直接視為純文字故事
    if (!text.trim().startsWith('{') && !text.trim().startsWith('```')) {
      return window.cleanText(text);
    }
  }

  // 4. 備用正則匹配
  const match = text.match(/"narrative"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (match) return window.cleanText(match[1]);

  if (!text.trim().startsWith('{')) return window.cleanText(text);
  return null;
};

window.extractMeta = function(text) {
  if (!text || !text.trim()) return null;
  // 新版 transmigration 欄位：player_scene / suggested_options / attitude_changes / npc_movements / dissonance_delta
  // 舊版欄位：options / hp / impact / scene / meta
  const isMetaLike = (data) => {
    if (!data || typeof data !== 'object') return false;
    if (data.meta) return true;
    if (data.options || data.suggested_options) return true;
    if (data.hp !== undefined || data.sp !== undefined || data.threat !== undefined) return true;
    if (data.impact !== undefined) return true;
    if (data.scene !== undefined || data.player_scene !== undefined) return true;
    if (Array.isArray(data.attitude_changes) || Array.isArray(data.npc_movements)) return true;
    if (data.dissonance_delta !== undefined || data.dissonance !== undefined) return true;
    return false;
  };
  try {
    let clean = text.trim();
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    const data = JSON.parse(clean);
    if (data.meta) return data.meta;
    if (isMetaLike(data)) return data;
    return null;
  } catch (e) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0]);
        if (data.meta) return data.meta;
        if (isMetaLike(data)) return data;
      } catch (_) {}
    }
    return null;
  }
};

window.splitMetaBlock = function(text) {
  const trimmed = text.trim();
  if (!trimmed) return { narrative: "", meta: null, isJson: false, isComplete: false };

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
      return { narrative: "", meta: null, isJson: true, isComplete: false };
    }
    return { narrative: text, meta: null, isJson: false, isComplete: false };
  }
};

/**
 * @deprecated 相容舊格式；新管線請用 validators.js 的 parseDeltaNumberStrict。
 * 相容："+10"/"-5" 相對增量；"90/100" 絕對值；裸 "90" 視為絕對值（已棄用，歧義來源）。
 * 新契約要求 LLM 一律回顯式 +/- 或 A/B 格式；裸數字由 validator 拒收，避免「20 是剩20還是扣20」。
 * 保留供舊模型輸出 / 舊存檔結算（game.js applyImpact）相容，每次調用裸數字分支會 console.warn。
 */
window.parseDeltaNumber = function(raw, current) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (!window.__parseDeltaWarned) { window.__parseDeltaWarned = true; console.warn('[deprecated] parseDeltaNumber 數字型裸值分支已棄用，請改用 parseDeltaNumberStrict（validators.js）。'); }
    // 數字型裸值：向下相容視為絕對值
    return raw - current;
  }
  const str = String(raw).trim();
  if (!str || /^(null|none|無|nan)$/i.test(str)) return undefined;

  // 支援 XX/TotalLimit 格式，例如 "90/100" -> 絕對值 90
  if (str.includes('/')) {
    const val = Number(str.split('/')[0]);
    return Number.isFinite(val) ? val - current : undefined;
  }

  // 支援帶有正負號的相對增量，例如 "+10" 或 "-5"
  if (str.startsWith('+') || str.startsWith('-')) {
    const v = Number(str);
    return Number.isFinite(v) ? v : undefined;
  }

  // 5-1: 純數字且無正負號：裸數字歧義，已廢棄，回傳 undefined 降級為 +0
  const v = Number(str);
  if (Number.isFinite(v)) {
    if (!window.__parseDeltaBareWarned) {
      window.__parseDeltaBareWarned = true;
      console.warn('[deprecated] parseDeltaNumber 裸數字字串已拒收（歧義，請使用顯式 +/- 或 A/B 格式）。');
    }
    return undefined;
  }
  return undefined;
};

/**
 * 能力值變動解析器 (支援能力值增量與絕對值結構化解析)
 * 回傳：{ 能力名: { isDelta: boolean, val: number, min?: number, max?: number } }
 */
window.parsePairs = function(raw) {
  const out = {};
  if (!raw || /^(none|無|null|nan)$/i.test(String(raw).trim())) return out;
  // 物件路徑正規化：統一為 { isDelta, val, min?, max? }
  if (typeof raw === 'object') {
    Object.entries(raw).forEach(([k, v]) => {
      if (v !== null && typeof v === 'object' && ('val' in v)) {
        const num = Number(v.val);
        if (!Number.isFinite(num)) return;
        out[k] = {
          isDelta: v.isDelta === true,
          val: num,
          ...(v.min !== undefined ? { min: Number(v.min) } : {}),
          ...(v.max !== undefined ? { max: Number(v.max) } : {}),
        };
      } else {
        const num = Number(v);
        if (k && Number.isFinite(num)) out[k] = { isDelta: false, val: num };
      }
    });
    return out;
  }
  // 5-4: 全形符號歸一化（＝＋－）+ 擴充切分符號 [;；、,，\n]+
  const normStr = String(raw).replace(/＝/g, '=').replace(/＋/g, '+').replace(/－/g, '-');
  const parts = normStr.split(/[;；、,，\n]+/).map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const vStr = part.slice(eq + 1).trim();

    // 檢查第一位是否帶有正負號代表增減值
    const isDelta = vStr.startsWith('+') || vStr.startsWith('-');
    const cleanVStr = isDelta ? vStr : vStr.replace(/^\+/, '');

    if (vStr.includes('/')) {
      const segments = vStr.split('/').map(s => s.trim());
      if (segments.length === 3) {
        out[k] = {
          isDelta: segments[0].startsWith('+') || segments[0].startsWith('-'),
          val: Number(segments[0]),
          min: Number(segments[1]),
          max: Number(segments[2])
        };
      } else if (segments.length === 2) {
        // 預設下限為 0
        out[k] = {
          isDelta: segments[0].startsWith('+') || segments[0].startsWith('-'),
          val: Number(segments[0]),
          min: 0,
          max: Number(segments[1])
        };
      }
    } else {
      const v = Number(cleanVStr);
      if (k && Number.isFinite(v)) {
        out[k] = {
          isDelta: isDelta,
          val: v
        };
      }
    }
  }
  return out;
};

/**
 * 平滑打字機效果器
 */
window.createTypewriter = function(el, scrollContainer) {
  let queue = "";
  let fullContent = "";
  let timer = null;
  let isDone = false;
  let reducedMotion = false;
  try {
    reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {}

  const flushAll = () => {
    if (!queue && !fullContent) return;
    fullContent += queue;
    queue = "";
    try {
      el.innerHTML = marked.parse(window.formatNarrative(fullContent));
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    } catch (_) {}
  };

  const type = () => {
    // 5-5: reducedMotion 立即全量渲染，不進入死循環輪詢
    if (reducedMotion) {
      flushAll();
      timer = null;
      return;
    }
    if (queue.length > 0 || !isDone) {
      if (queue.length > 0) {
        // 流暢度：每 tick 3 字，仍保留打字感
        const batchSize = 3;
        const chars = queue.substring(0, batchSize);
        queue = queue.substring(batchSize);
        fullContent += chars;

        const wasAtBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 30;
        const formatted = window.formatNarrative(fullContent);
        el.innerHTML = marked.parse(formatted);

        if (wasAtBottom) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
      timer = setTimeout(type, window.SETTINGS.UI.typewriterDelayMs);
    } else {
      timer = null;
    }
  };

  return {
    push: (text) => {
      queue += text;
      if (reducedMotion) {
        flushAll();
        return;
      }
      if (!timer) type();
    },
    finish: () => {
      isDone = true;
      if (reducedMotion) {
        flushAll();
      }
    },
    stop: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      isDone = true;
      queue = "";
    },
    wait: () => new Promise(resolve => {
      if (reducedMotion && isDone) {
        flushAll();
        return resolve();
      }
      const check = () => {
        if (isDone && queue.length === 0) resolve();
        else setTimeout(check, 50);
      };
      check();
    })
  };
};

window.getGameSaveKey = function() {
  return `${window.SETTINGS.STORAGE_KEYS.gameSave}_${window.state.currentStoryId || 'default'}`;
};

window.loadFromStorage = function() {
  try {
    const key = window.getGameSaveKey();
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // schema v2 斷代：舊存檔視為失效，交由上層重開（使用者已確認可斷代）
    if (window.isSaveCompatible && !window.isSaveCompatible(data)) {
      console.warn('[save] 舊版本存檔已失效（schema mismatch），將重新開局。');
      return null;
    }
    return data;
  } catch (e) { return null; }
};

window.saveToStorage = function() {
  const key = window.getGameSaveKey();
  if (window.stampSaveSchema) window.stampSaveSchema(window.state.game);
  localStorage.setItem(key, JSON.stringify(window.state.game));
};

/**
 * 數值階位計算 (凡胎 0-29 / 窺徑 30-59 / 入微 60-89 / 極境 90-100)
 */
window.getStatTier = function(val) {
  const n = Number(val) || 0;
  if (n >= 90) return { name: '極境', tier: 4, class: 'tier-epic' };
  if (n >= 60) return { name: '入微', tier: 3, class: 'tier-high' };
  if (n >= 30) return { name: '窺徑', tier: 2, class: 'tier-mid' };
  return { name: '凡胎', tier: 1, class: 'tier-low' };
};

/**
 * 選項門檻與代價解析器
 * 支援格式：【天眼≥30】、【靈力≥20】、【消耗 20 靈力】
 */
window.parseOptionRequirement = function(optionText, player) {
  if (!optionText || !player) return { eligible: true };

  // 1. 檢定門檻格式：【屬性名≥數值】或【屬性名>=數值】
  const thresholdMatch = optionText.match(/【([^【】≥>=]+)[≥>=]+(\d+)】/);
  if (thresholdMatch) {
    const statName = thresholdMatch[1].trim();
    const reqVal = parseInt(thresholdMatch[2], 10);

    let currentVal = 0;
    if (statName === '生命' || statName === '生機' || statName === 'hp' || statName === 'HP' || statName === '氣血') {
      currentVal = player.hp || 0;
    } else if (statName === '靈力' || statName === '靈息' || statName === 'sp' || statName === 'SP' || statName === '真元') {
      currentVal = player.sp || 0;
    } else if (statName === '業力' || statName === '威脅' || statName === '天劫預兆' || statName === 'threat') {
      currentVal = player.threat || 0;
    } else if (player.abilities && player.abilities[statName] !== undefined) {
      const a = player.abilities[statName];
      currentVal = typeof a === 'object' && a !== null ? a.val : Number(a);
    }

    if (currentVal < reqVal) {
      return {
        eligible: false,
        type: 'threshold',
        stat: statName,
        required: reqVal,
        current: currentVal,
        reason: `需 ${statName} ≥ ${reqVal}（當前 ${currentVal}）`
      };
    }
    return {
      eligible: true,
      type: 'threshold',
      stat: statName,
      required: reqVal,
      current: currentVal
    };
  }

  // 2. 資源消耗格式：【消耗 20 靈力】或【消耗 15 生命】
  const costMatch = optionText.match(/【消耗\s*(\d+)\s*(靈力|靈息|生命|生機|真元|氣血|SP|HP)】/i);
  if (costMatch) {
    const cost = parseInt(costMatch[1], 10);
    const typeStr = costMatch[2];
    const isSp = /靈力|靈息|真元|SP/i.test(typeStr);
    const poolVal = isSp ? (player.sp || 0) : (player.hp || 0);
    const poolName = isSp ? '靈力' : '生命';

    if (poolVal < cost) {
      return {
        eligible: false,
        type: 'cost',
        cost: cost,
        costType: poolName,
        current: poolVal,
        reason: `${poolName}不足（需 ${cost}，當前 ${poolVal}）`
      };
    }
    return {
      eligible: true,
      type: 'cost',
      cost: cost,
      costType: poolName,
      current: poolVal
    };
  }

  // 6-3: 當靈力枯竭 (sp <= 0) 時，鎖定消耗靈力或施展法術之選項
  if ((player.sp || 0) <= 0 && /靈力|真元|靈息|SP/i.test(optionText) && /消耗|施展|法術|秘法/.test(optionText)) {
    return {
      eligible: false,
      type: 'cost',
      cost: 1,
      costType: '靈力',
      current: 0,
      reason: '靈力枯竭，無法施展法術'
    };
  }

  return { eligible: true };
};

window.checkOptionEligibility = function(optionText, player) {
  return window.parseOptionRequirement(optionText, player).eligible;
};

// 3-5: UTF-8 + Base64url 存檔序列化與反序列化（消除中文/emoji atob 報錯風險）
window.encodeSaveData = function(data) {
  const jsonStr = JSON.stringify(data);
  const bytes = new TextEncoder().encode(jsonStr);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

window.decodeSaveData = function(rawStr) {
  if (!rawStr) return null;
  let s = String(rawStr).trim();
  // base64url 轉回 standard base64
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) {
    s += '=';
  }
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const json = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(json);
  } catch (_) {
    // 向下相容舊格式 escape / atob
    const json = decodeURIComponent(escape(atob(s)));
    return JSON.parse(json);
  }
};

