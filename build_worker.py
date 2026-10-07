# -*- coding: utf-8 -*-
import json
import os

with open('stories/tianyan_multiagent.json', 'r', encoding='utf-8') as f:
    tianyan = json.load(f)
with open('stories/taigu_jianyu.json', 'r', encoding='utf-8') as f:
    taigu = json.load(f)
with open('stories/natural_magic.json', 'r', encoding='utf-8') as f:
    magic = json.load(f)

embedded = {
    'tianyan': {
        'id': 'tianyan',
        'characters': tianyan.get('characters', {}),
        'scenes': tianyan.get('scenes', {}),
        'spatial_graph': tianyan.get('spatial_graph', {})
    },
    'taigu': {
        'id': 'taigu',
        'characters': taigu.get('characters', {}),
        'scenes': taigu.get('scenes', {}),
        'spatial_graph': taigu.get('spatial_graph', {})
    },
    'magic': {
        'id': 'magic',
        'characters': magic.get('characters', {}),
        'scenes': magic.get('scenes', {}),
        'spatial_graph': magic.get('spatial_graph', {})
    }
}
embedded['default'] = embedded['tianyan']
embedded['tianyan_multiagent'] = embedded['tianyan']
embedded['taigu_jianyu'] = embedded['taigu']
embedded['natural_magic'] = embedded['magic']
embedded['stories/tianyan_multiagent.json'] = embedded['tianyan']
embedded['stories/taigu_jianyu.json'] = embedded['taigu']
embedded['stories/natural_magic.json'] = embedded['magic']

stories_json = json.dumps(embedded, ensure_ascii=False)

worker_header = """/**
 * Cloudflare Worker - 天衍九州 全功能邊緣代理與世界模擬引擎
 * 支援:
 * 1. 自訂 / 多服務商 LLM API 轉發 (NVIDIA NIM / DeepSeek / OpenAI / OpenRouter 等)
 *    - GET  /v1/models          (模型清單查詢，支援 X-Target-URL / X-Base-URL)
 *    - POST /v1/chat/completions (劇情推演對話 / SSE 串流轉發，支援自訂端點)
 * 2. 邊緣世界模擬引擎 (原生 JavaScript 移植自 agent_flow_engine.py)
 *    - GET  /api/multiagent/characters  (查詢可魂穿角色清單)
 *    - POST /api/multiagent/transmigrate (玩家奪舍魂穿)
 *    - POST /api/multiagent/reset       (世界時鐘與警戒重置)
 *    - POST /api/multiagent/tick        (推進世界時鐘、NPC空間漫遊、破綻檢測)
 * 3. OPTIONS *                         (CORS 預檢請求)
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, X-Target-URL, X-Base-URL, X-Upstream-URL, X-Upstream-Base",
  "Access-Control-Max-Age": "86400",
};

const DEFAULT_INVOKE_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";

// 內建核心劇本空間圖與角色定義 (免外部依賴，純邊緣高速運算)
const EMBEDDED_STORIES = """ + stories_json + """;

/**
 * 因果網 多代理人魂穿核心調度器 (JavaScript 邊緣版)
 */
class MultiAgentEngine {
  constructor(storyId = "tianyan", customStory = null) {
    this.storyId = storyId;
    this.loadStory(storyId, customStory);
  }

  loadStory(storyId = "tianyan", customStory = null) {
    const raw = customStory || EMBEDDED_STORIES[storyId] || EMBEDDED_STORIES["default"] || {};
    this.storyId = storyId;
    this.characters = JSON.parse(JSON.stringify(raw.characters || {}));
    this.scenesMeta = this._normalizeScenesMeta(raw.scenes || {});
    this.spatialGraph = this._syncSpatialGraph(raw.spatial_graph || {}, this.scenesMeta);

    this.tick = 1;
    this.heavenAlert = 10;
    this.playerCharId = null;
    this.currentScene = "";
    this.worldEventLog = [];

    const firstScene = Object.keys(this.scenesMeta)[0] || "";
    this.charLocations = {};
    for (const [cid, cdata] of Object.entries(this.characters)) {
      this.charLocations[cid] = cdata.initial_scene || firstScene;
    }
  }

  syncState(state) {
    if (!state || typeof state !== "object") return;
    if (typeof state.tick === "number") this.tick = state.tick;
    if (typeof state.heaven_alert === "number") this.heavenAlert = state.heaven_alert;
    if (state.player_char_id) this.playerCharId = state.player_char_id;
    if (state.current_scene) this.currentScene = state.current_scene;
    if (state.char_locations && typeof state.char_locations === "object") {
      this.charLocations = { ...this.charLocations, ...state.char_locations };
    }
    if (state.npc_locations && typeof state.npc_locations === "object") {
      this.charLocations = { ...this.charLocations, ...state.npc_locations };
    }
    if (state.dissonance && this.playerCharId && this.characters[this.playerCharId]) {
      this.characters[this.playerCharId].dissonance = Number(state.dissonance) || 0.0;
    }
  }

  _normalizeScenesMeta(scenes) {
    if (Array.isArray(scenes)) {
      const out = {};
      for (const s of scenes) {
        if (!s || typeof s !== "object") continue;
        const key = s.id || s.key || s.scene || s.title;
        if (key) out[String(key)] = s;
      }
      return out;
    }
    if (scenes && typeof scenes === "object") return scenes;
    return {};
  }

  _isNullScene(value) {
    if (value === null || value === undefined) return true;
    const s = String(value).trim();
    if (!s) return true;
    return ["null", "none", "nan", "無"].includes(s.toLowerCase());
  }

  _buildSpatialGraphFromExits(scenesMeta) {
    const graph = {};
    for (const k of Object.keys(scenesMeta)) graph[k] = [];
    for (const [key, meta] of Object.entries(scenesMeta)) {
      const exits = Array.isArray(meta?.scene_exit) ? meta.scene_exit : [];
      for (const dst of exits) {
        if (!dst || typeof dst !== "string") continue;
        if (!graph[dst]) graph[dst] = [];
        if (!graph[key].includes(dst)) graph[key].push(dst);
        if (!graph[dst].includes(key)) graph[dst].push(key);
      }
    }
    for (const k of Object.keys(graph)) graph[k].sort();
    return graph;
  }

  _syncSpatialGraph(spatialGraph, scenesMeta) {
    const built = this._buildSpatialGraphFromExits(scenesMeta);
    if (!spatialGraph || typeof spatialGraph !== "object") return built;
    const synced = {};
    for (const [k, v] of Object.entries(spatialGraph)) {
      synced[k] = Array.isArray(v) ? [...new Set(v)] : [];
    }
    for (const k of Object.keys(scenesMeta)) {
      if (!synced[k]) synced[k] = [];
    }
    for (const [key, dsts] of Object.entries(built)) {
      if (!synced[key]) synced[key] = [];
      for (const dst of dsts) {
        if (!synced[key].includes(dst)) synced[key].push(dst);
      }
      synced[key].sort();
    }
    return synced;
  }

  listPlayableCharacters() {
    const playable = [];
    for (const [cid, char] of Object.entries(this.characters)) {
      if (char.playable) {
        playable.push({
          id: cid,
          name: char.name,
          title: char.title,
          initial_scene: char.initial_scene,
          profile: char.profile,
          physical_state: char.somatic_memory?.physical_state || "",
        });
      }
    }
    return playable;
  }

  resetWorld(storyId, customStory) {
    this.loadStory(storyId || this.storyId, customStory);
    return { tick: this.tick, heaven_alert: this.heavenAlert };
  }

  transmigrate(charId) {
    if (!this.characters[charId]) {
      throw new Error(`角色不存在: ${charId}`);
    }
    if (!this.characters[charId].playable) {
      throw new Error(`該角色不可被魂穿: ${charId}`);
    }

    this.playerCharId = charId;
    this.currentScene = this.charLocations[charId] || this.characters[charId].initial_scene || Object.keys(this.scenesMeta)[0] || "";
    this.charLocations[charId] = this.currentScene;
    const playerChar = this.characters[charId];

    const wakeUpText =
      `【神魂歸竅 · 魂穿奪舍】\\n` +
      `神識如穿過無量苦海，猛然墜入一具軀殼之中——\\n` +
      `你成了「${playerChar.name}」（${playerChar.title}）。\\n` +
      `軀體感官：${playerChar.somatic_memory?.physical_state || ""}\\n` +
      `當前位置：【${this.currentScene}】\\n` +
      `執念動機：${playerChar.agenda?.primary_goal || ""}`;

    return {
      tick: this.tick,
      heaven_alert: this.heavenAlert,
      player_id: this.playerCharId,
      character: playerChar.name,
      scene: this.currentScene,
      wake_up_text: wakeUpText,
      occupants: this.getSceneOccupants(this.currentScene),
      somatic_state: playerChar.somatic_memory?.physical_state || "",
    };
  }

  getSceneOccupants(sceneName) {
    const occupants = [];
    for (const [cid, loc] of Object.entries(this.charLocations)) {
      if (loc === sceneName) occupants.push(cid);
    }
    return occupants;
  }

  checkFlashback(contextText = "") {
    if (!this.playerCharId || !this.characters[this.playerCharId]) return [];
    const triggers = this.characters[this.playerCharId].somatic_memory?.flashback_triggers || {};
    const active = [];
    const occupants = this.getSceneOccupants(this.currentScene);
    const occupantNames = occupants.map(c => this.characters[c]?.name || c);

    for (const [triggerKey, fragment] of Object.entries(triggers)) {
      const charInfo = this.characters[triggerKey] || {};
      const charName = charInfo.name || "";
      const cleanName = charName.replace(/[（\(].*?[）\)]/g, "");
      const inBracketsMatch = charName.match(/[（\(](.*?)[）\)]/);
      const inBrackets = inBracketsMatch ? inBracketsMatch[1] : "";
      const charTitle = charInfo.title || "";
      const firstClause = (fragment || "").split(/[，、]/)[0];

      const matched = (
        contextText.includes(triggerKey) ||
        (charName && contextText.includes(charName)) ||
        (cleanName && cleanName.length >= 2 && contextText.includes(cleanName)) ||
        (inBrackets && inBrackets.length >= 2 && contextText.includes(inBrackets)) ||
        (charTitle && charTitle.length >= 2 && contextText.includes(charTitle)) ||
        (firstClause && firstClause.length >= 4 && contextText.includes(firstClause)) ||
        (contextText.length >= 4 && (fragment || "").includes(contextText)) ||
        triggerKey === this.currentScene ||
        occupants.includes(triggerKey) ||
        occupantNames.includes(triggerKey)
      );
      if (matched) {
        active.push({ fragment: fragment, source: triggerKey });
      }
    }
    return active;
  }

  evaluateDissonance(playerInput = "") {
    if (!this.playerCharId || !this.characters[this.playerCharId]) return 0.0;
    const pChar = this.characters[this.playerCharId];
    const text = String(playerInput || "").trim();
    if (text.length < 4) return 0.0;
    const normText = text.normalize ? text.normalize("NFKC") : text;
    const lower = normText.toLowerCase();

    const modernSlang = [
      "笑死", "搞毛", "牛逼", "老哥", "ok", "666", "系統", "系统",
      "開掛", "开挂", "臥槽", "卧槽", "牛批", "yyds", "bug", "cpu", "打call", "絕絕子", "绝绝子"
    ];
    let dissonance = 0.0;
    for (const slang of modernSlang) {
      if (lower.includes(slang)) dissonance += 0.15;
    }

    if (/(?<![大長長])哈{2,}(?![大長])/.test(normText) && !["大笑", "長笑", "长笑", "仰天"].some(w => normText.includes(w))) {
      dissonance += 0.10;
    }

    if (this.playerCharId === "char_duanjian" && (normText.includes("小女") || normText.includes("本姑娘"))) {
      dissonance += 0.25;
    } else if (this.playerCharId === "char_xian_shi" && normText.includes("求求")) {
      dissonance += 0.3;
    }
    pChar.dissonance = Math.min(1.0, (pChar.dissonance || 0.0) + dissonance);
    return Math.min(0.3, dissonance);
  }

  stepWorldTick(directorOutput = {}, metaOutput = {}) {
    this.tick += 1;

    // 1. 場景轉移檢查
    const rawScene = metaOutput.player_scene !== undefined ? metaOutput.player_scene : metaOutput.scene;
    let moveOk = true;
    let moved = false;
    let moveReason = null;

    if (!this._isNullScene(rawScene)) {
      const newScene = String(rawScene).trim();
      if (!this.playerCharId) {
        moveOk = false;
        moveReason = "not transmigrated";
      } else if (newScene === this.currentScene) {
        // 同場停留
      } else if (!this.scenesMeta[newScene]) {
        moveOk = false;
        moveReason = `unknown scene: ${newScene}`;
      } else {
        const curMeta = this.scenesMeta[this.currentScene] || {};
        const exits = Array.isArray(curMeta.scene_exit) ? curMeta.scene_exit : [];
        if (!exits.includes(newScene)) {
          moveOk = false;
          moveReason = `illegal move ${this.currentScene}→${newScene}`;
        } else {
          this.currentScene = newScene;
          this.charLocations[this.playerCharId] = newScene;
          moved = true;
        }
      }
    }

    // 2. 態度浮動 (三維全更新：trust, suspicion, fear)
    const attitudeChanges = Array.isArray(metaOutput.attitude_changes) ? metaOutput.attitude_changes : [];
    for (const change of attitudeChanges) {
      const npcId = change?.npc_id;
      if (npcId && this.characters[npcId]) {
        const matrix = this.characters[npcId].attitude_matrix || {};
        if (this.playerCharId && matrix[this.playerCharId]) {
          const curr = matrix[this.playerCharId];
          curr.trust = Math.max(-1.0, Math.min(1.0, (curr.trust || 0) + (Number(change.trust_delta) || 0)));
          curr.suspicion = Math.max(0.0, Math.min(1.0, (curr.suspicion || 0) + (Number(change.suspicion_delta) || 0)));
          curr.fear = Math.max(0.0, Math.min(1.0, (curr.fear || 0) + (Number(change.fear_delta) || 0)));
        }
      }
    }

    // 2b. NPC 明示遷移
    let rumors = [];
    const explicitMoved = new Set();
    const npcMovements = Array.isArray(metaOutput.npc_movements) ? metaOutput.npc_movements : [];
    for (const m of npcMovements) {
      if (!m || typeof m !== "object") continue;
      const npcId = m.npc_id;
      const toScene = m.to_scene;
      if (!npcId || !this.characters[npcId]) continue;
      if (!this.spatialGraph[toScene] && !this.scenesMeta[toScene]) continue;
      const prevLoc = this.charLocations[npcId];
      if (prevLoc === toScene) {
        explicitMoved.add(npcId);
        continue;
      }
      this.charLocations[npcId] = toScene;
      explicitMoved.add(npcId);
      if (toScene === this.currentScene && prevLoc !== this.currentScene) {
        rumors.push(`【身影乍現】${this.characters[npcId].name} 踏入了【${this.currentScene}】！`);
      }
    }

    // 3. 後台自主 NPC 依空間圖漫遊 (降低機率至 0.05)
    for (const [cid, loc] of Object.entries({ ...this.charLocations })) {
      if (explicitMoved.has(cid)) continue;
      if (cid !== this.playerCharId && loc !== this.currentScene) {
        if (Math.random() < 0.05 && this.spatialGraph[loc]) {
          const neighbors = this.spatialGraph[loc];
          if (neighbors && neighbors.length > 0) {
            const nextLoc = neighbors[Math.floor(Math.random() * neighbors.length)];
            this.charLocations[cid] = nextLoc;
            if (nextLoc === this.currentScene) {
              rumors.push(`【身影乍現】${this.characters[cid].name} 自遠處急行而來，踏入了【${this.currentScene}】！`);
            }
          }
        }
      }
    }

    // 傳聞去重
    rumors = [...new Set(rumors)];

    // 4. 天道警戒雙向結算（支援旗標與 threat 降壓）
    const flags = metaOutput.flags || {};
    let threatDelta = 0;
    if (metaOutput.impact && metaOutput.impact.threat !== undefined) {
      threatDelta = Number(metaOutput.impact.threat) || 0;
    } else if (metaOutput.threat !== undefined) {
      threatDelta = Number(String(metaOutput.threat).replace('+', '')) || 0;
    }
    const calmKeywords = ["斷信標", "断信标", "超度", "改命", "安撫", "安抚", "平息", "隱匿", "隐匿", "消弭", "沉寂", "避劫", "匿跡", "匿迹"];
    const calmHit = Object.keys(flags).some(k => calmKeywords.some(kw => k.includes(kw)) && flags[k]);
    if (calmHit || threatDelta < 0) {
      const relief = calmHit ? 15 : Math.abs(threatDelta);
      this.heavenAlert = Math.max(0, Math.min(100, this.heavenAlert - relief));
    } else {
      this.heavenAlert = Math.min(100, this.heavenAlert + 2);
    }

    for (const r of rumors) {
      this.worldEventLog.push(`[TICK ${this.tick}] ${r}`);
    }

    const attitudeSnapshot = {};
    for (const [cid, cdata] of Object.entries(this.characters)) {
      if (cid === this.playerCharId) continue;
      const matrix = cdata.attitude_matrix || {};
      if (this.playerCharId && matrix[this.playerCharId]) {
        const att = matrix[this.playerCharId];
        attitudeSnapshot[cid] = {
          trust: att.trust !== undefined ? att.trust : 0.0,
          suspicion: att.suspicion !== undefined ? att.suspicion : 0.3,
          fear: att.fear !== undefined ? att.fear : 0.0,
        };
      }
    }

    const occupantNames = this.getSceneOccupants(this.currentScene).map(
      (c) => this.characters[c]?.name || c
    );

    return {
      tick: this.tick,
      scene: this.currentScene,
      occupants: occupantNames,
      heaven_alert: this.heavenAlert,
      rumors: rumors,
      npc_locations: { ...this.charLocations },
      attitude_snapshot: attitudeSnapshot,
      moved: moved,
      move_ok: moveOk,
      move_reason: moveReason,
    };
  }
}

// 全域引擎單例 (若未帶 state 則維持記憶體狀態)
const globalEngine = new MultiAgentEngine("tianyan");

function resolveUpstreamUrl(request, env, defaultEndpoint, defaultPath) {
  const target = request.headers.get("x-target-url") || request.headers.get("x-upstream-url");
  if (target && target.trim()) return target.trim();

  const base =
    request.headers.get("x-base-url") ||
    request.headers.get("x-upstream-base") ||
    env?.UPSTREAM_API_BASE ||
    env?.CUSTOM_API_URL;
  if (base && base.trim()) {
    return `${base.trim().replace(/\\/+$/, "")}${defaultPath}`;
  }

  const url = new URL(request.url);
  const qTarget = url.searchParams.get("target") || url.searchParams.get("upstream");
  if (qTarget && qTarget.trim()) return qTarget.trim();

  return defaultEndpoint;
}

export default {
  async fetch(request, env) {
    // 1. CORS 預檢請求
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);

    // 2. 健康檢查與端點說明頁
    if (url.pathname === "/") {
      return new Response(
        `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>天衍九州 AI Novel 代理與世界引擎</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; line-height: 1.6; background: #121A12; color: #FDFBF7;">
  <h1 style="color: #e2c080;">天機代理 & 因果網世界引擎 (Cloudflare Worker) 運作正常 ⚡</h1>
  <p>本服務同時託管 <strong>LLM API 代理 (支援任意服務商)</strong> 與 <strong>多代理人世界引擎</strong>：</p>
  <ul>
    <li><code>GET /v1/models</code>: 實時查詢可用模型 (支援 <code>X-Target-URL</code> 自訂端點)</li>
    <li><code>POST /v1/chat/completions</code>: 劇情推演對話與 SSE 串流 (支援 <code>X-Target-URL</code> 自訂端點)</li>
    <li><code>GET /api/multiagent/characters</code>: 魂穿可選角色清單</li>
    <li><code>POST /api/multiagent/transmigrate</code>: 玩家魂穿奪舍角色</li>
    <li><code>POST /api/multiagent/reset</code>: 世界時鐘、警戒度與站位重置</li>
    <li><code>POST /api/multiagent/tick</code>: 世界時鐘推進、破綻檢測、NPC自主漂移</li>
  </ul>
</body>
</html>`,
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            ...CORS_HEADERS,
          },
        }
      );
    }

    // 3. 模型清單轉發 (GET /v1/models)
    if (url.pathname === "/v1/models") {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: { message: "Method Not Allowed" } }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      try {
        const targetUrl = resolveUpstreamUrl(request, env, DEFAULT_MODELS_URL, "/v1/models");
        const authHeader = request.headers.get("Authorization");
        const proxyHeaders = { Accept: "application/json" };
        if (authHeader) proxyHeaders["Authorization"] = authHeader;

        const response = await fetch(targetUrl, {
          method: "GET",
          headers: proxyHeaders,
        });

        const contentType = response.headers.get("content-type") || "application/json";
        return new Response(response.body, {
          status: response.status,
          headers: {
            "Content-Type": contentType,
            ...CORS_HEADERS,
          },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: { message: `Worker 模型端點轉發異常: ${err.message}` } }),
          {
            status: 502,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }
        );
      }
    }

    // 4. 劇情對話推演轉發 (POST /v1/chat/completions)
    if (url.pathname === "/v1/chat/completions") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: { message: "Method Not Allowed" } }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      try {
        const targetUrl = resolveUpstreamUrl(request, env, DEFAULT_INVOKE_URL, "/v1/chat/completions");
        const authHeader = request.headers.get("Authorization");
        const proxyHeaders = {
          "Content-Type": "application/json",
          Accept: request.headers.get("Accept") || "application/json",
        };
        if (authHeader) proxyHeaders["Authorization"] = authHeader;

        const response = await fetch(targetUrl, {
          method: "POST",
          headers: proxyHeaders,
          body: request.body,
        });

        const contentType = response.headers.get("content-type") || "application/json";
        return new Response(response.body, {
          status: response.status,
          headers: {
            "Content-Type": contentType,
            ...CORS_HEADERS,
          },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: { message: `Worker 劇情生成轉發異常: ${err.message}` } }),
          {
            status: 502,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }
        );
      }
    }

    // 5. 多代理人魂穿 API: 角色清單 (GET /api/multiagent/characters)
    if (url.pathname === "/api/multiagent/characters") {
      try {
        const storyId = url.searchParams.get("story_id") || "tianyan";
        if (storyId && globalEngine.storyId !== storyId) {
          globalEngine.loadStory(storyId);
        }
        return new Response(
          JSON.stringify({ characters: globalEngine.listPlayableCharacters() }),
          {
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }
        );
      } catch (err) {
        return new Response(JSON.stringify({ error: { message: err.message } }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
    }

    // 6. 多代理人魂穿 API: 奪舍接管 (POST /api/multiagent/transmigrate)
    if (url.pathname === "/api/multiagent/transmigrate") {
      try {
        const body = await request.json().catch(() => ({}));
        const charId = body.char_id;
        const storyId = body.story_id;
        const customStory = body.story_data || null;

        if (storyId && globalEngine.storyId !== storyId) {
          globalEngine.loadStory(storyId, customStory);
        }
        if (body.state) {
          globalEngine.syncState(body.state);
        }

        const res = globalEngine.transmigrate(charId);
        return new Response(JSON.stringify(res), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: { message: err.message } }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
    }

    // 7. 多代理人魂穿 API: 重置世界 (POST /api/multiagent/reset)
    if (url.pathname === "/api/multiagent/reset") {
      try {
        const body = await request.json().catch(() => ({}));
        const storyId = body.story_id;
        const customStory = body.story_data || null;
        const res = globalEngine.resetWorld(storyId, customStory);
        return new Response(JSON.stringify(res), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: { message: err.message } }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
    }

    // 8. 多代理人魂穿 API: 推進世界時鐘 (POST /api/multiagent/tick)
    if (url.pathname === "/api/multiagent/tick") {
      try {
        const body = await request.json().catch(() => ({}));
        const storyId = body.story_id;
        const customStory = body.story_data || null;
        if (storyId && globalEngine.storyId !== storyId) {
          globalEngine.loadStory(storyId, customStory);
        }
        if (body.state) {
          globalEngine.syncState(body.state);
        }

        const directorOutput = body.director_output || {};
        const metaOutput = body.meta_output || {};
        const playerInput = body.player_input || "";

        const dissonanceDelta = globalEngine.evaluateDissonance(playerInput);
        const stepRes = globalEngine.stepWorldTick(directorOutput, metaOutput);
        stepRes.dissonance_delta = dissonanceDelta;
        const combinedContext = `${playerInput} ${directorOutput.reveal || ""} ${directorOutput.dramatic_conflict || ""}`;
        stepRes.flashbacks = globalEngine.checkFlashback(combinedContext);

        return new Response(JSON.stringify(stepRes), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: { message: err.message } }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
    }

    // 9. 404
    return new Response(JSON.stringify({ error: { message: "Route Not Found" } }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  },
};
"""

with open('cloudflare_worker.js', 'w', encoding='utf-8') as f:
    f.write(worker_header)

print("cloudflare_worker.js built successfully!")
