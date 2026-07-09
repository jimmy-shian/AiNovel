// ========== LLM 與 API 調用服務 (API) ==========

window.buildSystemPromptForModel = function(model, baseSystemPrompt, enableThinking) {
  if (model.includes('gpt-oss')) {
    return baseSystemPrompt + (enableThinking ? window.SETTINGS.LLM.gptOssReasoningHints.high : window.SETTINGS.LLM.gptOssReasoningHints.low);
  }
  return baseSystemPrompt;
};

window.buildChatPayload = function(model, systemPrompt, userContent, enableThinking) {
  const base = window.SETTINGS.LLM.defaults;
  const payload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: base.temperature,
    top_p: base.top_p,
    max_tokens: base.max_tokens,
    stream: base.stream,
    response_format: base.response_format,
  };

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
window.streamAPICall = async function(systemPrompt, userContent, onDelta, enableThinking = true) {
  const apiKey = window.selectors.apiKey.value.trim();
  const url = window.CONFIG.useProxy ? window.CONFIG.proxyUrl : window.CONFIG.directUrl;
  const model = window.selectors.modelSelect.value;

  const finalSystemPrompt = window.buildSystemPromptForModel(model, systemPrompt, enableThinking);
  const payload = window.buildChatPayload(model, finalSystemPrompt, userContent, enableThinking);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error(`API 請求失敗 (${response.status})`);

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
};

window.buildDirectorPrompt = function(action, isFirstMove) {
  const g = window.state.game;
  const scene = window.state.world.scenes[g.scene];

  let content = `【世界規則】\n${(window.state.world.world_rules || []).join('\n')}\n主線謎團：${window.state.world.main_mystery || ''}`;

  content += `\n\n【當前階段 (Arc)】
目標：${g.current_arc?.goal || ''}
威脅：${g.current_arc?.villain || ''}
壓力：${g.current_arc?.pressure || ''}`;

  content += `\n\n【劇情狀態 (Flags)】
${JSON.stringify(g.story_flags || {})}`;

  content += `\n\n【當前場景：${scene?.title || g.scene}】
核心目標：${scene?.scene_goal || ''}
主要衝突：${scene?.scene_conflict || ''}
隱藏伏筆：${scene?.scene_twist || ''}
失敗後果：${scene?.scene_fail_state || ''}`;

  if (scene?.npcs?.length > 0) {
    content += `\n登場人物：\n${scene.npcs.map(n => `- ${n.name}: 目標[${n.goal}], 恐懼[${n.fear}], 關係[${n.relationship}]`).join('\n')}`;
  }

  content += `\n\n【玩家狀態】
  氣血 ${g.player.hp}/100, 靈力 ${g.player.sp}/100, 業力 ${g.player.threat}`;

  if (g.player.abilities && Object.keys(g.player.abilities).length > 0) {
    content += `\n能力：\n${Object.entries(g.player.abilities).map(([n, v]) => {
      if (typeof v === 'object') return `- ${n}: ${v.val} (範圍: ${v.min}-${v.max})`;
      return `- ${n}: ${v}`;
    }).join('\n')}`;
  }

  content += `\n\n【前情提要（最近兩輪的經歷，必須順著其脈絡向前推進，且嚴禁重跑相同的情節）】
${g.history?.slice(-2).map(h => `- 行動: ${h.action}\n- 結果: ${h.result?.narrative.slice(0, 150)}...`).join('\n') || '無'}`;

  if (action === "繼續敘事...") {
    content += `\n\n【當前任務】
故事在精彩處截斷了，請繼續接續上文進行敘事，保持張力並給出本段的小結或新的轉折。`;
  }

  content += `\n\n【玩家當前行動】\n${isFirstMove ? '正式開啟這場逆天之旅的第一幕。' : (action === "繼續敘事..." ? "（接續上文）" : action)}`;

  return content;
};

window.buildNarrativePromptWithDirector = function(action, plan, isFirstMove) {
  const g = window.state.game;
  const scene = window.state.world.scenes[g.scene];

  return `【導演規劃 (必須嚴格執行，推動故事實質前進，拒絕重複描寫)】
1. 本段目標：${plan.scene_goal}
2. 戲劇衝突：${plan.dramatic_conflict}
3. 情報揭露：${plan.reveal}
4. 結尾鉤子：${plan.ending_hook}

【場景細節 (僅供參考素材)】
- 地點：${scene?.title || g.scene}
- 環境：${scene?.location_core || ''}
- 人物：${(scene?.npcs || []).map(n => `${n.name}(說話風格:${n.speaking_style})`).join(', ')}

【玩家行動】
${isFirstMove ? '正式開啟這場逆天之旅的第一幕。' : action}

請開始撰寫敘事：`;
};

window.buildMetaPromptContext = function(action) {
  const g = window.state.game;
  const scene = window.state.world.scenes[g.scene];

  let content = `【當前情勢】
場景：${scene?.title || g.scene}
行動：${action}

【玩家目前狀態】
氣血: ${g.player.hp}/100
靈力: ${g.player.sp}/100
業力: ${g.player.threat}
能力:
${Object.entries(g.player.abilities || {}).map(([n, v]) => {
    if (typeof v === 'object') return `- ${n}: ${v.val} (範圍: ${v.min}-${v.max})`;
    return `- ${n}: ${v}`;
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
