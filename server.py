from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from typing import Optional
import requests
import json
import os
from pathlib import Path

app = FastAPI(title="天衍九州 AI 敘事伺服器")

# 允許跨域請求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INVOKE_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
MODELS_URL = "https://integrate.api.nvidia.com/v1/models"

@app.get("/v1/models")
async def models_proxy(request: Request):
    headers = dict(request.headers)
    auth_header = headers.get("authorization") or headers.get("Authorization")
    proxy_headers = {
        "Accept": "application/json"
    }
    if auth_header:
        proxy_headers["Authorization"] = auth_header

    try:
        response = requests.get(
            MODELS_URL,
            headers=proxy_headers,
            timeout=15
        )
        if response.status_code != 200:
            try:
                error_data = response.json()
                return JSONResponse(status_code=response.status_code, content=error_data)
            except Exception:
                raise HTTPException(status_code=response.status_code, detail=response.text)
        return response.json()
    except HTTPException:
        raise
    except Exception as e:
        print(f"Models proxy error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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
            timeout=180
        )
        
        print(f"NVIDIA API Response Status: {response.status_code}")

        if response.status_code != 200:
            try:
                error_data = response.json()
                return JSONResponse(status_code=response.status_code, content=error_data)
            except Exception:
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
    except HTTPException:
        raise
    except Exception as e:
        print(f"Proxy error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ========== 天衍九州 多代理人魂穿 API ==========
from agent_flow_engine import MultiAgentEngine
multiagent_engine = MultiAgentEngine()

@app.get("/api/multiagent/characters")
async def get_playable_characters(story_id: Optional[str] = None):
    if story_id:
        # 依故事動態讀取故事檔案
        with open("world.json", "r", encoding="utf-8") as f:
            world = json.load(f)
        if story_id in world.get("stories", {}):
            story_file = world["stories"][story_id]["file"]
            multiagent_engine.load_story(story_file)
    return {"characters": multiagent_engine.list_playable_characters()}

@app.post("/api/multiagent/transmigrate")
async def transmigrate_character(request: Request):
    body = await request.json()
    char_id = body.get("char_id")
    story_id = body.get("story_id")
    if story_id:
        with open("world.json", "r", encoding="utf-8") as f:
            world = json.load(f)
        if story_id in world.get("stories", {}):
            multiagent_engine.load_story(world["stories"][story_id]["file"])
    try:
        res = multiagent_engine.transmigrate(char_id)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/multiagent/tick")
async def process_tick(request: Request):
    body = await request.json()
    director_output = body.get("director_output", {})
    meta_output = body.get("meta_output", {})
    player_input = body.get("player_input", "")

    # 破綻檢測
    dissonance_delta = multiagent_engine.evaluate_dissonance(player_input)
    # 推進世界時鐘
    step_res = multiagent_engine.step_world_tick(director_output, meta_output)
    step_res["dissonance_delta"] = dissonance_delta
    return step_res

# 掛載當前目錄作為靜態檔案服務 (放置在 API 路由之後)
BASE_DIR = Path(__file__).resolve().parent
app.mount("/", StaticFiles(directory=str(BASE_DIR), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    print("啟動天衍九州伺服器中...")
    print("存取網址: http://127.0.0.1:4444")
    uvicorn.run(app, host="127.0.0.1", port=4444)

