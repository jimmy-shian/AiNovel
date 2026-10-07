# Cloudflare Worker 全功能邊緣部署指南 (天衍九州)

線上版（GitHub Pages，HTTPS）原生無 Python 後端，且瀏覽器直連外部 AI 服務商會遭遇 CORS 阻擋。
透過將 **多代理人世界引擎 (`agent_flow_engine.py`)** 與 **API 跨域轉發代理** 完整實作於 `cloudflare_worker.js`，線上版即可具備 100% 完整功力！

> **原始碼唯一來源為 `cloudflare_worker.js`**。修改 Worker 功能請直接維護該檔。

---

## 系統架構分工

| 元件 | 角色 | 功能說明 |
| --- | --- | --- |
| **GitHub Pages** | 靜態前端託管 | 託管 `index.html`、`js/`、`css/`、`stories/`，由 GitHub Actions 自動構建部署。 |
| **Cloudflare Worker** | 邊緣世界引擎 + 萬能 API 代理 | 1. 執行因果網世界引擎（時鐘推進、NPC漫遊、破綻檢測、魂穿奪舍）<br>2. 跨域免 CORS 轉發任意 LLM 服務商（NVIDIA、DeepSeek、OpenAI、OpenRouter 等） |
| **本地 `server.py`** | 本地開發外掛 | 本地單機測試（FastAPI + Uvicorn），提供 `http://127.0.0.1:4444` 開箱即用環境。 |

---

## Worker 支援端點

| 方法 | 路徑 | 類型 | 功能說明 |
| --- | --- | --- | --- |
| `GET` | `/` | 狀態監控 | 健康檢查頁面，顯示已啟用之功能與端點。 |
| `GET` | `/v1/models` | LLM 代理 | 動態模型清單查詢，支援透傳 `X-Target-URL` 自訂端點與 CORS 防護。 |
| `POST` | `/v1/chat/completions` | LLM 代理 | 劇情推演對話與 SSE 串流轉發（含完整 `\n\n` 分幀、`[DONE]` 透傳與 401 預防）。 |
| `GET` | `/api/multiagent/characters` | 世界引擎 | 查詢當前劇本所有可魂穿宿主清單（支援 `?story_id=`）。 |
| `POST` | `/api/multiagent/transmigrate` | 世界引擎 | 玩家神魂奪舍指定角色，回傳宿主感官、位置與開局描述（支援傳入 `state` 同步）。 |
| `POST` | `/api/multiagent/reset` | 世界引擎 | 顯式新局重置：還原世界時鐘 (`tick=1`)、天道警戒 (`alert=10`) 與全員初始站位。 |
| `POST` | `/api/multiagent/tick` | 世界引擎 | 推進 1 個世界滴答：雙向狀態同步 (`syncState`)、天道警戒雙向降壓 (善行 flags / threat)、確定性 NPC 漂移、三維態度向量 (`trust/suspicion/fear`)、肉身閃回直覺檢測 (`checkFlashback`)。 |
| `OPTIONS` | `*` | CORS | 預檢回應，開放跨域與自訂 Header。 |

---

## 自訂 API 端點與跨服務商支援

本 Worker 不僅限於 NVIDIA NIM，更能作為任意 OpenAI 相容服務商的免 CORS 代理通道：

1. **自訂目標 Header**：
   - `X-Target-URL`：指定上游目標完整網址（例：`https://api.deepseek.com/chat/completions` 或 `https://api.openai.com/v1/chat/completions`）。
   - `X-Base-URL`：指定上游基礎網址（例：`https://openrouter.ai/api/v1`）。
2. **前端設定介面**：
   - 點擊齒輪進入「冥想配置」：
     - **API Key**：輸入對應服務商的金鑰。
     - **自訂 Worker / 代理服務網址**：填入你的 Worker 網址（例如 `https://<你的worker>.workers.dev`）。
     - **自訂 Chat 端點**：填入如 `https://api.deepseek.com/chat/completions`。
     - **隱匿蹤跡 (勾選)**：前端會自動請求你的 Worker，Worker 透過 `X-Target-URL` 免 CORS 轉發至 DeepSeek/OpenAI。

---

## 部署步驟

### 方式 A：Cloudflare Dashboard 網頁部署（最推薦，1 分鐘完成）

1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com/) → 進入 **Workers & Pages**。
2. 點擊 **Create Application** → **Create Worker**（或開啟已存在的 Worker）。
3. 命名 Worker（例如 `tianyan-worker`）並點擊 **Deploy**。
4. 點擊 **Edit code**：
   - 將本專案中的 `cloudflare_worker.js` **全文複製並覆蓋貼上**。
5. 點擊右上角 **Deploy** 儲存發布。
6. 開啟你的 Worker 網址（`https://<你的worker>.workers.dev/`），看到「天機代理 & 因果網世界引擎 運作正常 ⚡」即代表部署成功！
7. （可選）將 `js/config.js` 中的 `remoteProxy` / `remoteModels` 改為你的 Worker 網址，或直接在網頁右上角齒輪設定中輸入。

### 方式 B：使用 Wrangler CLI 部署

若本機已安裝並登入 Wrangler：

```bash
# 1. 設置 Cloudflare Token 與 Account ID (或執行 npx wrangler login)
$env:CLOUDFLARE_API_TOKEN="<你的_CLOUDFLARE_API_TOKEN>"
$env:CLOUDFLARE_ACCOUNT_ID="<你的_ACCOUNT_ID>"

# 2. 自動編譯並部署
python build_worker.py
npx wrangler deploy
```

---

## 驗證測試

### 1. 驗證世界引擎角色清單
```bash
curl https://<你的worker>.workers.dev/api/multiagent/characters?story_id=tianyan
```
應回傳包含「蕭千絕（斷劍豪俠）」等可魂穿角色清單。

### 2. 驗證世界時鐘 Tick 推進與破綻檢測
```bash
curl -X POST https://<你的worker>.workers.dev/api/multiagent/tick \
  -H "Content-Type: application/json" \
  -d "{\"player_input\":\"哈！老哥笑死我了\",\"meta_output\":{\"player_scene\":\"scene_yuxu_hall\"},\"story_id\":\"tianyan\"}"
```
應回傳世界時鐘推進、破綻增量 `dissonance_delta > 0` 與天道警戒累加。

### 3. 驗證 LLM 模型代理 (預設 NVIDIA)
```bash
curl https://<你的worker>.workers.dev/v1/models \
  -H "Authorization: Bearer <YOUR_API_KEY>"
```

### 4. 驗證自訂服務商轉發 (以 DeepSeek 為例)
```bash
curl https://<你的worker>.workers.dev/v1/models \
  -H "Authorization: Bearer <DEEPSEEK_KEY>" \
  -H "X-Target-URL: https://api.deepseek.com/models"
```
