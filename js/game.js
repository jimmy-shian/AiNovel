// ========== 遊戲核心運作與邏輯控制 (Game) ==========

window.applyImpact = function(impact) {
  const p = window.state.game.player;
  if (!p.abilities) p.abilities = {};

  const changes = [];

  // 1. 氣血 (HP) 變動
  if (impact.hp !== undefined && impact.hp !== 0) {
    p.hp = Math.min(100, Math.max(0, p.hp + impact.hp));
    changes.push(['生命', impact.hp]);
  }
  // 2. 靈力 (SP) 變動
  if (impact.sp !== undefined && impact.sp !== 0) {
    p.sp = Math.min(100, Math.max(0, p.sp + impact.sp));
    changes.push(['靈力', impact.sp]);
  }
  // 3. 業力 (Threat) 變動（0-100 雙向夾）
  if (impact.threat !== undefined && impact.threat !== 0) {
    p.threat = Math.min(100, Math.max(0, p.threat + impact.threat));
    changes.push(['業力', impact.threat]);
  }

  // 4. 新增能力
  if (impact.new_abilities) {
    Object.entries(impact.new_abilities).forEach(([n, v]) => {
      if (typeof v === 'object' && v !== null) {
        p.abilities[n] = {
          val: v.val,
          min: v.min !== undefined ? v.min : 0,
          max: v.max !== undefined ? v.max : 100
        };
        changes.push([n, v.val]);
      } else {
        p.abilities[n] = {
          val: v,
          min: 0,
          max: 100
        };
        changes.push([n, v]);
      }
    });
  }

  // 5. 更新能力
  if (impact.update_abilities) {
    Object.entries(impact.update_abilities).forEach(([n, v]) => {
      if (p.abilities[n] === undefined) {
        // 容錯：防呆動態新增
        if (typeof v === 'object' && v !== null) {
          p.abilities[n] = {
            val: v.val,
            min: v.min !== undefined ? v.min : 0,
            max: v.max !== undefined ? v.max : 100
          };
          changes.push([n, v.val]);
        } else {
          p.abilities[n] = {
            val: v,
            min: 0,
            max: 100
          };
          changes.push([n, v]);
        }
      } else {
        // 原有能力的處理
        const currentAbility = p.abilities[n];
        const isCurrentObj = typeof currentAbility === 'object' && currentAbility !== null;
        const currentVal = isCurrentObj ? currentAbility.val : currentAbility;
        const currentMin = isCurrentObj ? currentAbility.min : 0;
        const currentMax = isCurrentObj ? currentAbility.max : 100;

        let newVal = currentVal;
        let newMin = currentMin;
        let newMax = currentMax;

        if (typeof v === 'object' && v !== null) {
          if (v.isDelta) {
            // 增量鉗制：契約上限 ±3，防止無故暴增
            const capped = Math.max(-3, Math.min(3, Number(v.val) || 0));
            newVal = currentVal + capped;
          } else {
            newVal = v.val;
          }
          if (v.min !== undefined) newMin = v.min;
          if (v.max !== undefined) newMax = v.max;
        } else {
          const capped = Math.max(-3, Math.min(3, Number(v) || 0));
          newVal = currentVal + capped; // 物件外數字一律視為增量並鉗制
        }

        newVal = Math.min(newMax, Math.max(newMin, newVal));

        if (isCurrentObj) {
          p.abilities[n].val = newVal;
          p.abilities[n].min = newMin;
          p.abilities[n].max = newMax;
        } else {
          p.abilities[n] = newVal;
        }
        changes.push([n, newVal - currentVal]);
      }
    });
  }

  // 6. 場景遷移處理（經正規化 + 白名單校驗，拒絕非法瞬移）
  {
    const rawScene = impact.scene;
    const normScene = window.normalizeSceneKey
      ? window.normalizeSceneKey(rawScene, window.state.world)
      : rawScene;
    if (normScene && window.state.world.scenes[normScene]) {
      const chk = window.validateSceneMove
        ? window.validateSceneMove(normScene, window.state.game.scene, window.state.world)
        : { ok: true, moved: normScene !== window.state.game.scene };
      if (chk.ok) {
        window.state.game.scene = normScene;
        if (window.registerSceneVisit) window.registerSceneVisit(window.state.game, normScene);
      } else {
        console.warn('[applyImpact] 非法場景移動已攔截:', chk.reason);
      }
    }
  }

  // 7. 能力增量上限鉗制（防 LLM 無故暴增；顯式契約 ≤3，程式再保險一次）
  // 注意：已移除舊版「天眼探索度 auto」「悟性 auto」隱性成長——該行為與 LLM 判定打架，
  // 是數值無故跳動主因。後續成長一律經 Meta 明示 upd_ability。

  // 渲染
  window.render();

  // 補間動畫
  changes.forEach(([label, delta], i) => {
    if (delta !== 0) {
      setTimeout(() => window.showFloatingImpact(label, delta), i * window.SETTINGS.UI.floatingImpactStaggerMs);
    }
  });
};

window.handleAction = async function(e, isFirstMove = false, retryAction = null) {
  if (e) e.preventDefault();
  if (window.state.isThinking) return;

  if (isFirstMove) {
    window.selectors.storyLog.innerHTML = '';
  }

  const action = retryAction !== null ? retryAction : window.selectors.playerAction.value.trim();
  if (!action && !isFirstMove) return;

  const apiKey = window.selectors.apiKey.value.trim();
  if (!apiKey) {
    window.selectors.settingsModal.classList.remove('hidden');
    return;
  }

  const timestamp = Date.now();
  if (!isFirstMove && retryAction === null) {
    window.appendStory(action, 'action', timestamp);
    window.selectors.playerAction.value = '';
  }

  window.setThinking(true);
  const currentEntry = window.appendStory('', 'narrative', timestamp);
  const contentEl = currentEntry.querySelector('.entry-content');
  contentEl.innerHTML = '';

  // ========== 2-call 管線：第 1 呼叫 統一故事（Director+Narrative 融合）==========
  // 記憶：摘要 + 近 N 全文（story-bible），不再全文餵 15 輪
  const prevNarratives = (window.state.game.history || []).slice(-2).map(h => (h.result && h.result.narrative) || '');
  let storyData = null;
  let narrative = null;
  let sceneHint = null;
  const MAX_STORY_TRIES = 2;

  for (let attempt = 0; attempt < MAX_STORY_TRIES && !narrative; attempt++) {
    if (attempt > 0) {
      console.warn(`[Story] 校驗未過，同輪糾錯重跑第 ${attempt} 次...`);
      if (window.state.currentTypewriter) window.state.currentTypewriter.stop();
      contentEl.innerHTML = '';
    }
    try {
      const systemPrompt = window.buildUnifiedStorySystem
        ? window.buildUnifiedStorySystem()
        : window.NARRATIVE_PROMPT;
      let userContent = window.buildUnifiedStoryPrompt
        ? window.buildUnifiedStoryPrompt(action, isFirstMove)
        : window.buildNarrativePromptWithDirector(action, null, isFirstMove);
      if (attempt > 0) {
        userContent += '\n\n【系統糾錯】上一版違反輸出契約（視角/重複/場景key其一）。請嚴格第一人稱「我」、不複述場景原文與前輪句子、scene_hint 填白名單 key，僅回標準 JSON。';
      }

      let displayedLen = 0;
      const typewriter = window.createTypewriter(contentEl, window.selectors.storyLog);
      window.state.currentTypewriter = typewriter;

      const fullText = await window.streamAPICall(systemPrompt, userContent, (delta, accumulated) => {
        const currentNarrative = window.extractNarrative(accumulated) || '';
        if (currentNarrative.length > displayedLen) {
          const newText = currentNarrative.substring(displayedLen);
          displayedLen = currentNarrative.length;
          typewriter.push(newText);
        }
      }, true, 'story');

      // 不在此等待打字機：讓 Meta 呼叫與打字動畫並行，縮短體感延遲
      storyData = window.extractJson ? window.extractJson(fullText) : null;
      narrative = (storyData && storyData.narrative) ? window.cleanText(String(storyData.narrative)) : window.extractNarrative(fullText);
      sceneHint = storyData && storyData.scene_hint ? String(storyData.scene_hint).trim() : null;
      if (!narrative) {
        console.warn('[Story] 無法解析 narrative，原始前 200 字:', String(fullText || '').slice(0, 200));
        typewriter.stop();
        continue;
      }
      // 本地確定性校驗（零額外 LLM 呼叫）
      const pov = window.validatePOV ? window.validatePOV(narrative) : { ok: true };
      const rep = window.validateRepetition ? window.validateRepetition(narrative, prevNarratives) : { ok: true };
      if (!pov.ok) {
        console.warn('[Story] POV 校驗失敗:', pov.reason);
        if (attempt === MAX_STORY_TRIES - 1) break;
        typewriter.stop();
        narrative = null;
        continue;
      }
      if (!rep.ok) {
        console.warn('[Story] 重複校驗失敗:', rep.reason);
        if (attempt === MAX_STORY_TRIES - 1) break; // 最後一次仍接受，避免無限重跑加延遲
        typewriter.stop();
        narrative = null;
        continue;
      }
      typewriter.finish();
      console.log('[Story] 統一故事完成', { scene_hint: sceneHint });
    } catch (err) {
      console.error('[Story] 串流錯誤:', err.message);
    }
  }

  if (!narrative) {
    console.error('[Story] 故事生成失敗，已達最大重試次數');
    window.showRetryError('故事生成失敗', isFirstMove, action, contentEl, currentEntry);
    window.setThinking(false);
    return;
  }

  // ========== 2-call 管線：第 2 呼叫 嚴格 Meta（短、低溫、非串流）==========
  // 與打字機並行：敘事文本已拿到即發 Meta，不等動畫播完
  const metaPromise = (async () => {
    let meta = null;
    const MAX_META_RETRIES = 2;
    for (let r = 0; r < MAX_META_RETRIES && !meta; r++) {
      try {
        const context = window.buildStrictMetaContext
          ? window.buildStrictMetaContext(isFirstMove ? '開始遊戲' : action, narrative, sceneHint || window.state.game.scene)
          : window.buildMetaPromptContext(isFirstMove ? '開始遊戲' : action);
        const metaUserContent = window.META_PROMPT
          .replace('{{CONTEXT}}', context)
          .replace('{{NARRATIVE}}', narrative);
        const metaText = await window.streamAPICall(
          '你是《天衍九州》數據裁判。僅回傳 JSON 格式的數值數據。',
          metaUserContent,
          null,
          false,
          'meta'
        );
        const cand = window.extractMeta(metaText);
        if (cand) {
          // 嚴格校驗：裸數字/超量增量/非法場景直接判失敗並重跑一次（仍在第 2 呼叫預算內）
          const strict = window.validateStrictMeta
            ? window.validateStrictMeta(cand, window.state.world, window.state.game.scene)
            : { ok: true, normalizedScene: cand.scene };
          if (!strict.ok) {
            console.warn('[Meta] 嚴格校驗失敗:', strict.reason, '原始:', String(metaText).slice(0, 200));
            continue;
          }
          if (strict.normalizedScene !== undefined) cand.scene = strict.normalizedScene;
          // 裸數字 HP/SP/threat 降級為 +0，避免歧義誤扣（契約要求顯式符號）
          ['hp', 'sp', 'threat'].forEach(f => {
            const chk = window.parseDeltaNumberStrict ? window.parseDeltaNumberStrict(cand[f]) : { ok: true };
            if (chk && chk.ok === false) {
              console.warn(`[Meta] ${f} 為裸數字歧義，已降級為 +0:`, cand[f]);
              cand[f] = '+0';
            }
          });
          meta = cand;
          console.log('[Meta] 數據推演完成', meta);
        } else {
          console.warn('[Meta] 未能解析 meta，原始內容:', String(metaText).slice(0, 200));
        }
      } catch (err) {
        console.error('[Meta] 串流錯誤:', err.message);
      }
    }
    return meta;
  })();

  // 等待 Meta 與打字機雙完成（並行等待，總延遲 ≈ max(動畫, Meta) 而非相加）
  const [metaResolved] = await Promise.all([
    metaPromise,
    (window.state.currentTypewriter ? window.state.currentTypewriter.wait() : Promise.resolve()),
  ]);
  let meta = metaResolved;
  if (!meta) {
    console.warn('[Meta] 數據推演失敗，將使用預設空數據');
    meta = { impact: {}, suggested_options: ['繼續探索', '觀察四周', '調息打坐', '查看狀態'] };
  }

  // 最終確認渲染
  if (narrative) {
    contentEl.innerHTML = marked.parse(window.formatNarrative(narrative));
  }

  // 解析 Meta 效果（含場景正規化：title→key）
  const normScene = window.normalizeSceneKey
    ? window.normalizeSceneKey((meta.scene && meta.scene !== 'null') ? meta.scene : (sceneHint || null), window.state.world)
    : ((meta.scene && meta.scene !== 'null') ? meta.scene : null);
  // 敘事↔Meta 交叉：若敘事暗示移動但 Meta 回 null，以白名單內的 sceneHint 補正；反之 Meta 非法移動則攔截
  let finalScene = normScene;
  {
    const cur = window.state.game.scene;
    const exits = (window.state.world.scenes[cur] && window.state.world.scenes[cur].scene_exit) || [];
    const hintNorm = window.normalizeSceneKey && sceneHint ? window.normalizeSceneKey(sceneHint, window.state.world) : sceneHint;
    if (!finalScene && hintNorm && hintNorm !== cur && exits.indexOf(hintNorm) !== -1) {
      console.warn('[Scene] Meta 回 null 但敘事暗示合法移動，以 sceneHint 補正:', hintNorm);
      finalScene = hintNorm;
    }
  }
  const parsed = {
    hp: window.parseDeltaNumber(meta.hp, window.state.game.player.hp),
    sp: window.parseDeltaNumber(meta.sp, window.state.game.player.sp),
    threat: window.parseDeltaNumber(meta.threat, window.state.game.player.threat),
    scene: finalScene,
    new_abilities: window.parsePairs(meta.new_ability || meta.new_abilities),
    update_abilities: window.parsePairs(meta.upd_ability || meta.update_abilities || meta.upd_abilities)
  };

  const suggested_options = meta.options || [];
  const isContinuation = meta && meta.has_more;
  if (isContinuation) {
    suggested_options.unshift('繼續敘事...');
  }

  // 更新 Flags + 弧線 tick
  if (meta.flags && window.mergeStoryFlags) {
    window.mergeStoryFlags(window.state.game, meta.flags);
  } else if (meta.flags) {
    window.state.game.story_flags = { ...(window.state.game.story_flags || {}), ...meta.flags };
  }
  if (window.tickArcCountdown) window.tickArcCountdown(window.state.game);

  const currentSceneBefore = window.state.game.scene;
  const resultData = { narrative: narrative.trim(), impact: parsed, suggested_options, sceneAfter: finalScene || currentSceneBefore };

  console.log('[System] 2-call 完成', resultData);

  window.state.game.history.push({ action: isFirstMove ? 'START' : action, result: resultData, timestamp });
  if (window.state.game.history.length > window.state.historyLimit) window.state.game.history.shift();

  window.applyImpact(resultData.impact || {});
  window.saveToStorage();
  window.render();
  window.setThinking(false);
};

window.importSave = function() {
  try {
    const raw = window.selectors.saveCode.value.trim();
    // 新格式：UTF-8 base64（TextDecoder）；相容舊 escape/atob
    let json = '';
    try {
      const bin = atob(raw);
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      json = new TextDecoder('utf-8').decode(bytes);
    } catch (_) {
      json = decodeURIComponent(escape(atob(raw)));
    }
    const data = JSON.parse(json);
    if (window.isSaveCompatible && !window.isSaveCompatible(data)) {
      alert('此命錄為舊版本，已失效，請重開新局（v1.5 起存檔斷代）。');
      return;
    }
    window.state.game = data;
    window.saveToStorage();
    location.reload();
  } catch (e) { alert('無效數據'); }
};

window.clearGame = function() {
  const key = window.getGameSaveKey();
  localStorage.removeItem(key);
  location.reload();
};

window.setThinking = function(val) {
  window.state.isThinking = val;
  if (val) {
    if (!window.state.thinkingEntry) window.state.thinkingEntry = window.appendThinking();
  } else {
    window.state.thinkingEntry?.remove?.();
    window.state.thinkingEntry = null;
  }
};

window.appendThinking = function(timestamp = null) {
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
        <span class="thinking-text">正在推演天機</span>
        <div class="fb-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>`;
    
  const wasAtBottom = window.selectors.storyLog.scrollHeight - window.selectors.storyLog.scrollTop - window.selectors.storyLog.clientHeight < window.SETTINGS.UI.stickToBottomThresholdPx;
  window.selectors.storyLog.appendChild(entry);
  if (wasAtBottom) {
    window.selectors.storyLog.scrollTop = window.selectors.storyLog.scrollHeight;
  }
  return entry;
};

window.showRetryError = function(msg, isFirst, act, el, entry) {
  if (window.state.currentTypewriter) window.state.currentTypewriter.stop();
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
      window.handleAction(null, isFirst, act);
    };
  }
};

window.switchStory = async function(storyId) {
  if (!window.state.allStories || !window.state.allStories[storyId]) {
    console.error("[switchStory] Story ID not found:", storyId);
    return;
  }

  // 1. 設定新故事 ID 與儲存到 localStorage
  window.state.currentStoryId = storyId;
  localStorage.setItem('tianyan_current_story_id', storyId);

  try {
    const storyMeta = window.state.allStories[storyId];
    const storyData = await fetch(storyMeta.file).then((res) => res.json());
    window.state.world = storyData;
  } catch (err) {
    console.error("[switchStory] Failed to load story data:", err);
    alert("無法載入故事內容，請檢查檔案是否存在。");
    return;
  }

  // 2. 更新 AI 提示詞
  window.DIRECTOR_PROMPT = window.state.world.prompts.director;
  window.NARRATIVE_PROMPT = window.state.world.prompts.narrative;
  window.META_PROMPT = window.state.world.prompts.meta;

  // 3. 讀取存檔
  const saved = window.loadFromStorage();
  window.selectors.storyLog.innerHTML = '';

  if (saved) {
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
    window.appendStory('系統：等待鏈接中... 請在設置中輸入 API Key 並點擊儲存。', 'system');
  }

  // 4. 重置打字機與狀態
  if (window.state.currentTypewriter) {
    window.state.currentTypewriter.stop();
  }
  window.state.lastStats = {};
  
  // 5. 重新渲染畫面
  window.render();

  // 6. 如果有 API Key 且為全新開局，自動觸發首輪
  const apiKey = window.selectors.apiKey.value.trim();
  if (apiKey && window.state.game.history.length === 0) {
    window.handleAction(null, true);
  }
};
