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
 * 敘事格式化處理 (段落自動換行與對話框色彩標記)
 */
window.formatNarrative = function(text) {
  if (!text) return "";
  const cleaned = window.cleanText(text);
  
  // 在句號後添加雙換行，但若後方已有換行則跳過
  let formatted = cleaned.replace(/。([」』"'〉》）］｝]*)(?!\n)/g, '。$1\n\n');

  // 對話彩色化標記 Regex
  // 匹配模式：名字 (2-10字) 加上 說/道 或是 冒號，緊接著括號「對話」或『對話』
  // 例如：提燈女童說道：「這不是真的。」 或 瘋癲的村長：「啊啊！」
  const dialogRegex = /([\u4e00-\u9fa5A-Za-z0-9]{2,10})(?:說道|冷笑道|嘆道|怒道|問道|答道|說|笑|低語)?[：:「『]([^」』\n]+)[」』]/g;
  
  formatted = formatted.replace(dialogRegex, function(match, speaker, dialogContent) {
    return `<span class="dialog-block" data-speaker="${speaker.trim()}"><span class="speaker-name">${speaker.trim()}</span>：「${dialogContent.trim()}」</span>`;
  });

  return formatted;
};

window.extractNarrative = function(text) {
  if (!text.trim()) return null;
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      console.warn('[extractNarrative] 模型返回空 JSON 物件');
      return null;
    }
    if (data.narrative === undefined || data.narrative === null) {
      console.warn('[extractNarrative] JSON 中缺少 narrative 欄位');
      return null;
    }
    if (typeof data.narrative !== 'string' || !data.narrative.trim()) {
      console.warn('[extractNarrative] narrative 欄位為空');
      return null;
    }
    return window.cleanText(data.narrative);
  } catch (e) {
    const match = text.match(/"narrative"\s*:\s*"((?:[^"\\]|\\.)*)/);
    if (match) {
      return window.cleanText(match[1]);
    }
    if (!text.trim().startsWith('{')) return window.cleanText(text);
    return null;
  }
};

window.extractMeta = function(text) {
  if (!text.trim()) return null;
  try {
    const data = JSON.parse(text);
    if (data.meta) return data.meta;
    if (data.options || data.hp !== undefined) return data;
    return null;
  } catch (e) {
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
 * 數值變動智慧型解析器 (支援絕對值與相對增減值)
 */
window.parseDeltaNumber = function(raw, current) {
  if (raw === undefined || raw === null) return undefined;
  const str = String(raw).trim();
  
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
  
  // 純數字且無正負號，視為絕對值（新數值），轉換成相對於當前的增量 delta
  const v = Number(str);
  return Number.isFinite(v) ? v - current : undefined;
};

/**
 * 能力值變動解析器 (支援能力值增量與絕對值結構化解析)
 * 回傳：{ 能力名: { isDelta: boolean, val: number, min?: number, max?: number } }
 */
window.parsePairs = function(raw) {
  const out = {};
  if (!raw || /^(none|無|null|nan)$/i.test(String(raw).trim())) return out;
  if (typeof raw === 'object') return raw;
  const parts = String(raw).split(/[;；]/).map(s => s.trim()).filter(Boolean);
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

  const type = () => {
    if (queue.length > 0 || !isDone) {
      if (queue.length > 0) {
        const batchSize = 1;
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
};

window.loadFromStorage = function() {
  try {
    const raw = localStorage.getItem(window.SETTINGS.STORAGE_KEYS.gameSave);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
};

window.saveToStorage = function() {
  localStorage.setItem(window.SETTINGS.STORAGE_KEYS.gameSave, JSON.stringify(window.state.game));
};
