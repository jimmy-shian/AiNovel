/**
 * Cloudflare Worker - NVIDIA NIM API 代理轉發服務
 * 支援 /v1/chat/completions (劇情生成) 與 /v1/models (動態模型清單)
 */
export default {
  async fetch(request, env) {
    // ✅ 1. CORS 預檢（支援 GET, POST, OPTIONS）
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    const url = new URL(request.url);

    // ✅ 2. 首頁畫面
    if (url.pathname === "/") {
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>天衍九州 AI Novel 代理服務</title>
        </head>
        <body style="font-family: sans-serif; padding: 40px; line-height: 1.6; background: #121A12; color: #FDFBF7;">
          <h1 style="color: #e2c080;">Hello 👋</h1>
          <p>天衍九州 Cloudflare Worker 代理服務已成功運作中！</p>
          <ul>
            <li><code>POST /v1/chat/completions</code>: 劇情推演串流轉發</li>
            <li><code>GET /v1/models</code>: 實時模型清單查詢</li>
          </ul>
        </body>
        </html>
      `, {
        headers: {
          "Content-Type": "text/html; charset=utf-8"
        }
      });
    }

    // ✅ 3. 動態模型清單轉發 (GET /v1/models)
    if (url.pathname === "/v1/models") {
      const authHeader = request.headers.get("Authorization");
      const headers = { "Accept": "application/json" };
      if (authHeader) headers["Authorization"] = authHeader;

      const response = await fetch("https://integrate.api.nvidia.com/v1/models", {
        method: "GET",
        headers: headers,
      });

      return new Response(response.body, {
        status: response.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // ✅ 4. 劇情生成對話轉發 (POST /v1/chat/completions)
    if (url.pathname === "/v1/chat/completions") {
      const authHeader = request.headers.get("Authorization");

      const response = await fetch(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": authHeader || "",
            "Content-Type": "application/json",
          },
          body: request.body,
        }
      );

      return new Response(response.body, {
        status: response.status,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // ❌ 其他未定義路徑
    return new Response("Not Found", { status: 404 });
  },
};
