from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
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
    # 獲取 Authorization，相容不同大小寫
    auth_header = headers.get("authorization") or headers.get("Authorization")
    
    proxy_headers = {
        "Authorization": auth_header,
        "Content-Type": "application/json",
        "Accept": "text/event-stream" if body.get("stream") else "application/json"
    }

    model_name = body.get("model", "unknown")
    print(f"Forwarding request for model: {model_name} (stream={body.get('stream')})")

    try:
        response = requests.post(
            INVOKE_URL,
            headers=proxy_headers,
            json=body,
            stream=body.get("stream", False),
            timeout=60
        )
        
        print(f"NVIDIA API Response Status: {response.status_code}")

        if response.status_code != 200:
            try:
                error_data = response.json()
                return JSONResponse(status_code=response.status_code, content=error_data)
            except:
                raise HTTPException(status_code=response.status_code, detail=response.text)

        if body.get("stream"):
            def generate():
                try:
                    for line in response.iter_lines():
                        if line:
                            yield line.decode("utf-8") + "\n"
                except Exception as e:
                    print(f"Stream error: {e}")
                    yield f"data: {json.dumps({'error': {'message': str(e)}})}\n\n"
            return StreamingResponse(generate(), media_type="text/event-stream")
        else:
            return response.json()
    except Exception as e:
        print(f"Proxy error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=4444)
