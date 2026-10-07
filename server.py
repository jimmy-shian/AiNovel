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
from typing import Optional, Dict, Any
import httpx
import json
import os
from pathlib import Path

app = FastAPI(title="天衍九州 AI 敘事伺服器")

# 允許跨域請求（避免 wildcard + credentials=True 違反瀏覽器 CORS 規範）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
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

# 快取 world.json，避免每輪多次磁碟 IO 與重複 json.load
_world_cache = {"mtime": 0.0, "data": {}}

def get_world_data() -> dict:
    world_path = Path("world.json")
    if not world_path.exists():
        return {}
    try:
        mtime = world_path.stat().st_mtime
        if _world_cache["mtime"] != mtime:
            with open(world_path, "r", encoding="utf-8") as f:
                _world_cache["data"] = json.load(f)
            _world_cache["mtime"] = mtime
    except Exception as e:
        print(f"Error caching world.json: {e}")
    return _world_cache["data"]

@app.get("/v1/models")
async def models_proxy(request: Request):
    headers = dict(request.headers)
    auth_header = headers.get("authorization") or headers.get("Authorization")
    if not auth_header or not auth_header.strip():
        raise HTTPException(status_code=401, detail="未提供授權憑證 (Authorization header missing)")

    proxy_headers = {
        "Accept": "application/json",
        "Authorization": auth_header.strip()
    }

    target_url = resolve_upstream(headers, MODELS_URL, "/v1/models")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(target_url, headers=proxy_headers)
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
    headers = dict(request.headers)
    auth_header = headers.get("authorization") or headers.get("Authorization")
    if not auth_header or not auth_header.strip():
        raise HTTPException(status_code=401, detail="未提供授權憑證 (Authorization header missing)")

    body = await request.json()
    is_stream = bool(body.get("stream", False))

    proxy_headers = {
        "Authorization": auth_header.strip(),
        "Content-Type": "application/json",
        "Accept": "text/event-stream" if is_stream else "application/json"
    }

    model_name = body.get("model", "unknown")
    target_url = resolve_upstream(headers, INVOKE_URL, "/v1/chat/completions")
    print(f"Forwarding request for model: {model_name} (stream={is_stream}) to {target_url}")

    try:
        if is_stream:
            client = httpx.AsyncClient(timeout=180.0)
            req = client.build_request("POST", target_url, headers=proxy_headers, json=body)
            r = await client.send(req, stream=True)

            if r.status_code != 200:
                content = await r.aread()
                await client.aclose()
                try:
                    error_data = json.loads(content.decode("utf-8"))
                    return JSONResponse(status_code=r.status_code, content=error_data)
                except Exception:
                    raise HTTPException(status_code=r.status_code, detail=content.decode("utf-8", errors="ignore"))

            async def generate():
                try:
                    async for line in r.aiter_lines():
                        if line:
                            yield line + "\n\n"
                except Exception as e:
                    print(f"Stream error: {e}")
                    yield f"data: {json.dumps({'error': {'message': str(e)}})}\n\n"
                finally:
                    await r.aclose()
                    await client.aclose()

            return StreamingResponse(generate(), media_type="text/event-stream")
        else:
            async with httpx.AsyncClient(timeout=180.0) as client:
                response = await client.post(target_url, headers=proxy_headers, json=body)
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
        print(f"Proxy error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ========== 天衍九州 多代理人魂穿 API ==========
from agent_flow_engine import MultiAgentEngine

# 引擎工作階段池：以 session_id + story_id 隔離不同玩家與分頁
_engines: Dict[str, MultiAgentEngine] = {}

def get_engine_for_request(session_id: str, story_id: Optional[str] = None) -> MultiAgentEngine:
    world = get_world_data()
    story_file = "stories/tianyan_multiagent.json"
    if story_id and story_id in world.get("stories", {}):
        story_file = world["stories"][story_id]["file"]
    
    key = f"{session_id}:{story_id or 'default'}"
    if key not in _engines:
        _engines[key] = MultiAgentEngine(story_file)
    else:
        # 故事檔案一致性守衛
        engine = _engines[key]
        if engine.story_file != story_file:
            engine.load_story(story_file)
    return _engines[key]

@app.get("/api/multiagent/characters")
async def get_playable_characters(request: Request, story_id: Optional[str] = None):
    session_id = request.headers.get("x-session-id") or request.query_params.get("session_id") or "default"
    engine = get_engine_for_request(session_id, story_id)
    return {"characters": engine.list_playable_characters()}

@app.post("/api/multiagent/transmigrate")
async def transmigrate_character(request: Request):
    body = await request.json()
    session_id = request.headers.get("x-session-id") or body.get("session_id") or "default"
    char_id = body.get("char_id")
    story_id = body.get("story_id")
    engine = get_engine_for_request(session_id, story_id)
    if body.get("state"):
        engine.sync_state(body.get("state"))
    try:
        res = engine.transmigrate(char_id)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/multiagent/reset")
async def reset_multiagent_world(request: Request):
    """顯式新局重置（取代 transmigrate 內隱式重置）：還原 tick/警戒/站位。"""
    body = await request.json()
    session_id = request.headers.get("x-session-id") or body.get("session_id") or "default"
    story_id = body.get("story_id")
    engine = get_engine_for_request(session_id, story_id)
    story_file = None
    if story_id:
        world = get_world_data()
        if story_id in world.get("stories", {}):
            story_file = world["stories"][story_id]["file"]
    res = engine.reset_world(story_file)
    return res

@app.post("/api/multiagent/tick")
async def process_tick(request: Request):
    body = await request.json()
    session_id = request.headers.get("x-session-id") or body.get("session_id") or "default"
    story_id = body.get("story_id")
    engine = get_engine_for_request(session_id, story_id)

    # 2-4: 同步前端傳入的 state（tick, heaven_alert, char_locations, current_scene）
    if body.get("state"):
        engine.sync_state(body.get("state"))

    director_output = body.get("director_output", {})
    meta_output = body.get("meta_output", {})
    player_input = body.get("player_input", "")

    # 破綻檢測
    dissonance_delta = engine.evaluate_dissonance(player_input)
    # 推進世界時鐘
    step_res = engine.step_world_tick(director_output, meta_output)
    step_res["dissonance_delta"] = dissonance_delta
    # 閃回檢測
    combined_context = f"{player_input} {director_output.get('reveal', '')} {director_output.get('dramatic_conflict', '')}"
    step_res["flashbacks"] = engine.check_flashback(combined_context)
    return step_res

# 掛載當前目錄作為靜態檔案服務 (放置在 API 路由之後)
BASE_DIR = Path(__file__).resolve().parent
app.mount("/", StaticFiles(directory=str(BASE_DIR), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    print("啟動天衍九州伺服器中...")
    print("存取網址: http://127.0.0.1:4444")
    uvicorn.run(app, host="127.0.0.1", port=4444)
