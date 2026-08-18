# -*- coding: utf-8 -*-
import json
import os
import sys

if sys.platform.startswith('win'):
    import io
    if getattr(sys.stdout, 'encoding', '').lower() != 'utf-8':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    if getattr(sys.stderr, 'encoding', '').lower() != 'utf-8':
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')


def parse_delta_number(raw_str, current):
    """
    Python 版本的 parseDeltaNumber 模擬實現
    """
    if raw_str is None:
        return None
    s = str(raw_str).strip()
    
    # 支援 XX/Limit 格式
    if '/' in s:
        try:
            val = float(s.split('/')[0])
            return val - current
        except ValueError:
            return None
            
    # 支援明示的相對變動 (+10, -5)
    if s.startswith('+') or s.startswith('-'):
        try:
            return float(s)
        except ValueError:
            return None
            
    # 純數字且無符號，視為絕對新值，需減去當前值以轉換為增量 delta
    try:
        val = float(s)
        return val - current
    except ValueError:
        return None

def parse_pairs(raw_str):
    """
    Python 版本的 parsePairs 模擬實現
    """
    out = {}
    if not raw_str or str(raw_str).strip().lower() in ('none', '無', 'null', 'nan'):
        return out
        
    parts = [p.strip() for p in str(raw_str).split(';') if p.strip()]
    for part in parts:
        if '=' not in part:
            continue
        eq_idx = part.index('=')
        k = part[:eq_idx].strip()
        v_str = part[eq_idx+1:].strip()
        
        is_delta = v_str.startswith('+') or v_str.startswith('-')
        clean_v_str = v_str if is_delta else v_str.replace('+', '')
        
        if '/' in v_str:
            segments = [s.strip() for s in v_str.split('/')]
            if len(segments) == 3:
                try:
                    out[k] = {
                        'isDelta': segments[0].startswith('+') or segments[0].startswith('-'),
                        'val': float(segments[0]),
                        'min': float(segments[1]),
                        'max': float(segments[2])
                    }
                except ValueError:
                    continue
            elif len(segments) == 2:
                try:
                    out[k] = {
                        'isDelta': segments[0].startswith('+') or segments[0].startswith('-'),
                        'val': float(segments[0]),
                        'min': 0.0,
                        'max': float(segments[1])
                    }
                except ValueError:
                    continue
        else:
            try:
                v = float(clean_v_str)
                out[k] = {
                    'isDelta': is_delta,
                    'val': v
                }
            except ValueError:
                continue
    return out

import re

def get_stat_tier(val):
    """
    Python 版本的 getStatTier 實現
    """
    try:
        n = float(val)
    except (ValueError, TypeError):
        n = 0.0
    if n >= 90:
        return {'name': '極境', 'tier': 4, 'class': 'tier-epic'}
    if n >= 60:
        return {'name': '入微', 'tier': 3, 'class': 'tier-high'}
    if n >= 30:
        return {'name': '窺徑', 'tier': 2, 'class': 'tier-mid'}
    return {'name': '凡胎', 'tier': 1, 'class': 'tier-low'}

def parse_option_requirement(option_text, player):
    """
    Python 版本的 parseOptionRequirement 實現
    """
    if not option_text or not player:
        return {'eligible': True}

    # 1. 檢定門檻格式：【屬性名≥數值】或【屬性名>=數值】
    threshold_match = re.search(r'【([^【】≥>=]+)[≥>=]+(\d+)】', option_text)
    if threshold_match:
        stat_name = threshold_match.group(1).strip()
        req_val = int(threshold_match.group(2))

        current_val = 0
        if stat_name in ('生命', 'hp', 'HP'):
            current_val = player.get('hp', 0)
        elif stat_name in ('靈力', 'sp', 'SP'):
            current_val = player.get('sp', 0)
        elif stat_name in ('業力', '威脅', 'threat'):
            current_val = player.get('threat', 0)
        elif 'abilities' in player and stat_name in player['abilities']:
            a = player['abilities'][stat_name]
            current_val = a.get('val', 0) if isinstance(a, dict) else float(a)

        if current_val < req_val:
            return {
                'eligible': False,
                'type': 'threshold',
                'stat': stat_name,
                'required': req_val,
                'current': current_val,
                'reason': f'需 {stat_name} ≥ {req_val}（當前 {current_val}）'
            }
        return {
            'eligible': True,
            'type': 'threshold',
            'stat': stat_name,
            'required': req_val,
            'current': current_val
        }

    # 2. 資源消耗格式：【消耗 20 靈力】或【消耗 15 生命】
    cost_match = re.search(r'【消耗\s*(\d+)\s*(靈力|生命|真元|氣血|SP|HP)】', option_text, re.IGNORECASE)
    if cost_match:
        cost = int(cost_match.group(1))
        type_str = cost_match.group(2)
        is_sp = bool(re.search(r'靈力|真元|SP', type_str, re.IGNORECASE))
        pool_val = player.get('sp', 0) if is_sp else player.get('hp', 0)
        pool_name = '靈力' if is_sp else '生命'

        if pool_val < cost:
            return {
                'eligible': False,
                'type': 'cost',
                'cost': cost,
                'costType': pool_name,
                'current': pool_val,
                'reason': f'{pool_name}不足（需 {cost}，當前 {pool_val}）'
            }
        return {
            'eligible': True,
            'type': 'cost',
            'cost': cost,
            'costType': pool_name,
            'current': pool_val
        }

    return {'eligible': True}

def run_all_tests():
    print("====== 開始執行天衍九州核心演算法測試 ======")
    
    # 進行自動化故事編譯 (由 stories/* 合併為 world.json)
    print("[編譯] 正在從 stories/ 目錄編譯 world.json...")
    parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if parent_dir not in sys.path:
        sys.path.append(parent_dir)
    from build_world import build
    build()
    
    # Test 1: parse_delta_number
    print("[測試 1] 測試 parseDeltaNumber (數值變動智慧解析)...")
    
    # 測試相對增加
    assert parse_delta_number("+15", 50) == 15, "相對增加解析失敗"
    # 測試相對減少
    assert parse_delta_number("-10", 50) == -10, "相對減少解析失敗"
    # 測試絕對新值 (90)
    assert parse_delta_number("90", 50) == 40, "絕對新值解析失敗"
    assert parse_delta_number("30", 50) == -20, "絕對新值小於當前解析失敗"
    # 測試帶斜線 (80/100)
    assert parse_delta_number("80/100", 50) == 30, "帶斜線絕對新值解析失敗"
    
    print("=> 測試 1 通過！")

    # Test 2: parse_pairs
    print("[測試 2] 測試 parsePairs (能力變動解析)...")
    
    # 測試相對變動解析
    res1 = parse_pairs("天眼=+5;悟性=-2")
    assert res1['天眼']['isDelta'] is True and res1['天眼']['val'] == 5, "能力相對增加解析失敗"
    assert res1['悟性']['isDelta'] is True and res1['悟性']['val'] == -2, "能力相對減少解析失敗"
    
    # 測試絕對值解析
    res2 = parse_pairs("天眼=30")
    assert res2['天眼']['isDelta'] is False and res2['天眼']['val'] == 30, "能力絕對值解析失敗"
    
    # 測試帶範圍解析 (天眼=40/0/100)
    res3 = parse_pairs("天眼=+5/0/100")
    assert res3['天眼']['isDelta'] is True
    assert res3['天眼']['val'] == 5
    assert res3['天眼']['min'] == 0
    assert res3['天眼']['max'] == 100
    
    print("=> 測試 2 通過！")

    # Test 3: world.json 讀取與驗證
    print("[測試 3] 測試 world.json 完整性與編碼...")
    
    world_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'world.json')
    assert os.path.exists(world_path), "找不到 world.json 檔案"
    
    with open(world_path, 'r', encoding='utf-8') as f:
        world_data = json.load(f)
        
    assert 'stories' in world_data, "缺少 stories 欄位"
    
    for story_id, story_meta in world_data['stories'].items():
        print(f"  - 驗證故事索引: {story_id} ({story_meta.get('title', '無標題')})")
        assert 'title' in story_meta, f"故事 {story_id} 缺少 title 欄位"
        assert 'file' in story_meta, f"故事 {story_id} 缺少 file 欄位"
        
        # 讀取實際的故事檔案進行驗證
        story_file_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), story_meta['file'])
        assert os.path.exists(story_file_path), f"找不到故事檔案: {story_file_path}"
        
        with open(story_file_path, 'r', encoding='utf-8') as sf:
            story_data = json.load(sf)
            
        assert 'prompts' in story_data, f"故事 {story_id} 缺少 prompts 欄位"
        assert 'scenes' in story_data, f"故事 {story_id} 缺少 scenes 欄位"
        
        prompts = story_data['prompts']
        assert 'director' in prompts, f"故事 {story_id} 缺少 director 提示詞"
        assert 'narrative' in prompts, f"故事 {story_id} 缺少 narrative 提示詞"
        assert 'meta' in prompts, f"故事 {story_id} 缺少 meta 提示詞"
        
        # 驗證 prompt 中是否已包含門檻與階位回饋指引
        assert "階位" in prompts['director'] or "門檻" in prompts['director'], f"故事 {story_id} director 缺少階位/門檻指引"
        assert "窺徑" in prompts['narrative'] or "境界" in prompts['narrative'], f"故事 {story_id} narrative 缺少境界描繪指引"
        assert "門檻" in prompts['meta'] or "消耗" in prompts['meta'], f"故事 {story_id} meta 缺少門檻/消耗規範"
    
    print("=> 測試 3 通過！")

    # Test 4: 階位計算驗證 (get_stat_tier)
    print("[測試 4] 測試能力階位劃分 (get_stat_tier)...")
    assert get_stat_tier(0)['name'] == '凡胎'
    assert get_stat_tier(25)['name'] == '凡胎'
    assert get_stat_tier(30)['name'] == '窺徑'
    assert get_stat_tier(59)['name'] == '窺徑'
    assert get_stat_tier(60)['name'] == '入微'
    assert get_stat_tier(89)['name'] == '入微'
    assert get_stat_tier(90)['name'] == '極境'
    assert get_stat_tier(100)['name'] == '極境'
    print("=> 測試 4 通過！")

    # Test 5: 選項門檻與消耗檢驗 (parse_option_requirement)
    print("[測試 5] 測試選項門檻與消耗判定 (parse_option_requirement)...")
    mock_player = {
        'hp': 80,
        'sp': 15,
        'threat': 20,
        'abilities': {
            '天眼': {'val': 35, 'min': 0, 'max': 100},
            '劍意': 10
        }
    }

    # 一般選項無門檻
    assert parse_option_requirement("觀察四周環境", mock_player)['eligible'] is True

    # 滿足天眼門檻 (35 >= 30)
    res_t1 = parse_option_requirement("【天眼≥30】看穿陣法破綻", mock_player)
    assert res_t1['eligible'] is True
    assert res_t1['stat'] == '天眼'

    # 未滿足劍意門檻 (10 < 30)
    res_t2 = parse_option_requirement("【劍意≥30】一劍破萬法", mock_player)
    assert res_t2['eligible'] is False
    assert res_t2['required'] == 30
    assert res_t2['current'] == 10

    # 滿足生命消耗 (80 >= 20)
    res_c1 = parse_option_requirement("【消耗 20 生命】燃燒精血遁走", mock_player)
    assert res_c1['eligible'] is True

    # 靈力不足 (15 < 20)
    res_c2 = parse_option_requirement("【消耗 20 靈力】催動九天雷引", mock_player)
    assert res_c2['eligible'] is False
    assert res_c2['cost'] == 20
    assert res_c2['costType'] == '靈力'

    print("=> 測試 5 通過！")

    # Test 6: 動態模型格式解析與代理路由 (/v1/models)
    print("[測試 6] 測試動態模型格式解析、排序與代理端點...")
    
    # 6.1 測試 OpenAI / NVIDIA NIM 格式解析與自訂排序
    def parse_and_sort_models(data):
        model_ids = []
        if isinstance(data, dict) and "data" in data and isinstance(data["data"], list):
            for item in data["data"]:
                if isinstance(item, dict) and "id" in item:
                    model_ids.append(str(item["id"]))
                elif isinstance(item, str):
                    model_ids.append(item)
        elif isinstance(data, dict) and "models" in data and isinstance(data["models"], list):
            for item in data["models"]:
                if isinstance(item, dict):
                    name = item.get("name") or item.get("model") or item.get("id")
                    if name:
                        model_ids.append(str(name))
                elif isinstance(item, str):
                    model_ids.append(item)
        
        def score(name):
            lower = name.lower()
            if 'gpt-oss-120b' in lower: return -20
            if 'gpt-oss' in lower: return -18
            if 'deepseek-r1' in lower: return -16
            if 'deepseek' in lower: return -14
            if 'qwen3.5' in lower: return -12
            if 'qwen' in lower: return -10
            if 'llama-3.3' in lower: return -8
            if 'llama' in lower: return -6
            if 'nemotron' in lower: return -4
            return 0

        model_ids.sort(key=lambda x: (score(x), x))
        return model_ids

    openai_sample = {
        "data": [
            {"id": "meta/llama-3.1-70b-instruct"},
            {"id": "openai/gpt-oss-120b"},
            {"id": "deepseek-ai/deepseek-r1"},
            {"id": "qwen/qwen3.5-122b-a10b"}
        ]
    }
    sorted_openai = parse_and_sort_models(openai_sample)
    assert sorted_openai[0] == "openai/gpt-oss-120b"
    assert sorted_openai[1] == "deepseek-ai/deepseek-r1"
    assert sorted_openai[2] == "qwen/qwen3.5-122b-a10b"
    assert sorted_openai[3] == "meta/llama-3.1-70b-instruct"

    # 6.2 測試 Ollama 格式解析
    ollama_sample = {
        "models": [
            {"name": "llama3:latest"},
            {"model": "qwen2.5:32b"}
        ]
    }
    sorted_ollama = parse_and_sort_models(ollama_sample)
    assert "qwen2.5:32b" in sorted_ollama
    assert "llama3:latest" in sorted_ollama

    # 6.3 測試 FastAPI /v1/models 路由代理功能
    from fastapi.testclient import TestClient
    from server import app
    from unittest.mock import patch, MagicMock

    client = TestClient(app)
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "data": [
            {"id": "openai/gpt-oss-120b"},
            {"id": "nvidia/nemotron-4-340b-instruct"}
        ]
    }

    with patch("requests.get", return_value=mock_resp) as mock_get:
        res = client.get("/v1/models", headers={"Authorization": "Bearer test-api-key"})
        assert res.status_code == 200
        data = res.json()
        assert len(data["data"]) == 2
        assert data["data"][0]["id"] == "openai/gpt-oss-120b"
        mock_get.assert_called_once()
        assert mock_get.call_args[0][0] == "https://integrate.api.nvidia.com/v1/models"
        assert mock_get.call_args[1]["headers"]["Authorization"] == "Bearer test-api-key"

    print("=> 測試 6 通過！")
    
    print("====== 所有測試皆已順利通過！ ======")

if __name__ == '__main__':
    run_all_tests()
