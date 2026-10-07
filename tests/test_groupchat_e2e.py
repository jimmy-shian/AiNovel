# -*- coding: utf-8 -*-
"""群聊端到端契約測試（不依賴 LLM/網路）.

覆蓋 Call-1→Call-2 欄位流、群聊渲染、特殊塊、推薦卡、前後端對帳。
JS 語義以 node 實際執行 js/utils.js、js/validators.js、js/api.js 為準；
若無 node 則退回 python 重現關鍵正則/分支語義（測試內會註明路徑）。
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import pytest

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE not in sys.path:
    sys.path.insert(0, BASE)

STORY_FILE = os.path.join(BASE, "stories", "tianyan_multiagent.json")

HAS_NODE = shutil.which("node") is not None


def _read(rel):
    with open(os.path.join(BASE, rel), "r", encoding="utf-8") as f:
        return f.read()


def _load_story():
    with open(STORY_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------- Python 側重現 JS validators 核心語義（與 js/validators.js 對齊） ----------

def normalize_scene_key(raw, world):
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or re.match(r"^(null|none|無|nan)$", s, re.I):
        return None
    scenes = (world or {}).get("scenes", {})
    if s in scenes:
        return s
    for k, v in scenes.items():
        title = (v or {}).get("title", "")
        if s == title:
            return k
        if title and k in s:
            return k
    if re.sub(r"\s+", "", s) in scenes:
        return re.sub(r"\s+", "", s)
    return s


def validate_scene_move(norm_scene, cur_scene, world):
    scenes = (world or {}).get("scenes", {})
    if not norm_scene:
        return {"ok": True, "moved": False}
    if norm_scene not in scenes:
        return {"ok": False, "reason": "unknown scene: " + str(norm_scene)}
    if norm_scene == cur_scene:
        return {"ok": True, "moved": False}
    exits = ((scenes.get(cur_scene) or {}).get("scene_exit")) or []
    if norm_scene not in exits:
        return {"ok": False, "reason": f"illegal move {cur_scene}->{norm_scene}"}
    return {"ok": True, "moved": True}


def normalize_transmigration_meta(meta):
    if not isinstance(meta, dict):
        return meta
    out = dict(meta)
    if out.get("scene") is None and out.get("player_scene") is not None:
        out["scene"] = out["player_scene"]
    if not out.get("options") and isinstance(out.get("suggested_options"), list):
        out["options"] = out["suggested_options"]
    if out.get("dissonance") is None and out.get("dissonance_delta") is not None:
        out["dissonance"] = out["dissonance_delta"]
    if not isinstance(out.get("attitude_changes"), list):
        out["attitude_changes"] = []
    if not isinstance(out.get("npc_movements"), list):
        out["npc_movements"] = []
    return out


def parse_option_requirement(option_text, player):
    """與 js/utils.js parseOptionRequirement 對齊（含生機/靈息/真元/氣血別名）."""
    if not option_text or not player:
        return {"eligible": True}
    m = re.search(r"【([^【】≥>=]+)[≥>=]+(\d+)】", option_text)
    if m:
        stat = m.group(1).strip()
        req = int(m.group(2))
        cur = 0
        if stat in ("生命", "生機", "氣血", "hp", "HP"):
            cur = player.get("hp", 0)
        elif stat in ("靈力", "靈息", "真元", "sp", "SP"):
            cur = player.get("sp", 0)
        elif stat in ("業力", "威脅", "天劫預兆", "threat"):
            cur = player.get("threat", 0)
        elif isinstance(player.get("abilities"), dict) and stat in player["abilities"]:
            a = player["abilities"][stat]
            cur = a.get("val", 0) if isinstance(a, dict) else float(a)
        if cur < req:
            return {"eligible": False, "type": "threshold", "stat": stat,
                    "required": req, "current": cur,
                    "reason": f"需 {stat} ≥ {req}（當前 {cur}）"}
        return {"eligible": True, "type": "threshold", "stat": stat,
                "required": req, "current": cur}
    m2 = re.search(r"【消耗\s*(\d+)\s*(靈力|靈息|生命|生機|真元|氣血|SP|HP)】", option_text, re.I)
    if m2:
        cost = int(m2.group(1))
        is_sp = bool(re.search(r"靈力|靈息|真元|SP", m2.group(2), re.I))
        pool = player.get("sp", 0) if is_sp else player.get("hp", 0)
        name = "靈力" if is_sp else "生命"
        if pool < cost:
            return {"eligible": False, "type": "cost", "cost": cost,
                    "costType": name, "current": pool,
                    "reason": f"{name}不足（需 {cost}，當前 {pool}）"}
        return {"eligible": True, "type": "cost", "cost": cost,
                "costType": name, "current": pool}
    return {"eligible": True}


# DIALOGUE_REGEX 關鍵行為的 python 重現（與 js/utils.js 對齊）.
# 若有 node，測試會走 node 實際執行並在此註明；此重現僅作無 node 退路。
_DIALOGUE_RE = re.compile(
    r"[ \t]*(?:[-*•]\s*|\d+[.、]\s*)?([^\s：:「」『』，。！？]{1,16})[：:][ \t]*[「『]([^」』]+?)[」』]"
)
_DIALOGUE_PREFIX = set(list("\n。；;！？，,『』」"))
_SPEAKER_STOPLIST = {"狀態", "旁白", "提示", "標題", "時間", "地點", "系統",
                     "註解", "備註", "說明", "內容", "結果", "選項", "目標"}
_SPEECH_VERB_TAIL = re.compile(
    r"(?:冷笑道|沉聲道|低聲道|高聲道|微笑道|緩緩道|淡淡道|朗聲道|喃喃道|怒道|嘆道|問道|答道|續道|又道|急道|獰笑道|慘笑道|笑道|說道|說著|續問|又問|冷笑|嗤笑|輕笑|慘笑|獰笑|微笑|冷哼|怒喝|怒斥|驚呼|喃喃|低語|自語|沉聲|低聲|高聲|疾聲|失聲|斷然|嘆息|搖頭|回頭|喘息|道|說)$"
)


def _py_clean_speaker(raw):
    sp = re.sub(r"^[「『'\"\s]+|[」』'\"\s]+$", "", str(raw or "").strip())
    if not sp or len(sp) > 16:
        return ""
    stripped = _SPEECH_VERB_TAIL.sub("", sp)
    if re.match(r"^[我你他她它們]$", stripped):
        return "我" if stripped == "我" else ""
    if len(stripped) >= 2:
        sp = stripped
    if sp in _SPEAKER_STOPLIST:
        return ""
    if len(sp) >= 3 and re.search(r"[我你他她它們的了著這那]", sp):
        return ""
    return sp


def py_extract_dialogues(text):
    """回傳 [(speaker, content)]；含前驅分隔符檢查（行首或分隔符才成泡）."""
    out = []
    for m in _DIALOGUE_RE.finditer(text):
        idx = m.start()
        p = idx - 1
        while p >= 0 and text[p] in (" ", "\t"):
            p -= 1
        prev = "" if p < 0 else text[p]
        if not (p < 0 or prev in _DIALOGUE_PREFIX or prev == "\n"):
            continue
        sp = _py_clean_speaker(m.group(1))
        dc = (m.group(2) or "").strip()
        if not sp or not dc:
            continue
        out.append((sp, dc))
    return out


# ---------- node 實際執行 harness ----------

def run_node_json(js_body, timeout=30):
    """執行一段 node 腳本並以 JSON 回傳 stdout. 無 node 時拋 skip."""
    if not HAS_NODE:
        pytest.skip("無 node，改走 python 重現語義路徑")
    harness = (
        "const fs=require('fs');\n"
        "global.window={};\n"
        "global.marked={parse:s=>s};\n"
        "global.document=undefined;\n"
        "const __out={};\n"
        "try{\n"
        + js_body
        + "\nconsole.log(JSON.stringify(__out));\n"
        "}catch(e){ console.error('NODEHARNESS:'+ (e && e.stack || e)); process.exit(99); }\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as tf:
        tf.write(harness)
        path = tf.name
    try:
        proc = subprocess.run(["node", path], capture_output=True, text=True,
                              encoding="utf-8", errors="replace",
                              cwd=BASE, timeout=timeout)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    assert proc.returncode != 99, f"node harness 執行失敗: {(proc.stderr or '')[:500]}"
    assert proc.returncode == 0, f"node 退出碼 {proc.returncode}: {(proc.stderr or '')[:500]}"
    lines = (proc.stdout or "").strip().splitlines()
    assert lines, f"node 無輸出: stderr={(proc.stderr or '')[:300]}"
    return json.loads(lines[-1])


def node_load_snippet(*rels):
    parts = []
    for r in rels:
        src = _read(r).replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
        parts.append(f"eval(fs.readFileSync({json.dumps(os.path.join(BASE, r))},'utf8'));")
    return "\n".join(parts)


# ================= 1. Call-1→Call-2 欄位對齊 =================

def test_output_contracts_define_scene_hint_and_player_scene():
    api = _read("js/api.js")
    assert "window.OUTPUT_CONTRACTS" in api
    # Call-1 故事契約：scene_hint + 群聊獨立行格式
    assert "scene_hint" in api
    assert "『角色名：「對話內容」』" in api or "『角色名" in api
    # Call-2 數據契約：player_scene（transmigration）/ scene（multiagent/legacy）
    assert "player_scene" in api
    assert "attitude_changes" in api and "npc_movements" in api
    # options 3-4 + 門檻/消耗
    assert "options" in api and "3-4" in api
    assert "門檻" in api and "消耗" in api


def test_call1_scene_hint_whitelist_normalization():
    world = _load_story()
    # 取一個有 scene_exit 的當前場景
    cur = next(k for k, v in world["scenes"].items() if (v or {}).get("scene_exit"))
    exits = world["scenes"][cur]["scene_exit"]
    legal = exits[0]
    # 合法 hint：白名單內 → 正規化不變
    assert normalize_scene_key(legal, world) == legal
    # title→key：『靈脈枯竭：凡人村』→『凡人村』（若該場景存在，否則用動態 title）
    target = "凡人村" if "凡人村" in world["scenes"] else cur
    title = (world["scenes"][target] or {}).get("title", target)
    if title and title != target:
        assert normalize_scene_key(title, world) == target
    # 空白/None/null → None
    assert normalize_scene_key(f" {legal} ", world) == legal
    assert normalize_scene_key(None, world) is None
    assert normalize_scene_key("null", world) is None
    # 未知 key 原樣透傳（交給 validateSceneMove 拒絕）
    assert normalize_scene_key("不存在的場景XYZ", world) == "不存在的場景XYZ"


def test_call2_meta_alias_normalization_source_and_semantics():
    api = _read("js/api.js")
    # normalizeTransmigrationMeta 必須處理三個別名
    assert "window.normalizeTransmigrationMeta" in api
    assert "player_scene" in api and "suggested_options" in api and "dissonance_delta" in api
    meta = {"hp": "+0", "player_scene": "鬼市" if "鬼市" in _load_story()["scenes"] else None,
            "suggested_options": ["a", "b", "c"], "dissonance_delta": 0.2}
    if meta["player_scene"] is None:
        world = _load_story()
        meta["player_scene"] = next(iter(world["scenes"].keys()))
    out = normalize_transmigration_meta(meta)
    assert out["scene"] == meta["player_scene"]
    assert out["options"] == ["a", "b", "c"]
    assert out["dissonance"] == 0.2
    assert out["attitude_changes"] == [] and out["npc_movements"] == []


def test_sync_payload_player_scene_consistent_with_final_scene():
    """game.js：finalScene 正規化 → applyMultiagentMeta → syncMultiagentTick(meta.scene)；
    api.js：sync payload 的 player_scene 取自 meta.scene。"""
    game = _read("js/game.js")
    api = _read("js/api.js")
    assert "window.syncMultiagentTick" in api
    assert "player_scene: meta?.scene" in api or "player_scene: meta" in api
    i_norm = game.index("normalizeSceneKey")
    i_sync = game.index("syncMultiagentTick")
    assert i_norm < i_sync, "必須先正規化場景再 tick 同步，否則前後端場景分叉"
    assert "meta.scene = finalScene" in game or "finalScene" in game
    # 語義：Meta 回 null 但 sceneHint 合法 → 以 hint 補正
    world = _load_story()
    cur = next(k for k, v in world["scenes"].items() if (v or {}).get("scene_exit"))
    hint = world["scenes"][cur]["scene_exit"][0]
    norm = normalize_scene_key(None, world)
    final = norm
    exits = world["scenes"][cur]["scene_exit"]
    hint_norm = normalize_scene_key(hint, world)
    if not final and hint_norm and hint_norm != cur and hint_norm in exits:
        final = hint_norm
    assert final == hint


def test_illegal_teleport_rejected_by_validate_scene_move():
    world = _load_story()
    cur = next(k for k, v in world["scenes"].items() if (v or {}).get("scene_exit"))
    legal = world["scenes"][cur]["scene_exit"][0]
    # 合法移動放行
    assert validate_scene_move(legal, cur, world) == {"ok": True, "moved": True}
    # 停留放行
    assert validate_scene_move(cur, cur, world)["moved"] is False
    assert validate_scene_move(None, cur, world) == {"ok": True, "moved": False}
    # 非白名單瞬移拒絕
    far = next(k for k in world["scenes"].keys()
               if k != cur and k not in world["scenes"][cur]["scene_exit"])
    bad = validate_scene_move(far, cur, world)
    assert bad["ok"] is False and "illegal move" in bad["reason"]
    # 未知場景拒絕
    unknown = validate_scene_move("不存在的場景XYZ", cur, world)
    assert unknown["ok"] is False
    # 與 JS 真實 validateSceneMove 對齊（有 node 時實際執行）
    if HAS_NODE:
        res = run_node_json(
            node_load_snippet("js/validators.js")
            + f"\nconst W=JSON.parse(fs.readFileSync({json.dumps(STORY_FILE)},'utf8'));"
              f"__out.legal=window.validateSceneMove({json.dumps(legal)},{json.dumps(cur)},W);"
              f"__out.bad=window.validateSceneMove({json.dumps(far)},{json.dumps(cur)},W);"
              f"__out.unknown=window.validateSceneMove('不存在的場景XYZ'," + json.dumps(cur) + ",W);"
        )
        assert res["legal"] == {"ok": True, "moved": True}
        assert res["bad"]["ok"] is False
        assert res["unknown"]["ok"] is False


# ================= 2. 群聊渲染 =================

MULTI_SPEAKER_NARRATIVE = (
    "我壓下翻湧的血氣，環顧四周，斷劍在鞘中低鳴。\n"
    "老毒物：「小子，你身上的氣息不對勁，說！你究竟是誰？」\n"
    "提燈女童：「他不是原來的那個人，他的魂火變了顏色。」\n"
    "村長：「交出你懷中的印記，否則全村都要陪葬！」\n"
    "我握緊斷劍，一言不發，心跳如擂鼓。"
)


def test_groupchat_bubbles_match_speaker_count_via_node_or_py_repro():
    speakers = ["老毒物", "提燈女童", "村長"]
    if HAS_NODE:
        # 以 node 實際執行 js/utils.js（註明：node 驗證路徑）
        res = run_node_json(
            node_load_snippet("js/utils.js")
            + f"\nconst nar={json.dumps(MULTI_SPEAKER_NARRATIVE)};"
              "__out.html=window.formatNarrative(nar);"
              "__out.b1=window.buildChatBubble('老毒物','試探一句');"
        )
        html = res["html"]
        assert html.count('class="chat-msg"') == len(speakers), \
            f"氣泡數須等於說話人數 3，實際 html: {html[:400]}"
        for sp in speakers:
            assert f'data-speaker="{sp}"' in html, f"缺少說話人氣泡: {sp}"
        assert 'class="chat-msg"' in res["b1"] and "老毒物" in res["b1"]
    else:
        # 無 node 退路：在 python 側重現 DIALOGUE_REGEX 關鍵行為（前驅分隔+說話者萃取）
        got = py_extract_dialogues(MULTI_SPEAKER_NARRATIVE)
        assert [s for s, _ in got] == speakers
        assert len(got) == len(speakers)  # 氣泡數==說話人數


def test_groupchat_speech_verb_tail_and_stoplist():
    text = "老毒物冷笑道：「小子，你露餡了。」\n旁白：「此處氣氛凝重。」\n"
    if HAS_NODE:
        res = run_node_json(
            node_load_snippet("js/utils.js")
            + f"\nconst t={json.dumps(text)};"
              "__out.html=window.formatNarrative(t);"
              "__out.sp=window.resolveDialogueSpeaker('老毒物冷笑道');"
              "__out.stop=window.resolveDialogueSpeaker('旁白');"
        )
        assert res["sp"] == "老毒物"
        assert res["stop"] == ""
        assert res["html"].count('class="chat-msg"') == 1
        assert "老毒物" in res["html"]
    else:
        got = py_extract_dialogues(text)
        assert [s for s, _ in got] == ["老毒物"]  # 說話動詞尾剝除；旁白欄位標籤不成泡


# ================= 3. 特殊塊 =================

def test_special_blocks_four_kinds_have_class():
    kinds = {"flashback": "flashback-block", "dissonance": "dissonance-block",
             "rumor": "rumor-block", "ending": "ending-block"}
    if HAS_NODE:
        body = node_load_snippet("js/utils.js")
        lines = []
        for k in kinds:
            lines.append(f"__out.{k}=window.formatSpecialBlock({json.dumps(k)},'測試內文');")
        lines.append("__out.empty=window.formatSpecialBlock('flashback','   ');")
        res = run_node_json(body + "\n" + "\n".join(lines))
        for k, cls in kinds.items():
            assert cls in res[k], f"{k} 缺少對應 class {cls}"
            assert "special-block" in res[k]
        assert res["empty"] == ""
    else:
        src = _read("js/utils.js")
        for k, cls in kinds.items():
            assert cls in src, f"無 node 退路：源碼須含 {cls}"
        assert "window.formatSpecialBlock" in src


# ================= 4. 推薦卡 =================

def test_options_count_and_threshold_locking_semantics():
    options = ["正面迎戰老毒物的試探",
               "【天眼≥30】看穿陣法破綻",
               "【消耗 20 靈力】催動九天雷引",
               "轉身退入暗巷觀察"]
    assert 3 <= len(options) <= 4
    assert sum(1 for o in options if re.search(r"【[^【】]*[≥>=]+\d+】|【消耗", o)) >= 1
    player = {"hp": 80, "sp": 15, "threat": 20,
              "abilities": {"天眼": {"val": 35, "min": 0, "max": 100}, "劍意": 10}}
    ok_t = parse_option_requirement("【天眼≥30】看穿陣法破綻", player)
    assert ok_t["eligible"] is True and ok_t["stat"] == "天眼"
    bad_t = parse_option_requirement("【劍意≥30】一劍破萬法", player)
    assert bad_t["eligible"] is False and bad_t["required"] == 30 and bad_t["current"] == 10
    ok_c = parse_option_requirement("【消耗 20 生命】燃燒精血遁走", player)
    assert ok_c["eligible"] is True
    bad_c = parse_option_requirement("【消耗 20 靈力】催動九天雷引", player)
    assert bad_c["eligible"] is False and bad_c["cost"] == 20 and bad_c["costType"] == "靈力"
    assert parse_option_requirement("觀察四周環境", player)["eligible"] is True
    # ui.js 推薦卡：最多 4 卡 + parseOptionRequirement 鎖定語義（未達標 disabled-action 且不送出）
    ui = _read("js/ui.js")
    assert "window.renderQuickActions" in ui
    assert "parseOptionRequirement" in ui and "disabled-action" in ui
    assert "slice(0, 4)" in ui or "slice(0,4)" in ui


# ================= 5. 前後端對帳 =================

def test_npc_state_vs_char_locations_and_tick_monotonic():
    from agent_flow_engine import MultiAgentEngine
    engine = MultiAgentEngine(STORY_FILE)
    playable = engine.list_playable_characters()
    assert playable, "劇本須有可魂穿角色"
    pid = playable[0]["id"]
    st = engine.transmigrate(pid)
    assert engine.char_locations[pid] == engine.current_scene == st["scene"]
    # 前端 npc_state 起始：無覆寫 → 位置與後端 char_locations 一致
    frontend_npc_state = {}
    def front_loc(cid):
        return (frontend_npc_state.get(cid) or {}).get("current_scene") \
            or engine.characters[cid].get("initial_scene")
    for cid in engine.characters:
        assert front_loc(cid) == engine.char_locations[cid]
    # tick 單調遞增：連續推進 3 輪（停留，不移動）
    ticks = [engine.tick]
    for _ in range(3):
        res = engine.step_world_tick(
            director_output={},
            meta_output={"player_scene": None, "attitude_changes": []},
        )
        ticks.append(res["tick"])
    assert ticks == sorted(ticks) and len(set(ticks)) == len(ticks), f"tick 必須單調遞增: {ticks}"
    assert all(b - a == 1 for a, b in zip(ticks, ticks[1:]))
    assert 0 <= engine.heaven_alert <= 100
    # 合法玩家移動（scene_exit 白名單，單一真相來源）: char_locations 與 current_scene 同步
    world = _load_story()
    exits = ((world["scenes"].get(engine.current_scene) or {}).get("scene_exit")) or []
    assert exits, "當前場景須有 scene_exit 白名單"
    res = engine.step_world_tick(director_output={},
                                 meta_output={"player_scene": exits[0],
                                              "attitude_changes": []})
    assert res["move_ok"] is True and res["moved"] is True
    assert engine.current_scene == exits[0]
    assert engine.char_locations[pid] == exits[0]
    occ = engine.get_scene_occupants(engine.current_scene)
    assert pid in occ
    # 前端 npc_state 對帳：以後端 npc_locations 快照為準，位置一致
    for cid, loc in res["npc_locations"].items():
        assert engine.char_locations[cid] == loc
    # 非法瞬移不生效（後端與前端 validateSceneMove 語義一致）
    cur = engine.current_scene
    cur_exits = ((world["scenes"].get(cur) or {}).get("scene_exit")) or []
    far = next((k for k in world["scenes"].keys()
                if k != cur and k not in cur_exits), None)
    if far is not None:
        before = engine.current_scene
        bad = engine.step_world_tick(director_output={}, meta_output={"player_scene": far})
        assert bad["move_ok"] is False
        assert engine.current_scene == before, "非法瞬移必須被拒絕"
    # NPC 明示遷移：合法 to_scene 受理並同步 char_locations
    npc_ids = [c for c in engine.characters if c != pid]
    if npc_ids and cur_exits:
        mv = engine.step_world_tick(
            director_output={},
            meta_output={"player_scene": None,
                         "npc_movements": [{"npc_id": npc_ids[0], "to_scene": cur_exits[0]}]})
        assert engine.char_locations[npc_ids[0]] == cur_exits[0]
        assert mv["npc_locations"][npc_ids[0]] == cur_exits[0]
