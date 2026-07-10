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
  // 3. 業力 (Threat) 變動
  if (impact.threat !== undefined && impact.threat !== 0) {
    p.threat = Math.max(0, p.threat + impact.threat);
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
            newVal = currentVal + v.val;
          } else {
            newVal = v.val;
          }
          if (v.min !== undefined) newMin = v.min;
          if (v.max !== undefined) newMax = v.max;
        } else {
          newVal = currentVal + v; // 預設做增量加減
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

  // 6. 場景遷移處理
  if (impact.scene && window.state.world.scenes[impact.scene]) {
    window.state.game.scene = impact.scene;
    
    // 更新探索度 (天眼)
    if (!window.state.game.visitedScenes) window.state.game.visitedScenes = [];
    if (!window.state.game.visitedScenes.includes(impact.scene)) {
      window.state.game.visitedScenes.push(impact.scene);
      const totalScenes = Object.keys(window.state.world.scenes).length;
      const progress = Math.round((window.state.game.visitedScenes.length / totalScenes) * 100);
      
      const oldResolution = (typeof window.state.game.player.abilities['天眼'] === 'object') 
        ? window.state.game.player.abilities['天眼'].val 
        : (window.state.game.player.abilities['天眼'] || 0);
        
      if (progress > oldResolution) {
        if (typeof window.state.game.player.abilities['天眼'] === 'object') {
          window.state.game.player.abilities['天眼'].val = progress;
        } else {
          window.state.game.player.abilities['天眼'] = { val: progress, min: 0, max: 100 };
        }
        changes.push(['天眼', progress - oldResolution]);
      }
    }
  }

  // 7. 自動微增悟性 (代表輪迴成長)
  const computeBonus = Math.floor(window.state.game.history.length / 5);
  const currentCompute = (typeof window.state.game.player.abilities['悟性'] === 'object') 
    ? window.state.game.player.abilities['悟性'].val 
    : (window.state.game.player.abilities['悟性'] || 0);
  const newCompute = 10 + computeBonus;
  
  if (newCompute > currentCompute) {
    if (typeof window.state.game.player.abilities['悟性'] === 'object') {
      window.state.game.player.abilities['悟性'].val = newCompute;
    } else {
      window.state.game.player.abilities['悟性'] = { val: newCompute, min: 0, max: 100 };
    }
    changes.push(['悟性', newCompute - currentCompute]);
  }

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

  // ========== Phase 0: Director (劇情導演) ==========
  let directorPlan = null;
  try {
    const directorUserContent = window.buildDirectorPrompt(action, isFirstMove);
    const directorText = await window.streamAPICall(window.DIRECTOR_PROMPT, directorUserContent, null, true);
    directorPlan = JSON.parse(directorText);
    console.log("[Phase 0] Director Plan:", directorPlan);
  } catch (err) {
    console.error("[Phase 0] Director Phase Failed:", err);
    directorPlan = {
      scene_goal: "活下去並探索真相",
      dramatic_conflict: "未知的壓迫感與環境威脅",
      reveal: "此地的空間結構正在發生微小坍塌",
      ending_hook: "陰影中似乎有視線在注視著你"
    };
  }

  // ========== Phase 1: 故事生成 (Narrative) ==========
  let narrative = null;
  let narrativeRetries = 0;
  const MAX_NARRATIVE_RETRIES = 3;

  while (!narrative && narrativeRetries < MAX_NARRATIVE_RETRIES) {
    if (narrativeRetries > 0) {
      console.warn(`[Phase 1] 故事解析失敗，重跑第 ${narrativeRetries} 次...`);
      if (window.state.currentTypewriter) window.state.currentTypewriter.stop();
      contentEl.innerHTML = '';
    }
    try {
      let systemPrompt = window.NARRATIVE_PROMPT;
      if (window.state.world.globalPrompt) {
        systemPrompt += `\n\n【世界觀全局設定】\n${window.state.world.globalPrompt}`;
      }

      const userContent = window.buildNarrativePromptWithDirector(action, directorPlan, isFirstMove);

      let displayedLen = 0;
      const typewriter = window.createTypewriter(contentEl, window.selectors.storyLog);
      window.state.currentTypewriter = typewriter;

      const fullText = await window.streamAPICall(systemPrompt, userContent, (delta, accumulated) => {
        const currentNarrative = window.extractNarrative(accumulated) || "";
        if (currentNarrative.length > displayedLen) {
          const newText = currentNarrative.substring(displayedLen);
          displayedLen = currentNarrative.length;
          typewriter.push(newText);
        }
      });

      typewriter.finish();
      narrative = window.extractNarrative(fullText);
    } catch (err) {
      console.error(`[Phase 1] 串流錯誤:`, err.message);
    }
    narrativeRetries++;
  }

  if (!narrative) {
    console.error('[Phase 1] 故事生成失敗，已達最大重試次數');
    window.showRetryError('故事生成失敗', isFirstMove, action, contentEl, currentEntry);
    window.setThinking(false);
    return;
  }

  // ========== Phase 2: 數據推演 (Meta) ==========
  let meta = null;
  let metaRetries = 0;
  const MAX_META_RETRIES = 2;

  while (!meta && metaRetries < MAX_META_RETRIES) {
    if (metaRetries > 0) {
      console.warn(`[Phase 2] 數據解析失敗，重跑第 ${metaRetries} 次...`);
    }
    try {
      const context = isFirstMove
        ? window.buildMetaPromptContext("開始遊戲")
        : window.buildMetaPromptContext(action);

      const metaUserContent = window.META_PROMPT
        .replace('{{CONTEXT}}', context)
        .replace('{{NARRATIVE}}', narrative);

      const metaText = await window.streamAPICall(
        '你是《天衍九州》數據裁判。僅回傳 JSON 格式的數值數據。',
        metaUserContent,
        null,
        false // 數據推演階段禁用思考模式
      );
      meta = window.extractMeta(metaText);
      if (meta) {
        console.log('[Phase 2] 數據推演完成', meta);
      } else {
        console.warn(`[Phase 2] 未能解析 meta，原始內容:`, metaText.slice(0, 200));
      }
    } catch (err) {
      console.error(`[Phase 2] 串流錯誤:`, err.message);
    }
    metaRetries++;
  }

  if (!meta) {
    console.warn('[Phase 2] 數據推演失敗，將使用預設空數據');
    meta = { impact: {}, suggested_options: ["繼續探索", "觀察四周", "調息打坐", "查看狀態"] };
  }

  // 等待打字機完成
  if (window.state.currentTypewriter) {
    await window.state.currentTypewriter.wait();
  }

  // 最終確認渲染
  if (narrative) {
    contentEl.innerHTML = marked.parse(window.formatNarrative(narrative));
  }

  // 解析 Meta 效果
  const parsed = {
    hp: window.parseDeltaNumber(meta.hp, window.state.game.player.hp),
    sp: window.parseDeltaNumber(meta.sp, window.state.game.player.sp),
    threat: window.parseDeltaNumber(meta.threat, window.state.game.player.threat),
    scene: (meta.scene && meta.scene !== 'null') ? meta.scene : null,
    new_abilities: window.parsePairs(meta.new_ability),
    update_abilities: window.parsePairs(meta.upd_ability)
  };

  const suggested_options = meta.options || [];
  const isContinuation = meta && meta.has_more;
  if (isContinuation) {
    suggested_options.unshift("繼續敘事...");
  }

  // 更新 Flags
  if (meta.flags) {
    window.state.game.story_flags = { ...(window.state.game.story_flags || {}), ...meta.flags };
  }

  const resultData = { narrative: narrative.trim(), impact: parsed, suggested_options };

  console.log("[System] 雙階段完成", resultData);

  window.state.game.history.push({ action: isFirstMove ? "START" : action, result: resultData, timestamp });
  if (window.state.game.history.length > window.state.historyLimit) window.state.game.history.shift();
  
  window.applyImpact(resultData.impact || {});
  window.saveToStorage();
  window.render();
  window.setThinking(false);
};

window.importSave = function() {
  try {
    const json = decodeURIComponent(escape(atob(window.selectors.saveCode.value.trim())));
    window.state.game = JSON.parse(json);
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
