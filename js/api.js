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
    '1. 全程以玩家魂穿宿主的第一人稱「我」進行敘事，嚴禁以第二人稱「你」為主體超過 2 句。',
    '2. 僅回標準 JSON：{"narrative":"...","scene_goal":"...","dramatic_conflict":"...","reveal":"...","emotional_tone":"...","ending_hook":"...","scene_hint":"當前場景key或目標場景key" }',
    '3. narrative 350-550 字，結構：開篇承接玩家行動或奪舍醒轉（80-120字），中段【同場多名NPC同時交鋒對峙】（180-280字），結尾留下命途懸念鉤子（60-120字）。',
    '4. 【多人同時對話強制要求】：在場的多名 NPC 必須圍繞各自的故事走向同時參與局勢，互相言語試探或聯手施壓，嚴禁只描寫單一 NPC 發言！每位說話角色必須使用獨立行格式：『角色名：「對話內容」』。',
    '5. 嚴禁複述【場景氛圍】原文與前輪句子；每輪必須在時間、空間、因果或角色關係上有實質推進。',
    '6. 嚴禁數值/科技術語（HP→氣血/生機，SP→真元/神識/靈息，威脅→殺機/天劫預兆）。',
    '7. 若移動場景，scene_hint 必須填寫 scene_exit 白名單內的「場景key」原文；未移動則填當前場景key。',
  ].join('\n'),
  meta: [
    '【數據契約（必須遵守）】',
    '1. hp/sp/threat 一律用顯式相對增量（如 "+5"/"-10"/"+0"）或 "絕對值/上限"（如 "90/100"）；嚴禁回裸數字（如 "20"）。',
    '2. upd_ability 單項增量絕對值 ≤ +3，格式「名=+2/100」；無變動回 null。物件型數字視為絕對值。',
    '3. scene 必須是場景key原文或 null；有移動才填目標key，且必須在可遷移白名單內。',
    '4. options 3-4 個，含 1-2 個門檻/消耗項（【屬性≥N】/【消耗 N 靈力|生命|靈息|生機】），門檻需與玩家當前能力相容。',
    '5. flags：{"旗標名": true/false/數字}，僅回傳本輪敘事明確改變的旗標（未改變的旗標不可回填，避免覆蓋舊值）；無變動回 null。',
    '6. 完整回傳 JSON 欄位（缺一不可，與回傳格式取聯集；無值填 null 或 []）：{"hp","sp","threat","new_ability","upd_ability","scene","options","flags","has_more"}。',
  ].join('\n'),
};

// 新版（魂穿多代理劇本）Story 契約：narrative + 肉身閃回/破綻 + 調度神欄位合一
window.OUTPUT_CONTRACTS.story_transmigration = [
  '【輸出契約（必須遵守，否則會被系統退回重寫）】',
  '1. 全程以玩家魂穿宿主的第一人稱「我」進行敘事，嚴禁以第二人稱「你」為主體超過 2 句。',
  '2. 僅回標準 JSON：{"narrative":"...","flashback_fragment":"...","dissonance_reaction":"...","scene_goal":"...","dramatic_conflict":"...","reveal":"...","emotional_tone":"...","ending_hook":"...","world_rumor":"...","scene_hint":"當前場景key或目標場景key"}',
  '3. narrative 300-450 字，結構：開篇承接玩家行動或奪舍醒轉（80-120字），中段【同場多名NPC同時交鋒對峙】（150-250字），結尾留下命途懸念鉤子（50-100字）。',
  '4. 【多人同時對話強制要求】：在場的多名 NPC 必須圍繞各自的故事走向同時參與局勢，嚴禁只描寫單一 NPC 發言！每位說話角色必須使用獨立行格式：『角色名：「對話內容」』。',
  '5. flashback_fragment：宿主肉身記憶閃回一句（原身感官或記憶碎片）；dissonance_reaction：在場 NPC 對宿主言行破綻的即時反應一句；無則填 ""。',
  '6. world_rumor：遠方異動傳聞一句（不在場 NPC 自主推進的遠方動靜）；無則填 ""。',
  '7. 嚴禁複述【場景氛圍】原文與前輪句子；每輪必須在時間、空間、因果或角色關係上有實質推進。',
  '8. 嚴禁數值/科技術語（HP→氣血/生機，SP→真元/神識/靈息，威脅→殺機/天劫預兆）。',
  '9. 若移動場景，scene_hint 必須填寫 scene_exit 白名單內的「場景key」原文；未移動則填當前場景key。',
].join('\n');

// 新版（魂穿多代理劇本）Meta 契約：player_scene + 態度/遷移/破綻
window.OUTPUT_CONTRACTS.meta_transmigration = [
  '【數據契約（必須遵守）】',
  '1. hp/sp/threat 一律用顯式相對增量（如 "+5"/"-10"/"+0"）或 "絕對值/上限"（如 "90/100"）；嚴禁回裸數字（如 "20"）。',
  '2. upd_ability 單項增量絕對值 ≤ +3，格式「名=+2/100」；無變動回 null。',
  '3. player_scene 必須是場景key原文或 null；有移動才填目標key，且必須在可遷移白名單內。',
  '4. options（或 suggested_options）3-4 個，含 1-2 個門檻/消耗項（【屬性≥N】/【消耗 N 靈力|生命|靈息|生機】），門檻需與玩家當前能力相容。',
  '5. attitude_changes：[{"npc_id":"...","trust_delta":0.1,"suspicion_delta":-0.05}]，僅填在場 NPC 對宿主的態度浮動，單項 -0.2~+0.2，無變動回 []。',
  '6. npc_movements：[{"npc_id":"...","to_scene":"場景key"}]，僅當有 NPC 明確離開/進入本場景才填，否則回 []。',
  '7. dissonance_delta：宿主言行偏離原身性格程度 0.0~1.0，無偏離填 0.0。',
  '8. flags：{"旗標名": true/false/數字}，僅回傳本輪敘事明確改變的旗標（未改變的旗標不可回填，避免覆蓋舊值）；無變動回 null。',
  '9. 完整回傳 JSON 欄位（缺一不可，與回傳格式取聯集；無值填 null 或 []）：{"hp","sp","threat","new_ability","upd_ability","player_scene","options","attitude_changes","npc_movements","dissonance_delta","flags","has_more"}。',
].join('\n');

// 新版（多代理劇本但無 meta_transmigration 提示詞）Meta 契約：scene 式 + 態度/遷移/旗標
window.OUTPUT_CONTRACTS.meta_multiagent = [
  '【數據契約（必須遵守）】',
  '1. hp/sp/threat 一律用顯式相對增量（如 "+5"/"-10"/"+0"）或 "絕對值/上限"（如 "90/100"）；嚴禁回裸數字（如 "20"）。',
  '2. upd_ability 單項增量絕對值 ≤ +3，格式「名=+2/100」；無變動回 null。',
  '3. scene 必須是場景key原文或 null；有移動才填目標key，且必須在可遷移白名單內。',
  '4. options（或 suggested_options）3-4 個，含 1-2 個門檻/消耗項（【屬性≥N】/【消耗 N 靈力|生命|靈息|生機】），門檻需與玩家當前能力相容。',
  '5. attitude_changes：[{"npc_id":"...","trust_delta":0.1,"suspicion_delta":-0.05}]，僅填在場 NPC 對宿主的態度浮動，單項 -0.2~+0.2，無變動回 []。',
  '6. npc_movements：[{"npc_id":"...","to_scene":"場景key"}]，僅當有 NPC 明確離開/進入本場景才填，否則回 []。',
  '7. flags：{"旗標名": true/false/數字}，僅回傳本輪敘事明確改變的旗標（未改變的旗標不可回填，避免覆蓋舊值）；無變動回 null。',
  '8. 完整回傳 JSON 欄位（缺一不可，與回傳格式取聯集；無值填 null 或 []）：{"hp","sp","threat","new_ability","upd_ability","scene","options","attitude_changes","npc_movements","flags","has_more"}。',
].join('\n');

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
  };
  // 4-2: 只對 gpt-oss / openai 模型發送 response_format，避免 qwen/deepseek/llama 400 報錯
  const lowerModel = (model || '').toLowerCase();
  const isOpenAI = lowerModel.includes('gpt') || lowerModel.includes('openai');
  if (isOpenAI && base.response_format) {
    payload.response_format = base.response_format;
  }
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

  // 嘗試端點清單：使用代理時走 proxy 並透過 X-Target-URL 轉發自訂端點；關閉代理時直連
  const customChat = (window.CONFIG.customChatEndpoint || '').trim();
  const candidateUrls = window.CONFIG.useProxy
    ? (window.CONFIG.candidateProxyUrls || [window.CONFIG.proxyUrl])
    : (customChat ? [customChat] : [window.CONFIG.directUrl]);

  // 4-4: 逾時控制（Story 60s, Meta 30s）
  const timeoutMs = (kind === 'meta') ? 30000 : 60000;

  let lastError = null;
  for (const url of candidateUrls) {
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => {
      controller.abort(new Error(`API 呼叫逾時 (${timeoutMs / 1000} 秒)`));
    }, timeoutMs);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      if (window.CONFIG.useProxy && customChat) {
        headers['X-Target-URL'] = customChat;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
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
        clearTimeout(timeoutTimer);
        if (data.error) throw new Error(data.error.message || "API 內部錯誤");
        const content = data.choices?.[0]?.message?.content || "";
        if (onDelta && content) onDelta(content, content);
        return content;
      }

      // 串流模式（4-3: buffer 攢半行，只解析完整行；[DONE]跳出 while 並 cancel reader）
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";
      let isStreamDone = false;

      while (!isStreamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // 最後一段可能為未傳完的半行，留回緩衝區
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;
          const dataStr = trimmedLine.slice(6).trim();
          if (dataStr === '[DONE]') {
            isStreamDone = true;
            try { await reader.cancel(); } catch (_) {}
            break;
          }
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

      // 檢查殘留緩衝區
      if (buffer.trim() && !isStreamDone) {
        const trimmedLine = buffer.trim();
        if (trimmedLine.startsWith('data: ')) {
          const dataStr = trimmedLine.slice(6).trim();
          if (dataStr !== '[DONE]') {
            try {
              const data = JSON.parse(dataStr);
              const delta = data.choices?.[0]?.delta?.content || "";
              if (delta) {
                fullText += delta;
                if (onDelta) onDelta(delta, fullText);
              }
            } catch (_) {}
          }
        }
      }

      clearTimeout(timeoutTimer);
      return fullText;
    } catch (err) {
      clearTimeout(timeoutTimer);
      console.warn(`[streamAPICall] 端點 ${url} 呼叫失敗:`, err.message);
      lastError = err;
      // 若多個端點可用則繼續嘗試下一個
      if (candidateUrls.length > 1) continue;
      break;
    }
  }

  throw lastError || new Error("無法連接任何 AI 推理端點，請確認 server.py 是否啟動或網路正常。");
};

/**
 * 同場角色查詢 (新版多代理唯一真相來源：world.characters + initial/current_scene)
 * 舊版 scene.npcs 已棄用，僅作無 characters 劇本的向下相容回退。
 */
window.getInSceneCharacters = function(sceneKey, excludeCharId) {
  const allCharacters = window.state.world?.characters || {};
  const ids = Object.keys(allCharacters);
  if (ids.length === 0) return [];
  const me = excludeCharId || window.state.game?.player?.char_id;
  return Object.values(allCharacters).filter(c => {
    if (!c || c.id === me) return false;
    const live = window.state.game?.npc_state?.[c.id];
    const loc = live?.current_scene || c.current_scene || c.initial_scene;
    return loc === sceneKey;
  });
};

/**
 * @deprecated 舊劇本回退專用：scenes[].npcs 已棄用，真相來源為 characters + npc_state。
 * 僅當劇本無 characters 時由 buildUnifiedStoryPrompt / buildStrictMetaContext 調用；新劇本勿用。
 * 保留供舊測試 / 舊存檔相容。
 */
window.getSceneNpcFallbackText = function(scene) {
  if (!scene?.npcs?.length) return '';
  return scene.npcs.map(npc => {
    if (typeof npc === 'object' && npc !== null) {
      let desc = npc.name || '神秘人物';
      if (npc.relationship) desc += `（立場:${npc.relationship}）`;
      if (npc.speaking_style) desc += `（語氣:${npc.speaking_style}）`;
      return desc;
    }
    return String(npc);
  }).join('、');
};

/**
 * @deprecated 轉發殼（相容舊測試 / 舊存檔調用）。system prompt 組裝只走
 * narrative_transmigration / director_transmigration 精簡版（見 buildUnifiedStorySystem）。
 * 新代碼請直接調用 buildUnifiedStoryPrompt / buildStrictMetaContext。
 */
window.buildDirectorPrompt = function(action, isFirstMove) {
  if (window.buildUnifiedStoryPrompt) return window.buildUnifiedStoryPrompt(action, isFirstMove);
  return '';
};

/** @deprecated 同上：併入 buildUnifiedStoryPrompt 的薄轉發，保留供舊測試相容。 */
window.buildNarrativePromptWithDirector = function(action, directorPlan, isFirstMove) {
  if (window.buildUnifiedStoryPrompt) return window.buildUnifiedStoryPrompt(action, isFirstMove);
  return '';
};

/** @deprecated 舊別名，等價 buildNarrativePromptWithDirector。 */
window.buildNarrativePrompt = window.buildNarrativePromptWithDirector;

/** @deprecated 同上：併入 buildStrictMetaContext 的薄轉發，保留供舊測試相容。 */
window.buildMetaPromptContext = function(action) {
  const g = window.state.game || {};
  const lastNar = (g.history?.length ? (g.history[g.history.length - 1]?.result?.narrative || '') : '');
  if (window.buildStrictMetaContext) return window.buildStrictMetaContext(action, lastNar, g.scene);
  return '';
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
  const allCharacters = window.state.world?.characters || {};
  const playerChar = allCharacters[g.player.char_id] || {
    name: g.player.name || '無名宿主',
    title: '命運異數',
    agenda: { primary_goal: '斬破天道枷鎖，尋得生機', current_plan: '觀察四周危機' }
  };

  // 搜尋當前場景中在場的所有 NPC（排除玩家自身；唯一真相來源：npc_state > characters）
  const inSceneNpcs = window.getInSceneCharacters
    ? window.getInSceneCharacters(g.scene, g.player.char_id)
    : Object.values(allCharacters).filter(c => {
      if (!c || c.id === g.player.char_id) return false;
      const live = window.state.game?.npc_state?.[c.id];
      const loc = live?.current_scene || c.current_scene || c.initial_scene;
      return loc === g.scene;
    });
  // 後端多代理世界時鐘 (若曾與 /api/multiagent 同步則帶入，否則為本地初始值)
  const worldTick = window.state.multiagent?.tick ?? 1;
  const heavenAlert = window.state.multiagent?.heaven_alert ?? 10;

  let content = `【世界規則】\n${(window.state.world?.world_rules || []).join('\n')}\n主線謎團：${window.state.world?.main_mystery || window.state.world?.coreMystery?.truthHint || ''}`;
  if (window.state.world?.globalPrompt) content += `\n\n【世界觀全局設定】\n${window.state.world.globalPrompt}`;

  content += `\n\n【玩家魂穿宿主情報（你附身接管的肉身）】
宿主身份：${playerChar.name}（${playerChar.title}）
【宿主個人故事走向目標】：${playerChar.agenda?.primary_goal || '於天地浩劫中求生'}
【宿主當前破局方針】：${playerChar.agenda?.current_plan || '尋找盟友與線索'}
【肉身感知與狀態】：${playerChar.somatic_memory?.physical_state || g.player.somatic_state || '經脈靈息流轉'}
【原身慣用語氣】：${playerChar.somatic_memory?.baseline_tone || '冷靜凝重'}
【破綻張力警示】：你剛剛魂穿接管此肉身，言行若嚴重違背原身性格，在場 NPC 會起疑盤問！`;

  content += `\n\n【角色數值狀態】\n位置：${g.scene}（${scene.title || g.scene}）\n生命：${g.player.hp} | 靈力：${g.player.sp} | 業力：${g.player.threat}`;
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

  content += `\n\n【多代理世界時鐘】Tick ${worldTick}｜天道警戒 ${heavenAlert}/100（不在場 NPC 自主推進中，遠方異動將以傳聞回傳）`;

  content += `\n\n【當前場景資訊】\n名稱：${scene.title || g.scene}（key:${g.scene}）\n場景氛圍：${scene.location_core || scene.description || '四周充滿未知與危險'}`;

  // 注入在場 NPC 名單與他們各自的故事走向！
  if (inSceneNpcs.length > 0) {
    content += `\n\n【同場在場 NPC 名冊與各自的故事走向（各懷鬼胎，群像對峙）】`;
    inSceneNpcs.forEach((npc, idx) => {
      const liveAtt = window.state.game?.npc_state?.[npc.id];
      const attitude = liveAtt ? { trust: liveAtt.trust, suspicion: liveAtt.suspicion } : (npc.attitude_matrix?.[g.player.char_id] || { trust: 0.0, suspicion: 0.3 });
      content += `\n[角色 ${idx + 1}]：${npc.name}（${npc.title}）
- 他的故事走向目標：${npc.agenda?.primary_goal || '維持自身利益'}
- 他當前的行動算計：${npc.agenda?.current_plan || '暗中觀察'}
- 他的說話風格語氣：${npc.speaking_style || npc.somatic_memory?.baseline_tone || '神秘冷峻'}
- 對主角態度：信任度 ${attitude.trust}，猜疑度 ${attitude.suspicion}`;
    });

    content += `\n\n👉【群像多人交互強制指引】：
1. 本場景在場有多位角色，每個人都清楚知道自己要把故事帶往何方（各自的故事走向目標）！
2. 在本段敘事中，在場的 NPC 必須【同時參與對峙】，各自為了自己的故事走向開口爭辯、試探或逼迫主角！
3. 嚴禁只寫單一 NPC 發言！NPC 發言必須有獨立行對白格式：『角色名：「對話內容」』。`;
  } else if (Object.keys(allCharacters).length === 0 && scene?.npcs?.length > 0) {
    // 僅無 characters 的舊劇本回退
    const npcText = window.getSceneNpcFallbackText ? window.getSceneNpcFallbackText(scene) : '';
    if (npcText) content += `\n在場人物（舊劇本回退）：${npcText}`;
  }

  if (scene?.scene_exit?.length > 0) content += `\n可遷移區域（key白名單，只能選其一或不動；以後端 spatial_graph 已對齊，一律以 scene_exit 為準）：${scene.scene_exit.join('、')}`;
  content += `\n\n${mem}`;

  content += `\n\n【本輪玩家行動 / 推進節點】\n${isFirstMove ? '（【開局奪舍醒來】：描繪神魂墜入此肉身的衝擊與肉身感知，緊接著在場多位 NPC 同時圍繞在側、各自依自己的故事走向互相交鋒或盤問逼迫「我」，結尾留下命途懸念鉤子！）' : (action || '觀察四周，謀劃命途走向')}`;
  // Story 契約 story-aware：有 narrative_transmigration 的多代理劇本用新契約，舊劇本維持舊 7-key
  const hasSoulWriter = !!window.state.world?.prompts?.narrative_transmigration;
  content += `\n\n${hasSoulWriter && window.OUTPUT_CONTRACTS.story_transmigration ? window.OUTPUT_CONTRACTS.story_transmigration : window.OUTPUT_CONTRACTS.story}`;
  return content;
};

window.buildUnifiedStorySystem = function () {
  // system prompt 組裝只走 narrative_transmigration / director_transmigration 精簡版；
  // 舊 prompts.narrative / prompts.director 僅作無 transmigration 劇本的回退，不再單獨組裝注入。
  const soulWriter = window.state.world?.prompts?.narrative_transmigration;
  let base = soulWriter || window.NARRATIVE_PROMPT || '你是《天衍九州》的靈魂筆者，以第一人稱「我」寫作。';
  if (window.state.world?.globalPrompt) base += `\n\n【世界觀全局設定】\n${window.state.world.globalPrompt}`;
  // 導演職責併入：只取調度神職責本質（世界心跳/同場施壓/遠方傳聞），
  // 不整段注入 director_transmigration 原文（含未填充佔位符 {{TICK}} 等，且其二段 JSON 輸出規格會與契約衝突）
  const directorSoul = window.state.world?.prompts?.director_transmigration;
  if (directorSoul) {
    base += `\n\n【世界調度職責（併入本呼叫，不再單獨呼叫 LLM）】
- 世界心跳：多代理世界時鐘持續轉動；不在場 NPC 正自主推進各自的故事走向，遠方異動以一句傳聞寫入 world_rumor。
- 同場施壓：在場 NPC 各自為了自己的故事走向同時行動，對宿主言語試探、聯手施壓或逼迫表態。
- 因果推進：順應玩家行動為因果核心；每輪必須在時間、空間、因果或角色關係上有實質推進；結尾留下命途懸念鉤子。`;
  } else base += '\n\n【導演職責（併入本呼叫）】順應玩家行動為因果核心；每輪必須在時間/空間/危機上有實質推進；每段結尾留懸念鉤子。';
  // 輸出欄位優先權：魂穿筆者的【回傳格式】只有 3 鍵，與 user 端 10 鍵輸出契約衝突，明確裁示以 user 契約為準
  if (window.state.world?.prompts?.narrative_transmigration && window.OUTPUT_CONTRACTS.story_transmigration) {
    base += '\n\n【回傳欄位優先權】上方【回傳格式】僅說明前三個欄位的語意；實際回傳 JSON 欄位一律以 user 訊息末尾的「輸出契約」為準，narrative、flashback_fragment、dissonance_reaction、scene_goal、dramatic_conflict、reveal、emotional_tone、ending_hook、world_rumor、scene_hint 十個欄位缺一不可（無值填 ""）。';
  }
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
  // 故事旗標：結局條件（如 chainWeakened == false / acceptedHeavenSeal）依賴 LLM 在 flags 明示改變，
  // 但 LLM 之前看不到旗標名，永遠不會回填 → 結局永不觸發。這裡列出合併後的旗標現值。
  {
    const flagBag = { ...(g.flags || {}), ...(g.story_flags || {}) };
    const flagKeys = Object.keys(flagBag);
    if (flagKeys.length > 0) {
      content += `\n故事旗標：${flagKeys.map(k => `${k}=${JSON.stringify(flagBag[k])}`).join('、')}`;
      content += `\n（僅當本輪敘事明確改變某旗標時，才在 flags 回傳該鍵的新值；未改變的旗標不可回填）`;
    }
    // 結局條件引用但尚未設定的旗標也列出（如 chainWeakened / acceptedHeavenSeal），
    // 否則 LLM 不知道這些旗標存在，永遠不會回填 → 旗標型結局無法觸發。
    const endingFlagNames = new Set();
    Object.values(window.state.world?.endings || {}).forEach(e => {
      String(e?.condition || '')
        .replace(/visited\(\s*['"][^'"]+['"]\s*\)/g, ' ')
        .replace(/[A-Za-z_][A-Za-z0-9_]*/g, w => {
          if (w !== 'visited' && !/^(threat|hp|sp|true|false)$/i.test(w)) endingFlagNames.add(w);
          return w;
        });
    });
    const unsetEndingFlags = [...endingFlagNames].filter(k => flagBag[k] === undefined);
    if (unsetEndingFlags.length > 0) {
      content += `\n結局相關旗標（尚未確立）：${unsetEndingFlags.join('、')}`;
      content += `\n（若本輪敘事明確確立或改變上述任一結局相關事實，請在 flags 回傳該旗標名與 true/false 新值；未涉及則不回填）`;
    }
  }
  if (scene?.scene_exit?.length > 0) content += `\n可遷移區域（key白名單；以後端 spatial_graph 已對齊，一律以 scene_exit 為準）：${scene.scene_exit.join('、')}`;
  
  const allCharacters = window.state.world?.characters || {};
  const playerChar = allCharacters[g.player.char_id];
  if (playerChar) {
    content += `\n\n【宿主專屬故事走向目標】\n${playerChar.agenda?.primary_goal}\n（生成的 3-4 個 options 必須提供符合其命途走向或化解在場 NPC 試探逼問的具體行動）`;
  }

  // 新版多代理：同場 NPC 名冊（與 Story 第 1 呼叫同一真相來源 npc_state），供 attitude_changes / npc_movements 推理
  const inSceneForMeta = window.getInSceneCharacters
    ? window.getInSceneCharacters(g.scene, g.player.char_id)
    : [];
  if (inSceneForMeta.length > 0) {
    content += `\n\n【同場在場 NPC（態度/遷移判定對象，npc_id 必須用下列 ID 原文）】`;
    inSceneForMeta.forEach((npc) => {
      const live = window.state.game?.npc_state?.[npc.id];
      const trust = live ? live.trust : (npc.attitude_matrix?.[g.player.char_id]?.trust ?? 0);
      const susp = live ? live.suspicion : (npc.attitude_matrix?.[g.player.char_id]?.suspicion ?? 0.3);
      content += `\n- ${npc.name}（npc_id:${npc.id}｜目標:${npc.agenda?.primary_goal || '維持自身利益'}｜信任${trust} 猜疑${susp}）`;
    });
    content += `\n（attitude_changes 僅填上列在場 NPC；npc_movements 僅當有人明確離開/進入本場景才填，to_scene 須為白名單 key）`;
  } else if (Object.keys(allCharacters).length > 0) {
    content += `\n\n【同場在場 NPC】無（本場景僅宿主一人，attitude_changes 回 []，npc_movements 回 []）`;
  }

  // Meta 契約 story-aware：
  //  - 有 meta_transmigration 提示詞 → 新版契約（player_scene/attitude/movements/dissonance）
  //  - 有 characters 的多代理劇本（無 meta_transmigration）→ meta_multiagent（scene 式 + 態度/遷移）
  //  - 無 characters 的舊劇本 → meta
  const hasMetaTrans = !!window.state.world?.prompts?.meta_transmigration;
  const hasCharacters = Object.keys(allCharacters).length > 0;
  content += `\n\n【重要：場景遷移指示】\n僅當行動或敘事明確移動到白名單內目標時，${hasMetaTrans ? 'player_scene' : 'scene'} 才填目標「場景key」原文；否則填 null。`;
  if (hasMetaTrans && window.OUTPUT_CONTRACTS.meta_transmigration) {
    content += `\n\n${window.OUTPUT_CONTRACTS.meta_transmigration}`;
  } else if (hasCharacters && window.OUTPUT_CONTRACTS.meta_multiagent) {
    content += `\n\n${window.OUTPUT_CONTRACTS.meta_multiagent}`;
  } else {
    content += `\n\n${window.OUTPUT_CONTRACTS.meta}`;
  }
  return content;
};

/**
 * 新版 Meta 正規化：相容 transmigration 欄位別名
 * player_scene→scene, options/suggested_options, attitude_changes/npc_movements/dissonance 透傳
 */
window.normalizeTransmigrationMeta = function (meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = { ...meta };
  if (out.scene == null && out.player_scene != null) out.scene = out.player_scene;
  if (!out.options && Array.isArray(out.suggested_options)) out.options = out.suggested_options;
  if (out.dissonance_delta !== undefined && out.dissonance === undefined) out.dissonance = out.dissonance_delta;
  if (!Array.isArray(out.attitude_changes)) out.attitude_changes = [];
  if (!Array.isArray(out.npc_movements)) out.npc_movements = [];
  return out;
};

/**
 * 前端↔後端多代理世界時鐘同步 (graceful：靜態託管/file:// 無後端時靜默跳過)
 * 呼叫 POST /api/multiagent/tick，帶入 director/meta 最小輸出 + 玩家輸入
 */
window.syncMultiagentTick = async function (playerInput, storyData, meta) {
  try {
    const tickUrl = window.CONFIG?.getMultiagentUrl
      ? window.CONFIG.getMultiagentUrl('/api/multiagent/tick')
      : '/api/multiagent/tick';

    const npcLocations = {};
    if (window.state.game?.npc_state) {
      for (const [k, v] of Object.entries(window.state.game.npc_state)) {
        if (v && v.current_scene) npcLocations[k] = v.current_scene;
      }
    }

    const res = await fetch(tickUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        director_output: {
          scene_goal: storyData?.scene_goal || '',
          dramatic_conflict: storyData?.dramatic_conflict || '',
          reveal: storyData?.reveal || '',
        },
        meta_output: {
          player_scene: meta?.scene || null,
          attitude_changes: meta?.attitude_changes || [],
          npc_movements: (meta?.npc_movements || []).map(m => ({ npc_id: m.npc_id, to_scene: m.to_scene })),
        },
        player_input: playerInput || '',
        story_id: window.state.currentStoryId || null,
        state: {
          tick: window.state.game?.world_clock?.tick,
          heaven_alert: window.state.game?.world_clock?.heaven_alert,
          player_char_id: window.state.game?.player?.char_id,
          current_scene: window.state.game?.scene,
          char_locations: npcLocations,
          dissonance: window.state.game?.dissonance,
        },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    window.state.multiagent = {
      tick: data.tick ?? (window.state.multiagent?.tick || 1),
      heaven_alert: data.heaven_alert ?? (window.state.multiagent?.heaven_alert || 10),
      scene: data.scene || null,
      occupants: data.occupants || [],
      rumors: data.rumors || [],
      dissonance_delta: data.dissonance_delta ?? 0.0,
      // 後端 authoritative 對帳快照：全員站位 + 態度（game.js 用其對帳 npc_state）
      npc_locations: data.npc_locations || null,
      attitude_snapshot: data.attitude_snapshot || null,
    };
    return window.state.multiagent;
  } catch (_) {
    return null;
  }
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

      const reqHeaders = { ...headers };
      const customModels = (window.CONFIG.customModelsEndpoint || '').trim();
      if (window.CONFIG.useProxy && customModels && !url.includes(customModels)) {
        reqHeaders['X-Target-URL'] = customModels;
      }

      const res = await fetch(url, {
        headers: reqHeaders,
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


