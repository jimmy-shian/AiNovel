# Cloudflare Worker 代理腳本 (天衍九州)

本專案之 Cloudflare Worker 代理服務程式碼，提供 `/v1/chat/completions` (劇情推演) 與 `/v1/models` (實時模型清單) 的跨域代理轉發與 CORS 標頭封裝。

```javascript
/**
 * Cloudflare Worker - NVIDIA NIM API 代理轉發服務 (天衍九州)
 * 支援:
 * - GET  /v1/models          (實時動態模型清單)
 * - POST /v1/chat/completions (劇情推演對話 / SSE 串流轉發)
 * - OPTIONS *                (CORS 預檢)
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    // ✅ 1. CORS 預檢請求處理
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);

    // ✅ 2. 根目錄狀態檢查畫面
    if (url.pathname === "/") {
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>天衍九州 AI Novel 代理服務</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; line-height: 1.6; background: #121A12; color: #FDFBF7;">
          <h1 style="color: #e2c080;">天機代理 (Cloudflare Worker) 運作正常 ⚡</h1>
          <p>已支援端點：</p>
          <ul>
            <li><code>GET /v1/models</code>: 實時查詢 NVIDIA NIM 可用模型清單</li>
            <li><code>POST /v1/chat/completions</code>: 劇情推演對話與 SSE 串流生成</li>
          </ul>
        </body>
        </html>
      `, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...CORS_HEADERS
        }
      });
    }

    // ✅ 3. 動態模型清單轉發 (GET /v1/models)
    if (url.pathname === "/v1/models") {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: { message: "Method Not Allowed" } }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }

      try {
        const authHeader = request.headers.get("Authorization");
        const proxyHeaders = { "Accept": "application/json" };
        if (authHeader) proxyHeaders["Authorization"] = authHeader;

        const response = await fetch("https://integrate.api.nvidia.com/v1/models", {
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
        return new Response(JSON.stringify({
          error: { message: `Worker 模型端點轉發異常: ${err.message}` }
        }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }
    }

    // ✅ 4. 劇情生成對話轉發 (POST /v1/chat/completions)
    if (url.pathname === "/v1/chat/completions") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: { message: "Method Not Allowed" } }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }

      try {
        const authHeader = request.headers.get("Authorization");
        const proxyHeaders = {
          "Content-Type": "application/json",
          "Accept": request.headers.get("Accept") || "application/json"
        };
        if (authHeader) proxyHeaders["Authorization"] = authHeader;

        const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
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
        return new Response(JSON.stringify({
          error: { message: `Worker 劇情生成轉發異常: ${err.message}` }
        }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }
    }

    // ❌ 5. 未定義路徑
    return new Response(JSON.stringify({ error: { message: "Route Not Found" } }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  },
};
```

## 佈署步驟
1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com/) ➜ 點選 **Workers & Pages**。
2. 點選您的 Worker 專案（例如 `restless-hat-8ef5`）➜ 進入 **Edit code**。
3. 將上述完整程式碼貼上取代原有內容。
4. 點擊右上角 **Deploy** 儲存發佈。

