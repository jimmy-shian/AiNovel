/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/

 
 */
export default {
  async fetch(request, env) {

    // ✅ CORS 預檢
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    const url = new URL(request.url);

    // ✅ 首頁：顯示畫面
    if (url.pathname === "/") {
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>My Worker</title>
        </head>
        <body>
          <h1>Hello 👋</h1>
          <p>你的 Cloudflare Worker 已經成功運作！</p>
        </body>
        </html>
      `, {
        headers: {
          "Content-Type": "text/html"
        }
      });
    }

    // ✅ API 轉發
    if (url.pathname === "/v1/chat/completions") {

      const authHeader = request.headers.get("Authorization");

      const response = await fetch(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": authHeader,
            "Content-Type": "application/json",
          },
          body: request.body,
        }
      );

      return new Response(response.body, {
        status: response.status,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // ❌ 其他路徑
    return new Response("Not Found", { status: 404 });
  },
};