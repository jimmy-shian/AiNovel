# -*- coding: utf-8 -*-
import sys
if sys.platform.startswith('win'):
    import io
    if getattr(sys.stdout, 'encoding', '').lower() != 'utf-8':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    if getattr(sys.stderr, 'encoding', '').lower() != 'utf-8':
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
import json
import random
from typing import Dict, List, Any, Optional

class MultiAgentEngine:
    """
    天衍九州：因果網 多代理人魂穿核心調度器
    - 支援玩家自由選擇/魂穿任一可遊玩角色
    - 維護世界時鐘 (World Tick)
    - 空間分流 (Spatial Partitioning): 在場深度交互 vs 後台自轉
    - 魂穿破綻檢測 (Dissonance Tension)
    - 態度向量更新 (Attitude Matrix Updates)
    - 故事導演危機施壓 (Director Pulse)
    """

    def __init__(self, story_file: str = "stories/tianyan_multiagent.json"):
        self.load_story(story_file)

    def load_story(self, story_file: str):
        """動態載入指定故事的 characters 與空間圖"""
        with open(story_file, "r", encoding="utf-8") as f:
            self.story_data = json.load(f)

        self.story_file = story_file
        self.characters: Dict[str, Any] = self.story_data.get("characters", {})
        # 場景圖單一真相來源：以 scenes[].scene_exit 為準，
        # 頂層 spatial_graph 一律由其衍生（缺失則新建，存在則補齊對齊）
        self.scenes_meta: Dict[str, Any] = self._normalize_scenes_meta(self.story_data.get("scenes", {}))
        self.spatial_graph: Dict[str, List[str]] = self._sync_spatial_graph(
            self.story_data.get("spatial_graph", {}), self.scenes_meta
        )
        
        # 遊戲運行態
        self.tick: int = 1
        self.heaven_alert: int = 10
        self.player_char_id: Optional[str] = None
        self.current_scene: str = ""
        self.world_event_log: List[str] = []
        
        # 記錄每位角色當前所在場景
        self.char_locations: Dict[str, str] = {
            cid: cdata.get("initial_scene", list(self.scenes_meta.keys())[0] if self.scenes_meta else "")
            for cid, cdata in self.characters.items()
        }

    @staticmethod
    def _normalize_scenes_meta(scenes: Any) -> Dict[str, Any]:
        """正規化 scenes 為 {key: meta}（相容 dict 與 list 兩種劇本格式）"""
        if isinstance(scenes, dict):
            return scenes
        if isinstance(scenes, list):
            out: Dict[str, Any] = {}
            for s in scenes:
                if not isinstance(s, dict):
                    continue
                key = s.get("id") or s.get("key") or s.get("scene") or s.get("title")
                if key:
                    out[str(key)] = s
            return out
        return {}

    @staticmethod
    def _is_null_scene(value: Any) -> bool:
        """停留語義：None / 空字串 / null、none、無、nan 皆視為未移動"""
        if value is None:
            return True
        s = str(value).strip()
        if not s:
            return True
        return s.lower() in ("null", "none", "nan", "無")

    @classmethod
    def _build_spatial_graph_from_exits(cls, scenes_meta: Dict[str, Any]) -> Dict[str, List[str]]:
        """由 scenes[].scene_exit 建圖（含反向邊去重，排序穩定）"""
        graph: Dict[str, List[str]] = {k: [] for k in scenes_meta.keys()}
        for key, meta in scenes_meta.items():
            exits = (meta or {}).get("scene_exit", []) if isinstance(meta, dict) else []
            for dst in exits or []:
                if not isinstance(dst, str) or not dst:
                    continue
                if dst not in graph:
                    graph[dst] = []
                if dst not in graph[key]:
                    graph[key].append(dst)
                # 反向邊去重：NPC 漫遊用無向圖，定向白名單仍以 scene_exit 為準
                if key not in graph[dst]:
                    graph[dst].append(key)
        for k in graph:
            graph[k] = sorted(graph[k])
        return graph

    @classmethod
    def _sync_spatial_graph(cls, spatial_graph: Any, scenes_meta: Dict[str, Any]) -> Dict[str, List[str]]:
        """對齊 spatial_graph：缺失則由 scene_exit 新建，存在則補齊正/反向邊"""
        built = cls._build_spatial_graph_from_exits(scenes_meta)
        if not isinstance(spatial_graph, dict) or not spatial_graph:
            return built
        synced: Dict[str, List[str]] = {
            k: sorted(set(v)) if isinstance(v, list) else []
            for k, v in spatial_graph.items()
        }
        for k in scenes_meta.keys():
            synced.setdefault(k, [])
        for key, dsts in built.items():
            synced.setdefault(key, [])
            for dst in dsts:
                if dst not in synced[key]:
                    synced[key].append(dst)
            synced[key] = sorted(synced[key])
        return synced

    def list_playable_characters(self) -> List[Dict[str, Any]]:
        """回傳所有玩家可魂穿的角色清單與精簡介紹"""
        playable = []
        for cid, char in self.characters.items():
            if char.get("playable", False):
                playable.append({
                    "id": cid,
                    "name": char["name"],
                    "title": char["title"],
                    "initial_scene": char["initial_scene"],
                    "profile": char["profile"],
                    "physical_state": char["somatic_memory"]["physical_state"]
                })
        return playable

    def reset_world(self, story_file: Optional[str] = None) -> Dict[str, Any]:
        """
        顯式新局重置（新局 / 換故事才呼叫）：
        重新載入故事檔，還原世界心跳 tick=1、天道警戒與全員站位。
        transmigrate 內不再隱式重置，世界心跳預設連續。
        """
        self.load_story(story_file or self.story_file)
        return {"tick": self.tick, "heaven_alert": self.heaven_alert}

    def transmigrate(self, char_id: str) -> Dict[str, Any]:
        """
        玩家魂穿接管指定角色。
        不重置世界心跳 tick（維持連續）：僅切換宿主並回傳 authoritative
        tick / heaven_alert / occupants。如需新局重置，請顯式呼叫 reset_world()。
        """
        if char_id not in self.characters:
            raise ValueError(f"角色不存在: {char_id}")
        if not self.characters[char_id].get("playable", False):
            raise ValueError(f"該角色不可被魂穿: {char_id}")

        self.player_char_id = char_id
        self.current_scene = self.char_locations[char_id]
        player_char = self.characters[char_id]

        wake_up_text = (
            f"【神魂歸竅 · 魂穿奪舍】\n"
            f"神識如穿過無量苦海，猛然墜入一具軀殼之中——\n"
            f"你成了「{player_char['name']}」（{player_char['title']}）。\n"
            f"軀體感官：{player_char['somatic_memory']['physical_state']}\n"
            f"當前位置：【{self.current_scene}】\n"
            f"執念動機：{player_char['agenda']['primary_goal']}"
        )

        return {
            "tick": self.tick,
            "heaven_alert": self.heaven_alert,
            "player_id": self.player_char_id,
            "character": player_char["name"],
            "scene": self.current_scene,
            "wake_up_text": wake_up_text,
            "occupants": self.get_scene_occupants(self.current_scene),
            "somatic_state": player_char["somatic_memory"]["physical_state"]
        }

    def get_scene_occupants(self, scene_name: str) -> List[str]:
        """取得指定場景中的所有角色 (包含玩家與NPC)"""
        return [
            cid for cid, loc in self.char_locations.items()
            if loc == scene_name
        ]

    def check_flashback(self, context_text: str) -> List[str]:
        """檢測本輪文字是否觸發玩家角色的『肉身記憶/閃回直覺』"""
        if not self.player_char_id:
            return []
        
        triggers = self.characters[self.player_char_id]["somatic_memory"].get("flashback_triggers", {})
        active_flashbacks = []
        for trigger_key, fragment in triggers.items():
            # 支援以角色ID、場景名或關鍵字觸發
            if trigger_key in context_text or (trigger_key in self.get_scene_occupants(self.current_scene)):
                active_flashbacks.append(fragment)
        return active_flashbacks

    def evaluate_dissonance(self, player_input: str) -> float:
        """
        評估玩家發言相對於原角色人設的破綻偏離度 (簡化啟發式演算法)
        回傳 0.0 ~ 0.3 的破綻增量
        """
        if not self.player_char_id:
            return 0.0

        p_char = self.characters[self.player_char_id]
        baseline = p_char["somatic_memory"]["baseline_tone"]
        
        # 簡單啟發式破綻特徵：
        # 例如原身冷峻蒼老，若發言帶有現代網路詞、過多顏文字或無厘頭搞笑
        modern_slang = ["哈", "笑死", "搞毛", "牛逼", "老哥", "ok", "666", "系統", "開掛"]
        dissonance = 0.0
        for slang in modern_slang:
            if slang in player_input.lower():
                dissonance += 0.15

        # 斷劍客自稱某家，若多次使用本姑娘/小生等反向風格
        if self.player_char_id == "char_duanjian" and "小女" in player_input:
            dissonance += 0.25
        elif self.player_char_id == "char_xian_shi" and "求求" in player_input:
            dissonance += 0.3

        p_char["dissonance"] = min(1.0, p_char.get("dissonance", 0.0) + dissonance)
        return dissonance

    def build_director_prompt(self, player_action: str) -> Dict[str, Any]:
        """組合給 Story Director LLM 的情境提示詞"""
        if not self.player_char_id:
            raise RuntimeError("尚未魂穿角色")

        p_char = self.characters[self.player_char_id]
        in_scene = self.get_scene_occupants(self.current_scene)
        in_scene_npcs = [
            f"{self.characters[c]['name']}({self.characters[c]['title']})"
            for c in in_scene if c != self.player_char_id
        ]

        bg_npcs = [
            f"{self.characters[c]['name']}正在【{self.char_locations[c]}】"
            for c in self.characters if c not in in_scene
        ]

        prompt_payload = {
            "tick": self.tick,
            "heaven_alert": self.heaven_alert,
            "player_character_name": p_char["name"],
            "player_character_id": self.player_char_id,
            "current_scene": self.current_scene,
            "somatic_state": p_char["somatic_memory"]["physical_state"],
            "scene_occupants": in_scene_npcs,
            "background_npcs": bg_npcs[:4], # 控制 context 長度
            "player_action": player_action,
            "dissonance_score": round(p_char.get("dissonance", 0.0), 2)
        }
        return prompt_payload

    def step_world_tick(self, director_output: Dict[str, Any], meta_output: Dict[str, Any]) -> Dict[str, Any]:
        """
        推進 1 個世界滴答 (World Tick)：
        1. 更新玩家位置與破綻
        2. 更新在場 NPC 對玩家的態度向量
        3. 後台自主 NPC 的輕量空間漂移
        4. 天道警戒度推進
        """
        self.tick += 1

        # 1. 處理場景轉移（單一真相來源：scenes[].scene_exit，與前端 validateSceneMove 語義一致）
        # 規則：停留（null/空/同場）→ 允許不動；未知場景 → 拒絕；不在白名單 → 拒絕並回 reason
        raw_scene = meta_output.get("player_scene", None)
        if "player_scene" not in meta_output and "scene" in meta_output:
            raw_scene = meta_output.get("scene")
        move_ok = True
        moved = False
        move_reason: Optional[str] = None
        if self._is_null_scene(raw_scene):
            pass
        else:
            new_scene = str(raw_scene).strip()
            if self.player_char_id is None:
                move_ok = False
                move_reason = "not transmigrated"
            elif new_scene == self.current_scene:
                pass
            elif new_scene not in self.scenes_meta:
                move_ok = False
                move_reason = f"unknown scene: {new_scene}"
            else:
                cur_meta = self.scenes_meta.get(self.current_scene, {}) or {}
                exits = cur_meta.get("scene_exit", []) or []
                if new_scene not in exits:
                    move_ok = False
                    move_reason = f"illegal move {self.current_scene}→{new_scene}"
                else:
                    self.current_scene = new_scene
                    self.char_locations[self.player_char_id] = new_scene
                    moved = True

        # 2. 處理態度向量浮動
        for change in meta_output.get("attitude_changes", []):
            npc_id = change.get("npc_id")
            if npc_id in self.characters:
                matrix = self.characters[npc_id].get("attitude_matrix", {})
                if self.player_char_id in matrix:
                    curr = matrix[self.player_char_id]
                    curr["trust"] = max(-1.0, min(1.0, curr["trust"] + change.get("trust_delta", 0.0)))
                    curr["suspicion"] = max(0.0, min(1.0, curr["suspicion"] + change.get("suspicion_delta", 0.0)))

        # 2b. 處理 Meta 明示的 NPC 遷移（npc_movements：僅合法場景 key 才受理）
        # 新版語義：本輪已由 Meta 明示調度的 NPC 不再參與同輪隨機漂移，
        # 否則明示進入/離開會被 25% 隨機覆寫，造成前後端 npc_state 對帳分叉。
        rumors: List[str] = []
        explicit_moved: set = set()
        for m in meta_output.get("npc_movements", []) or []:
            if not isinstance(m, dict):
                continue
            npc_id = m.get("npc_id")
            to_scene = m.get("to_scene")
            if npc_id not in self.characters:
                continue
            if to_scene not in self.spatial_graph and to_scene not in self.scenes_meta:
                continue
            prev_loc = self.char_locations.get(npc_id)
            if prev_loc == to_scene:
                explicit_moved.add(npc_id)
                continue
            self.char_locations[npc_id] = to_scene
            explicit_moved.add(npc_id)
            if to_scene == self.current_scene and prev_loc != self.current_scene:
                rumors.append(f"【身影乍現】{self.characters[npc_id]['name']} 踏入了【{self.current_scene}】！")

        # 3. 後台自主 NPC 依 agenda 輕量漂移（跳過本輪已明示調度者）
        for cid, loc in list(self.char_locations.items()):
            if cid in explicit_moved:
                continue
            if cid != self.player_char_id and loc != self.current_scene:
                # 20% 機率朝相鄰節點移動
                if random.random() < 0.25 and loc in self.spatial_graph:
                    neighbors = self.spatial_graph[loc]
                    if neighbors:
                        next_loc = random.choice(neighbors)
                        self.char_locations[cid] = next_loc
                        if next_loc == self.current_scene:
                            rumors.append(f"【身影乍現】{self.characters[cid]['name']} 自遠處急行而來，踏入了【{self.current_scene}】！")

        # 4. 天道警戒值微幅提升
        self.heaven_alert = min(100, self.heaven_alert + 2)

        for r in rumors:
            self.world_event_log.append(f"[TICK {self.tick}] {r}")

        # 全員站位快照（char_id→scene）與對宿主態度快照（供前端對帳 npc_state）
        attitude_snapshot: Dict[str, Dict[str, float]] = {}
        for cid, cdata in self.characters.items():
            if cid == self.player_char_id:
                continue
            matrix = cdata.get("attitude_matrix", {})
            if self.player_char_id in matrix:
                att = matrix[self.player_char_id]
                attitude_snapshot[cid] = {
                    "trust": att.get("trust", 0.0),
                    "suspicion": att.get("suspicion", 0.3),
                }

        return {
            "tick": self.tick,
            "scene": self.current_scene,
            "occupants": [self.characters[c]["name"] for c in self.get_scene_occupants(self.current_scene)],
            "heaven_alert": self.heaven_alert,
            "rumors": rumors,
            "npc_locations": dict(self.char_locations),
            "attitude_snapshot": attitude_snapshot,
            "moved": moved,
            "move_ok": move_ok,
            "move_reason": move_reason,
        }
