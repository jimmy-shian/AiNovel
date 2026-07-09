# -*- coding: utf-8 -*-
import json
import os
import sys

# 確保輸出支援 UTF-8，防止 Windows 終端機亂碼
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
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

def run_all_tests():
    print("====== 開始執行天衍九州核心演算法測試 ======")
    
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
    
    for story_id, story_data in world_data['stories'].items():
        print(f"  - 驗證故事: {story_id} ({story_data.get('title', '無標題')})")
        assert 'title' in story_data, f"故事 {story_id} 缺少 title 欄位"
        assert 'prompts' in story_data, f"故事 {story_id} 缺少 prompts 欄位"
        assert 'scenes' in story_data, f"故事 {story_id} 缺少 scenes 欄位"
        
        prompts = story_data['prompts']
        assert 'director' in prompts, f"故事 {story_id} 缺少 director 提示詞"
        assert 'narrative' in prompts, f"故事 {story_id} 缺少 narrative 提示詞"
        assert 'meta' in prompts, f"故事 {story_id} 缺少 meta 提示詞"
    
    print("=> 測試 3 通過！")
    
    print("====== 所有測試皆已順利通過！ ======")

if __name__ == '__main__':
    run_all_tests()
