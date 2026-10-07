# -*- coding: utf-8 -*-
import sys
if sys.platform.startswith('win'):
    import io
    if getattr(sys.stdout, 'encoding', '').lower() != 'utf-8':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    if getattr(sys.stderr, 'encoding', '').lower() != 'utf-8':
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
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

def resolve_upstream(headers: dict, default_endpoint: str, default_path: str) -> str:
    target = headers.get("x-target-url") or headers.get("X-Target-URL") or headers.get("x-upstream-url")
    if target and target.strip():
        return target.strip()
    base = headers.get("x-base-url") or headers.get("X-Base-URL") or headers.get("x-upstream-base")
    if base and base.strip():
        return base.strip().rstrip("/") + default_path
    return default_endpoint

@app.get("/v1/models")
async def models_proxy(request: Request):
    headers = dict(request.headers)
    auth_header = headers.get("authorization") or headers.get("Authorization")
    proxy_headers = {
        "Accept": "application/json"
    }
    if auth_header:
        proxy_headers["Authorization"] = auth_header

    target_url = resolve_upstream(headers, MODELS_URL, "/v1/models")
    try:
        response = requests.get(
            target_url,
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
    
    auth_header = headers.get("authorization") or headers.get("Authorization")
    
    proxy_headers = {
        "Authorization": auth_header,
        "Content-Type": "application/json",
        "Accept": "text/event-stream" if body.get("stream") else "application/json"
    }

    model_name = body.get("model", "unknown")
    target_url = resolve_upstream(headers, INVOKE_URL, "/v1/chat/completions")
    print(f"Forwarding request for model: {model_name} (stream={body.get('stream')}) to {target_url}")

    try:
        response = requests.post(
            target_url,
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
        # 故事切換守衛：同故事魂穿不重載（維持世界心跳連續），僅換故事才重載
        try:
            with open("world.json", "r", encoding="utf-8") as f:
                world = json.load(f)
            if story_id in world.get("stories", {}):
                story_file = world["stories"][story_id]["file"]
                if multiagent_engine.story_file != story_file:
                    multiagent_engine.load_story(story_file)
        except Exception:
            pass
    try:
        res = multiagent_engine.transmigrate(char_id)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/multiagent/reset")
async def reset_multiagent_world(request: Request):
    """顯式新局重置（取代 transmigrate 內隱式重置）：還原 tick/警戒/站位。"""
    body = await request.json()
    story_id = body.get("story_id")
    story_file = None
    if story_id:
        try:
            with open("world.json", "r", encoding="utf-8") as f:
                world = json.load(f)
            if story_id in world.get("stories", {}):
                story_file = world["stories"][story_id]["file"]
        except Exception:
            pass
    res = multiagent_engine.reset_world(story_file)
    return res

@app.post("/api/multiagent/tick")
async def process_tick(request: Request):
    body = await request.json()
    # story_id 切換守衛：與 engine 當前故事不同才重新載入，避免每次 tick 重置世界時鐘
    story_id = body.get("story_id")
    if story_id:
        try:
            with open("world.json", "r", encoding="utf-8") as f:
                world = json.load(f)
            if story_id in world.get("stories", {}):
                story_file = world["stories"][story_id]["file"]
                if multiagent_engine.story_file != story_file:
                    multiagent_engine.load_story(story_file)
        except Exception:
            pass
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

