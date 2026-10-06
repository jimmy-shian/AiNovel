import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from agent_flow_engine import MultiAgentEngine

def test_engine_init():
    engine = MultiAgentEngine("stories/tianyan_multiagent.json")
    playable = engine.list_playable_characters()
    assert len(playable) >= 7
    # 蕭千絕可遊玩
    assert any(c["id"] == "char_duanjian" for c in playable)

def test_transmigration():
    engine = MultiAgentEngine("stories/tianyan_multiagent.json")
    state = engine.transmigrate("char_duanjian")
    assert state["player_id"] == "char_duanjian"
    assert state["scene"] == "逆天者營地"
    assert "蕭千絕" in state["character"]
    assert len(state["occupants"]) >= 1

def test_dissonance_evaluation():
    engine = MultiAgentEngine("stories/tianyan_multiagent.json")
    engine.transmigrate("char_duanjian")
    d1 = engine.evaluate_dissonance("某家今日要一探引仙渡虛實！")
    assert d1 == 0.0
    d2 = engine.evaluate_dissonance("哈哈老哥太牛逼了666！小女這就走")
    assert d2 > 0.0

def test_world_tick_and_spatial_migration():
    engine = MultiAgentEngine("stories/tianyan_multiagent.json")
    engine.transmigrate("char_duanjian")
    start_tick = engine.tick
    res = engine.step_world_tick(
        director_output={},
        meta_output={
            "player_scene": "鬼市",
            "attitude_changes": [{"npc_id": "char_laoduwu", "trust_delta": 0.1, "suspicion_delta": -0.05}]
        }
    )
    assert res["tick"] == start_tick + 1
    assert engine.current_scene == "鬼市"
    assert engine.heaven_alert > 10

if __name__ == "__main__":
    test_engine_init()
    test_transmigration()
    test_dissonance_evaluation()
    test_world_tick_and_spatial_migration()
    print("All multiagent tests passed successfully!")
