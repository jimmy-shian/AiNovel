# 天衍九州 | AI 交互式敘事引擎

基於 NVIDIA NIM 相容 API（`integrate.api.nvidia.com`）的多劇本 AI 小說遊戲。前端為靜態網頁，透過本地或 Cloudflare 代理解決 CORS，呼叫 LLM 進行劇情推演與數值判定。

## 目錄

- [1. 快速開始](#quickstart)
  - [本地運行](#local) · [線上部署](#online)
- [2. 設定](#settings)
- [3. 系統架構](#architecture)
  - [目錄結構](#structure) · [回合流程](#pipeline) · [代理與模型](#proxy) · [存檔](#save)
- [4. 劇本開發](#stories)
  - [欄位定義](#story-fields) · [測試契約](#contracts) · [新增劇本](#new-story)
- [5. 常見問題](#faq)

---

<a id="quickstart"></a>
## 1. 快速開始

<a id="local"></a>
### 本地運行（推薦）

```bash
pip install fastapi uvicorn requests
python server.py
```

開啟 `http://127.0.0.1:4444`（`server.py` 同時提供靜態網頁與 API 代理），在「冥想配置」填入 NVIDIA API Key 並儲存。

<a id="online"></a>
### 線上部署

`push main` 即自動部署（`.github/workflows/static.yml`）。線上版（HTTPS）需搭配 Cloudflare Worker 代理，否則會因 CORS / Mixed Content 被阻擋。

| 場景 | 使用端點 |
| --- | --- |
| 本地 | `http://127.0.0.1:4444/v1/...`（`localProxy` / `localModels`） |
| 線上 Pages | 你的 Worker（`remoteProxy` / `remoteModels`） |
| 除錯直連 | `https://integrate.api.nvidia.com/v1/...`（需關閉「隱匿蹤跡」，不建議） |

> 詳細步驟見 [`cloudflare.md`](./cloudflare.md)。要點：將 `cloudflare_worker.js` 貼上 Worker 後，把 `js/config.js` 的 `ENDPOINTS.remoteProxy` / `remoteModels` 改為你的 Worker 網域。

---

<a id="settings"></a>
## 2. 設定

| 項目 | 說明 |
| --- | --- |
| API Key | NVIDIA NIM Key，只存瀏覽器 localStorage，不上傳至本專案 |
| 運算模型 | 「同步端點模型」從當前端點拉取清單（`GET /v1/models`），結果快取；失敗時回退內建清單（預設 `openai/gpt-oss-120b`） |
| 隱匿蹤跡 | 即 `useProxy`，預設開啟（必開）。關閉 = 直連 NVIDIA，僅除錯用 |

---

<a id="architecture"></a>
## 3. 系統架構

<a id="structure"></a>
### 目錄結構

| 路徑 | 說明 |
| --- | --- |
| `index.html` | 唯一頁面，掛載 `css/` 與 `js/` |
| `css/common.css`、`css/index.css` | 共用樣式 / 主頁樣式 |
| `js/config.js` | 版本、端點、預設模型、LLM 參數、localStorage key |
| `js/api.js` | prompt 組裝、payload 組裝、串流呼叫、模型清單同步（含 `OUTPUT_CONTRACTS`） |
| `js/game.js` | 回合流程、數值結算（`applyImpact`）、存讀檔 |
| `js/story-bible.js` | 歷史記憶切分（摘要 + 近 N 輪全文） |
| `js/validators.js` | POV、場景 key、Meta 格式校驗 |
| `js/utils.js` | JSON / 敘事 / Meta 容錯解析、數值解析 |
| `js/ui.js` | 渲染、打字機、快捷行動 |
| `app.js` | 初始化、設定儲存、事件綁定 |
| `server.py` | 本地代理 + 靜態託管（`:4444`） |
| `cloudflare_worker.js` | 線上代理（Worker 版 `server.py`） |
| `stories/*.json` → `build_world.py` → `world.json` | 劇本源檔 → 編譯索引（`world.json` 為產物，勿手改） |
| `tests/run_tests.py` | 全量校驗（含重建 `world.json`） |

<a id="pipeline"></a>
### 回合流程（2-call）

1. 玩家輸入 → `buildUnifiedStoryPrompt`（世界規則 + 狀態 + 場景 + 記憶 + 行動 + 敘事契約）→ LLM（串流）→ `{ narrative, scene_goal, dramatic_conflict, reveal, emotional_tone, ending_hook, scene_hint }`。
2. `buildStrictMetaContext`（狀態 + `scene_hint` + 白名單 + 數據契約）→ LLM（非串流）→ `{ hp, sp, threat, upd_ability, scene, options }`，增量一律顯式（如 `"+5"` / `"90/100"`）。
3. `validators.js` 校驗 → `applyImpact` 結算（能力單項增量絕對值 ≤ 3）→ 寫入 `history`（上限 15 輪）→ 渲染。

<a id="proxy"></a>
### 代理與模型

- 端點定義在 `SETTINGS.ENDPOINTS`：`localProxy` / `remoteProxy` / `direct` 及其 `*Models` 對應項。
- `CONFIG.isLocal`（localhost / 127.0.0.1 / file:）決定預設走本地或遠端；呼叫失敗按 `candidateProxyUrls` / `candidateModelUrls` 逐一重試。
- 各模型特化參數在 `SETTINGS.LLM`（`qwen` / `deepseek` / `gptOssReasoningHints`）。

<a id="save"></a>
### 存檔

| key | 用途 |
| --- | --- |
| `tianyan_api_key` / `tianyan_use_proxy` / `tianyan_selected_model` / `tianyan_cached_models` | 設定與模型快取 |
| 遊戲存檔（按劇本分 key，`SAVE_SCHEMA = 2`） | 進度；另支援存檔碼匯出 / 匯入 |

v1.5 存檔已斷代，舊檔只封存不遷移。

---

<a id="stories"></a>
## 4. 劇本開發

```bash
python build_world.py      # 由 stories/ 重建 world.json
python tests/run_tests.py  # 必跑：先重建 world.json 再全量校驗
```

<a id="story-fields"></a>
### 欄位定義（`stories/*.json`）

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `title`、`description` | 是 | 顯示用標題與簡介 |
| `globalPrompt`、`world_rules`、`main_mystery`、`main_arc` | 是 | 世界觀與主線，組進 story prompt |
| `prompts.director`、`prompts.narrative`、`prompts.meta` | 是 | 三段系統提示詞（director 職責已併入 narrative，保留欄位供相容） |
| `scenes` | 是 | 以場景 key 為鍵的字典；key 即遷移白名單 |
| `scenes[].title`、`location_core`、`scene_exit`、`npcs`、`choices` | 是 | `scene_exit` 只能填其他場景 key；`choices` 為預設選項參考 |
| `startingState` | 是 | `{ scene, player:{ name, hp, sp, threat, abilities }, history, current_arc, story_flags }` |
| `endings`、`coreMystery` | 否 | 結局與謎團設定 |

<a id="contracts"></a>
### 測試契約（`tests/run_tests.py` test 3，不滿足即失敗）

| 提示詞 | 必須包含關鍵字 |
| --- | --- |
| `director` | 「階位」或「門檻」 |
| `narrative` | 「窺徑」或「境界」＋「輸出契約 v1.5」＋「scene_hint」 |
| `meta` | 「門檻」或「消耗」＋「數據契約 v1.5」 |

數值契約（前端同樣強制）：`hp/sp/threat` 只收顯式增量或 `值/上限`；`upd_ability` 單項增量絕對值 ≤ 3；`scene` 只收場景 key 原文或 `null`，且有移動時必須在 `scene_exit` 白名單內。

<a id="new-story"></a>
### 新增劇本

1. 複製既有劇本為 `stories/<新id>.json`，改 `title` 與 `startingState.scene`（須存在於 `scenes`）。
2. 確認三段 `prompts` 含上表關鍵字。
3. `python tests/run_tests.py` 全綠後再 commit。

---

<a id="faq"></a>
## 5. 常見問題

- **儲存沒反應 / 同步模型失敗**：確認 `server.py` 運行中，且「隱匿蹤跡」已勾選；線上版請改用 HTTPS Worker。
- **舊存檔讀不到**：v1.5 存檔格式已斷代，舊檔會自動封存並開新局。
- **模型回傳亂碼 / 非 JSON**：前端有容錯解析（`js/utils.js`），重試一次即可；持續失敗請切換模型。

## 授權

僅供學習與研究使用。
