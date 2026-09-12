// ========== LLM 與 API 調用服務 (API) ==========

window.buildSystemPromptForModel = function(model, baseSystemPrompt, enableThinking) {
  if (model.includes('gpt-oss')) {
    return baseSystemPrompt + (enableThinking ? window.SETTINGS.LLM.gptOssReasoningHints.high : window.SETTINGS.LLM.gptOssReasoningHints.low);
  }
  return baseSystemPrompt;
};

window.OUTPUT_CONTRACTS = {
  story: [
    '【輸出契約（必須遵守，否則會被系統退回重寫）】',
    '1. 全程第一人稱「我」敘事，嚴禁以第二人稱「你」為主體超過 2 句。',
    '2. 僅回標準 JSON：{"narrative":"...","scene_goal":"...","dramatic_conflict":"...","reveal":"...","emotional_tone":"...","ending_hook":"...","scene_hint":"當前場景key或目標場景key" }',
    '3. narrative 300-500 字，開篇承接玩家行動（80-120字），中段新危機（150-250字），結尾新線索+鉤子（50-120字）。',
    '4. 嚴禁複述【場景氛圍】原文與前輪句子；每輪必須有新的威脅、線索或 NPC 行動。',
    '5. 嚴禁數值/科技術語（HP→氣血/生機，SP→真元/神識，威脅→殺機/天劫預兆）。',
    '6. 若移動場景，scene_hint 必須填寫 scene_exit 白名單內的「場景key」原文；未移動則填當前場景key。',
  ].join('\n'),
  meta: [
    '【數據契約（必須遵守）】',
    '1. hp/sp/threat 一律用顯式相對增量（如 "+5"/"-10"/"+0"）或 "絕對值/上限"（如 "90/100"）；嚴禁回裸數字（如 "20"）。',
    '2. upd_ability 單項增量絕對值 ≤ +3，格式「名=+2/100」；無變動回 null。物件型數字視為絕對值。',
    '3. scene 必須是場景key原文或 null；有移動才填目標key，且必須在可遷移白名單內。',
    '4. options 3-4 個，含 1-2 個門檻/消耗項（【屬性≥N】/【消耗 N 靈力|生命】），門檻需與玩家當前能力相容。',
  ].join('\n'),
};

window.resolveLLMParams = function (kind, model, enableThinking) {
  const base = window.SETTINGS.LLM.defaults || {};
  const over = (kind === 'meta' ? window.SETTINGS.LLM.meta : window.SETTINGS.LLM.story) || {};
  return {
    temperature: over.temperature !== undefined ? over.temperature : base.temperature,
    top_p: over.top_p !== undefined ? over.top_p : base.top_p,
    max_tokens: over.max_tokens !== undefined ? over.max_tokens : base.max_tokens,
    stream: over.stream !== undefined ? over.stream : base.stream,
  };
};

window.buildChatPayload = function(model, systemPrompt, userContent, enableThinking, kind) {
  const base = window.SETTINGS.LLM.defaults;
  const resolved = window.resolveLLMParams(kind || 'story', model, enableThinking);
  const payload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: resolved.temperature,
    top_p: resolved.top_p,
    max_tokens: resolved.max_tokens,
    stream: resolved.stream,
    response_format: base.response_format,
  };
  if (base.frequency_penalty !== undefined) payload.frequency_penalty = base.frequency_penalty;
  if (base.presence_penalty !== undefined) payload.presence_penalty = base.presence_penalty;

  // Qwen 特化
  if (model.includes('qwen')) {
    payload.temperature = window.SETTINGS.LLM.qwen.temperature;
    payload.top_p = window.SETTINGS.LLM.qwen.top_p;
    payload.max_tokens = window.SETTINGS.LLM.qwen.max_tokens;
    if (enableThinking && window.SETTINGS.LLM.qwen.enable_thinking) {
      payload.chat_template_kwargs = { enable_thinking: true };
    }
  }

  // Deepseek 特化
  if (model.includes('deepseek')) {
    payload.temperature = window.SETTINGS.LLM.deepseek.temperature;
    payload.top_p = window.SETTINGS.LLM.deepseek.top_p;
    payload.max_tokens = window.SETTINGS.LLM.deepseek.max_tokens;
    if (enableThinking && window.SETTINGS.LLM.deepseek.thinking) {
      payload.extra_body = {
        chat_template_kwargs: {
          thinking: true,
          reasoning_effort: window.SETTINGS.LLM.deepseek.reasoning_effort
        }
      };
    }
  }

  return payload;
};

/**
 * 串流呼叫核心 (SSE 處理)
 */
window.streamAPICall = async function(systemPrompt, userContent, onDelta, enableThinking = true, kind = 'story') {
  const apiKey = window.selectors.apiKey.value.trim();
  const model = window.selectors.modelSelect.value;
  const finalSystemPrompt = window.buildSystemPromptForModel(model, systemPrompt, enableThinking);
  const payload = window.buildChatPayload(model, finalSystemPrompt, userContent, enableThinking, kind);

  // 嘗試端點清單（若啟用代理則優先使用候選代理端點，否則嘗試直連）
  const candidateUrls = window.CONFIG.useProxy
    ? (window.CONFIG.candidateProxyUrls || [window.CONFIG.proxyUrl])
    : [window.CONFIG.directUrl, ...(window.CONFIG.candidateProxyUrls || [])];

  let lastError = null;
  for (const url of candidateUrls) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let errDetail = `HTTP ${response.status}`;
        try {
          const errJson = await response.json();
          if (errJson?.error?.message) errDetail = errJson.error.message;
          else if (errJson?.detail) errDetail = errJson.detail;
        } catch (_) {}
        throw new Error(`API 請求失敗 (${errDetail})`);
      }

      // 非串流模式
      if (!payload.stream) {
        const data = await response.json();
        if (data.error) throw new Error(data.error.message || "API 內部錯誤");
        const content = data.choices?.[0]?.message?.content || "";
        if (onDelta && content) onDelta(content, content);
        return content;
      }

      // 串流模式
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;
          const dataStr = trimmedLine.slice(6);
          if (dataStr === '[DONE]') break;
          try {
            const data = JSON.parse(dataStr);
            if (data.error) throw new Error(data.error.message || "API 內部錯誤");
            const delta = data.choices?.[0]?.delta?.content || "";
            if (delta) {
              fullText += delta;
              if (onDelta) onDelta(delta, fullText);
            }
          } catch (e) {
            if (e.message !== "JSON.parse error" && !e.name?.includes("SyntaxError")) {
              throw e;
            }
          }
        }
      }

      return fullText;
    } catch (err) {
      console.warn(`[streamAPICall] 端點 ${url} 呼叫失敗:`, err.message);
      lastError = err;
      // 若多個端點可用則繼續嘗試下一個
      if (candidateUrls.length > 1) continue;
      break;
    }
  }

  throw lastError || new Error("無法連接任何 AI 推理端點，請確認 server.py 是否啟動或網路正常。");
};

window.buildDirectorPrompt = function(action, isFirstMove) {
  const g = window.state.game;
  const scene = window.state.world?.scenes?.[g.scene] || {};

  let content = `【世界規則】\n${(window.state.world?.world_rules || []).join('\n')}\n主線謎團：${window.state.world?.main_mystery || window.state.world?.coreMystery?.truthHint || ''}`;

  content += `\n\n【當前階段 (Arc)】
主線：${window.state.world?.main_arc || window.state.game?.current_arc?.goal || ''}
支線：${window.state.world?.sub_arc || ''}`;

  content += `\n\n【角色當前狀態】
位置：${g.scene}（${scene.title || g.scene}）
生命(HP)：${g.player.hp} | 靈力(SP)：${g.player.sp} | 業力(Threat)：${g.player.threat}`;

  if (g.player.abilities) {
    const abList = Object.entries(g.player.abilities)
      .map(([k, v]) => typeof v === 'object' && v !== null ? `${k}:${v.val}/${v.max}` : `${k}:${v}`)
      .join('、');
    content += `\n能力屬性：${abList}`;
  }

  if (g.player.inventory?.length > 0) {
    content += `\n行囊物品：${g.player.inventory.join('、')}`;
  }

  if (g.player.relationships && Object.keys(g.player.relationships).length > 0) {
    const relList = Object.entries(g.player.relationships)
      .map(([k, v]) => `${k}(好感:${v.favorability})`)
      .join('、');
    content += `\n人物關係：${relList}`;
  }

  if (g.history && g.history.length > 0) {
    content += `\n\n【前情提要（最近記憶）】`;
    const recent = g.history.slice(-window.state.historyLimit);
    recent.forEach((h, i) => {
      content += `\n第 ${i + 1} 輪 - 玩家：${h.action || '（開局）'}\n世界反饋：${h.result?.narrative || ''}`;
    });
  }

  content += `\n\n【本輪玩家輸入】\n${action || '（開局第一步，請描繪開場並給予初始指引）'}`;
  return content;
};

window.buildNarrativePromptWithDirector = function(action, directorPlan, isFirstMove) {
  const g = window.state.game;
  const scene = window.state.world?.scenes?.[g.scene] || {};

  let content = `【本輪玩家行動】\n${isFirstMove ? '（開局第一步，請描繪開場並給予初始指引）' : (action || '觀察四周')}`;

  if (directorPlan) {
    content += `\n\n【導演劇本大綱】
核心目標：${directorPlan.scene_goal || directorPlan.narrative_outline || '順應玩家行動展開故事'}
戲劇衝突：${directorPlan.dramatic_conflict || directorPlan.tension_direction || '突發異象或威脅阻礙'}
關鍵線索：${directorPlan.reveal || directorPlan.logical_consistency || '未知的因果線索'}
情緒基調：${directorPlan.emotional_tone || '神秘緊張'}
懸念鉤子：${directorPlan.ending_hook || '隱藏在暗處的異動'}`;
  }

  content += `\n\n【當前場景資訊】
名稱：${scene.title || g.scene}
場景氛圍：${scene.location_core || scene.description || '四周充滿未知與危險'}`;

  if (scene?.npcs?.length > 0) {
    const npcText = scene.npcs.map(npc => {
      if (typeof npc === 'object' && npc !== null) {
        let desc = npc.name || '神秘人物';
        if (npc.relationship) desc += `（立場:${npc.relationship}）`;
        if (npc.speaking_style) desc += `（語氣:${npc.speaking_style}）`;
        return desc;
      }
      return String(npc);
    }).join('、');
    content += `\n在場人物：${npcText}`;
  }

  if (scene?.scene_exit?.length > 0) {
    content += `\n可遷移區域：${scene.scene_exit.join('、')}`;
  }

  content += `\n\n【角色當前狀態】
生命(HP)：${g.player.hp} | 靈力(SP)：${g.player.sp} | 業力(Threat)：${g.player.threat}`;

  if (g.player.abilities) {
    const abList = Object.entries(g.player.abilities)
      .map(([k, v]) => {
        const val = typeof v === 'object' && v !== null ? v.val : v;
        const tier = window.getStatTier ? window.getStatTier(val).name : '凡胎';
        return typeof v === 'object' && v !== null ? `${k}:${v.val}/${v.max}（${tier}）` : `${k}:${v}（${tier}）`;
      })
      .join('、');
    content += `\n能力屬性：${abList}`;
  }

  if (g.history && g.history.length > 0) {
    content += `\n\n【前情提要（最近記憶）】`;
    const recent = g.history.slice(-window.state.historyLimit);
    recent.forEach((h, i) => {
      content += `\n第 ${i + 1} 輪 - 玩家：${h.action || '（開局）'}\n世界反饋：${h.result?.narrative || ''}`;
    });
  }

  return content;
};

// 保持向下相容
window.buildNarrativePrompt = window.buildNarrativePromptWithDirector;

window.buildMetaPromptContext = function(action) {
  const g = window.state.game;
  const scene = window.state.world?.scenes?.[g.scene] || {};

  let content = `【當前情勢】
場景：${scene?.title || g.scene}
行動：${action}

【玩家目前狀態】
氣血: ${g.player.hp}/100
靈力: ${g.player.sp}/100
業力: ${g.player.threat}/100
能力:
${Object.entries(g.player.abilities || {}).map(([n, v]) => {
    const val = typeof v === 'object' && v !== null ? v.val : v;
    const tierInfo = window.getStatTier ? window.getStatTier(val) : { name: '凡胎' };
    if (typeof v === 'object' && v !== null) return `- ${n}: ${v.val} (範圍: ${v.min}-${v.max}, 階位: ${tierInfo.name})`;
    return `- ${n}: ${v} (階位: ${tierInfo.name})`;
  }).join('\n')}`;

  if (scene?.choices?.length > 0) {
    content += `\n場景預設選擇參考：\n- ${scene.choices.join('\n- ')}`;
  }

  if (scene?.scene_exit?.length > 0) {
    content += `\n可遷移區域：${scene.scene_exit.join('、')}`;
  }

  content += `\n\n【重要：場景遷移指示】
若本輪故事或玩家行動明確提到移動、前往、動身去某個「可遷移區域」（例如：玩家說「去奇珍閣」，或是故事寫「我朝著奇珍閣走去」），你必須將 JSON 回傳的 "scene" 欄位填寫為該目標場景的中文精確名稱（例如："奇珍閣"）。如果沒有場景移動，則必須為 null。`;

  content += `\n\n請根據敘事內容與上述背景，決定 HP/SP/威脅值 的變動，並生成 3-5 個具備「戲劇後果」的選項。`;

  return content;
};

/**
 * 統一故事呼叫（Director+Narrative 融合，2-call 管線第 1 呼叫）
 * 一次回傳 { narrative, scene_goal, dramatic_conflict, reveal, emotional_tone, ending_hook, scene_hint }
 * 記憶採用 story-bible：摘要 + 近 N 全文，避免 15 輪全文爆 token。
 */
window.buildUnifiedStoryPrompt = function (action, isFirstMove) {
  const g = window.state.game;
  const scene = window.state.world?.scenes?.[g.scene] || {};
  const mem = window.renderMemoryBlock ? window.renderMemoryBlock(g.history || []) : '';

  let content = `【世界規則】\n${(window.state.world?.world_rules || []).join('\n')}\n主線謎團：${window.state.world?.main_mystery || window.state.world?.coreMystery?.truthHint || ''}`;
  if (window.state.world?.globalPrompt) content += `\n\n【世界觀全局設定】\n${window.state.world.globalPrompt}`;
  content += `\n\n【當前階段】\n主線：${window.state.world?.main_arc || g?.current_arc?.goal || ''}\n壓力：${g?.current_arc?.pressure || ''}\n倒數：${g?.current_arc?.countdown ?? ''}`;
  content += `\n\n【角色當前狀態】\n位置：${g.scene}（${scene.title || g.scene}）\n生命：${g.player.hp} | 靈力：${g.player.sp} | 業力：${g.player.threat}`;
  if (g.player.abilities) {
    const abList = Object.entries(g.player.abilities)
      .map(([k, v]) => {
        const val = typeof v === 'object' && v !== null ? v.val : v;
        const tier = window.getStatTier ? window.getStatTier(val).name : '凡胎';
        return typeof v === 'object' && v !== null ? `${k}:${v.val}/${v.max}（${tier}）` : `${k}:${v}（${tier}）`;
      }).join('、');
    content += `\n能力屬性：${abList}`;
  }
  if (g.player.inventory?.length > 0) content += `\n行囊物品：${g.player.inventory.join('、')}`;
  if (g.story_flags && Object.keys(g.story_flags).length > 0) {
    content += `\n故事旗標：${JSON.stringify(g.story_flags)}`;
  }
  content += `\n\n【當前場景資訊】\n名稱：${scene.title || g.scene}（key:${g.scene}）\n場景氛圍：${scene.location_core || scene.description || '四周充滿未知與危險'}`;
  if (scene?.npcs?.length > 0) {
    const npcText = scene.npcs.map(npc => {
      if (typeof npc === 'object' && npc !== null) {
        let desc = npc.name || '神秘人物';
        if (npc.relationship) desc += `（立場:${npc.relationship}）`;
        if (npc.speaking_style) desc += `（語氣:${npc.speaking_style}）`;
        return desc;
      }
      return String(npc);
    }).join('、');
    content += `\n在場人物：${npcText}`;
  }
  if (scene?.scene_exit?.length > 0) content += `\n可遷移區域（key白名單，只能選其一或不動）：${scene.scene_exit.join('、')}`;
  content += `\n\n${mem}`;
  content += `\n\n【本輪玩家行動】\n${isFirstMove ? '（開局第一步，請描繪開場並給予初始指引）' : (action || '觀察四周')}`;
  content += `\n\n${window.OUTPUT_CONTRACTS.story}`;
  return content;
};

window.buildUnifiedStorySystem = function () {
  let base = window.NARRATIVE_PROMPT || '你是《天衍九州》的靈魂筆者，以第一人稱「我」寫作。';
  if (window.state.world?.globalPrompt) base += `\n\n【世界觀全局設定】\n${window.state.world.globalPrompt}`;
  // 導演職責併入：起承轉合 + 順應玩家 + 張力 + 鉤子（不再單獨呼叫 LLM）
  base += '\n\n【導演職責（併入本呼叫）】順應玩家行動為因果核心；每輪必須在時間/空間/危機上有實質推進；每段結尾留懸念鉤子。';
  return base;
};

/**
 * 嚴格版 Meta 上下文（2-call 管線第 2 呼叫）：含敘事 + 摘要 + 白名單 + 數據契約
 */
window.buildStrictMetaContext = function (action, narrative, sceneHint) {
  const g = window.state.game;
  const scene = window.state.world?.scenes?.[g.scene] || {};
  let content = `【當前情勢】\n場景key：${g.scene}（${scene?.title || g.scene}）\n行動：${action}\n故事暗示場景：${sceneHint || g.scene}\n\n【玩家目前狀態】\n氣血: ${g.player.hp}/100\n靈力: ${g.player.sp}/100\n業力: ${g.player.threat}/100\n能力:\n${Object.entries(g.player.abilities || {}).map(([n, v]) => {
    const val = typeof v === 'object' && v !== null ? v.val : v;
    const tierInfo = window.getStatTier ? window.getStatTier(val) : { name: '凡胎' };
    if (typeof v === 'object' && v !== null) return `- ${n}: ${v.val} (範圍: ${v.min}-${v.max}, 階位: ${tierInfo.name})`;
    return `- ${n}: ${v} (階位: ${tierInfo.name})`;
  }).join('\n')}`;
  if (scene?.scene_exit?.length > 0) content += `\n可遷移區域（key白名單）：${scene.scene_exit.join('、')}`;
  content += `\n\n【重要：場景遷移指示】\n僅當行動或敘事明確移動到白名單內目標時，scene 才填目標「場景key」原文；否則填 null。`;
  content += `\n\n${window.OUTPUT_CONTRACTS.meta}`;
  return content;
};

/**
 * 從端點動態獲取可用模型清單 (支援多端點智慧容錯回退)
 */
window.fetchDynamicModels = async function() {
  const apiKey = window.selectors.apiKey?.value?.trim() || localStorage.getItem(window.SETTINGS.STORAGE_KEYS.apiKey) || '';
  const candidateUrls = window.CONFIG.candidateModelUrls || [window.CONFIG.modelsUrl];

  const headers = { 'Accept': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  let lastError = null;

  for (const url of candidateUrls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, {
        headers,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`API 回傳狀態碼: ${res.status}`);
      }

      const data = await res.json();
      const rawModelIds = [];

      // 1. OpenAI / NVIDIA NIM 標準格式：{ data: [{ id: "..." }] }
      if (data && Array.isArray(data.data)) {
        data.data.forEach(item => {
          if (typeof item === 'object' && item && item.id) {
            rawModelIds.push(String(item.id));
          } else if (typeof item === 'string') {
            rawModelIds.push(item);
          }
        });
      }
      // 2. Ollama 格式：{ models: [{ name: "..." }] }
      else if (data && Array.isArray(data.models)) {
        data.models.forEach(item => {
          const id = item.name || item.model || item.id;
          if (id) rawModelIds.push(String(id));
        });
      }
      // 3. 純陣列格式：[{ id: "..." }] 或 ["model-a", "model-b"]
      else if (Array.isArray(data)) {
        data.forEach(item => {
          if (typeof item === 'object' && item && item.id) rawModelIds.push(String(item.id));
          else if (typeof item === 'string') rawModelIds.push(item);
        });
      }

      const modelIds = [...new Set(rawModelIds.filter(id => Boolean(id && typeof id === 'string')))];

      if (modelIds.length > 0) {
        // 依小說推演推薦順序排序（優先排 gpt-oss、deepseek、qwen、llama、nemotron）
        modelIds.sort((a, b) => {
          const score = (name) => {
            const lower = name.toLowerCase();
            if (lower.includes('gpt-oss-120b')) return -20;
            if (lower.includes('gpt-oss')) return -18;
            if (lower.includes('deepseek-r1')) return -16;
            if (lower.includes('deepseek')) return -14;
            if (lower.includes('qwen3.5')) return -12;
            if (lower.includes('qwen')) return -10;
            if (lower.includes('llama-3.3')) return -8;
            if (lower.includes('llama')) return -6;
            if (lower.includes('nemotron')) return -4;
            return 0;
          };
          const diff = score(a) - score(b);
          if (diff !== 0) return diff;
          return a.localeCompare(b);
        });

        // 記錄最後成功擷取的端點網址
        window.state.lastModelEndpoint = url;
        // 快取至 localStorage
        localStorage.setItem(window.SETTINGS.STORAGE_KEYS.cachedModels, JSON.stringify(modelIds));
        return modelIds;
      }
    } catch (err) {
      console.warn(`[fetchDynamicModels] 端點 ${url} 連線失敗:`, err.message);
      lastError = err;
    }
  }

  if (lastError) {
    throw lastError;
  }
  return null;
};


