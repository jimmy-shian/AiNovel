from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import requests
import json
import os

app = FastAPI()

# 允許跨域請求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INVOKE_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

@app.post("/v1/chat/completions")
async def chat_proxy(request: Request):
    # 從前端請求中獲取數據
    body = await request.json()
    headers = dict(request.headers)
    
    # 過濾掉原本的 Host 等 headers，保留必要的 Authorization
    proxy_headers = {
        "Authorization": headers.get("authorization"),
        "Content-Type": "application/json",
        "Accept": "text/event-stream" if body.get("stream") else "application/json"
    }

    try:
        # 轉發請求到 NVIDIA API
        response = requests.post(
            INVOKE_URL,
            headers=proxy_headers,
            json=body,
            stream=body.get("stream", False)
        )

        if body.get("stream"):
            def generate():
                for line in response.iter_lines():
                    if line:
                        yield line.decode("utf-8") + "\n"
            return StreamingResponse(generate(), media_type="text/event-stream")
        else:
            return response.json()

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=4444)
