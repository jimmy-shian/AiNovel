# Cloudflare Worker 部署指南

線上版（GitHub Pages，HTTPS）無法直連本地代理或 NVIDIA API，需經 HTTPS Worker 轉發以解決 CORS。

> 原始碼唯一來源為 `cloudflare_worker.js`，本文件不再複製程式碼。改 Worker 請只改該檔。

## 端點

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| `GET` | `/` | 健康檢查頁 |
| `GET` | `/v1/models` | 轉發至 NVIDIA，取得可用模型清單 |
| `POST` | `/v1/chat/completions` | 轉發劇情推演（含 SSE 串流） |
| `OPTIONS` | `*` | CORS 預檢 |

轉發時僅透傳 `Authorization` / `Content-Type` / `Accept`，其餘 header 不轉發。

## 部署

1. 登入 Cloudflare Dashboard → **Workers & Pages**，建立或開啟 Worker。
2. **Edit code** → 將 `cloudflare_worker.js` 全文貼上 → **Deploy**。
3. 開啟 `https://<你的worker>.workers.dev/`，看到「天機代理運作正常」即成功。
4. 將 `js/config.js` 的 `ENDPOINTS.remoteProxy` / `remoteModels` 改為你的 Worker 網域，commit 後即對線上版生效。

前端路由邏輯（`js/config.js`）：`localhost` / `127.0.0.1` / `file:` 視為本地，走 `localProxy`；其餘走 `remoteProxy`。呼叫失敗時按 `candidateProxyUrls` / `candidateModelUrls` 順序自動換端點重試。

## 驗證

```bash
curl https://<你的worker>.workers.dev/v1/models \
  -H "Authorization: Bearer <NVIDIA_KEY>"
```

應回傳 `{"data": [{"id": "..."}, ...]}`。若回 `404` 為路徑錯誤，`502` 為 Worker 轉發異常（看 Worker Logs）。

## 與 server.py 的對應

| 場景 | 使用端點 |
| --- | --- |
| 本地 `python server.py` | `http://127.0.0.1:4444/v1/...`（`localProxy` / `localModels`） |
| 線上 Pages | 你的 Worker（`remoteProxy` / `remoteModels`） |
| 除錯直連 | `https://integrate.api.nvidia.com/v1/...`（需關閉「隱匿蹤跡」，不建議） |
