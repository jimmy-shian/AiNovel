# -*- coding: utf-8 -*-
"""連貫性迴歸網：POV / 重複度 / 場景正規化 / delta 嚴格性 / 管線契約."""
import os
import re
import sys

if sys.platform.startswith('win'):
    import io
    if getattr(sys.stdout, 'encoding', '').lower() != 'utf-8':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


def _read(rel):
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, rel), 'r', encoding='utf-8') as f:
        return f.read()


# ---- Python 側重現 JS validators 核心語義（與 js/validators.js 對齊） ----

def validate_pov(narrative):
    if not narrative or not narrative.strip():
        return (False, 'empty')
    text = narrative.strip()
    wo = text.count('我')
    ni_lead = len(re.findall(r'(?:^|\n)\s*你', text))
    ta_lead = len(re.findall(r'(?:^|\n)\s*他(?!人)', text))
    if wo == 0 and (ni_lead + ta_lead) > 0:
        return (False, 'missing 我')
    if ni_lead >= 3 and wo <= 1:
        return (False, '第二人稱主導')
    return (True, '')


def _bigrams(s):
    t = re.sub(r'\s+', '', s or '')
    return {t[i:i + 2] for i in range(len(t) - 1)}


def jaccard(a, b):
    sa, sb = _bigrams(a), _bigrams(b)
    if not sa and not sb:
        return 0.0
    return len(sa & sb) / max(1, len(sa | sb))


def normalize_scene(raw, scenes):
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or re.match(r'^(null|none|無|nan)$', s, re.I):
        return None
    if s in scenes:
        return s
    for k, v in scenes.items():
        title = (v or {}).get('title', '')
        if s == title:
            return k
        if title and k in s:
            return k
    ns = re.sub(r'\s+', '', s)
    if ns in scenes:
        return ns
    return s


def parse_delta_strict(raw):
    if raw is None:
        return {'ok': True, 'skipped': True}
    s = str(raw).strip()
    if not s or re.match(r'^(null|none|無|nan)$', s, re.I):
        return {'ok': True, 'skipped': True}
    if '/' in s:
        head = s.split('/')[0].strip()
        if re.match(r'^[-+]?\d+(\.\d+)?$', head):
            return {'ok': True, 'kind': 'absolute', 'head': float(head)}
        return {'ok': False}
    if re.match(r'^[-+]\d+(\.\d+)?$', s):
        return {'ok': True, 'kind': 'delta', 'delta': float(s)}
    return {'ok': False, 'reason': 'bare number ambiguous'}


def run_all():
    print('====== 連貫性迴歸測試 ======')

    # 1. POV
    print('[coherence 1] POV 視角校驗...')
    assert validate_pov('我提劍向前，血氣翻湧。')[0] is True
    assert validate_pov('你向前走，你看到山，你聽到風，你停下。')[0] is False
    assert validate_pov('')[0] is False
    print('=> coherence 1 通過')

    # 2. 重複度
    print('[coherence 2] 重複生成攔截...')
    a = '我踏入凡人村，枯萎焦土在腳下碎裂，提燈女童在前方招手。'
    b = '我踏入凡人村，枯萎焦土在腳下碎裂，提燈女童在前方招手。'
    c = '我潛入鬼市，瘴氣中老毒物遞來一枚破禁符，遠處傳來角力場的喧囂。'
    assert jaccard(a, b) >= 0.55, '相同文本應被判重複'
    assert jaccard(a, c) < 0.55, '不同場景不應被判重複'
    print('=> coherence 2 通過')

    # 3. 場景正規化 + 白名單
    print('[coherence 3] 場景 title→key 與非法瞬移...')
    assert normalize_scene('靈脈枯竭：凡人村', {'凡人村': {'title': '靈脈枯竭：凡人村'}}) == '凡人村'
    assert normalize_scene(' 凡人村 ', {'凡人村': {}}) == '凡人村'
    assert normalize_scene(None, {}) is None
    assert normalize_scene('null', {}) is None
    print('=> coherence 3 通過')

    # 4. delta 嚴格性
    print('[coherence 4] 裸數字歧義拒收...')
    assert parse_delta_strict('+5')['ok'] is True
    assert parse_delta_strict('-10')['ok'] is True
    assert parse_delta_strict('90/100')['ok'] is True
    assert parse_delta_strict('20')['ok'] is False, '裸數字必須拒收'
    assert parse_delta_strict(None)['skipped'] is True
    print('=> coherence 4 通過')

    # 5. 管線契約：JS 引用完整性
    print('[coherence 5] 2-call 管線契約...')
    api = _read('js/api.js')
    game = _read('js/game.js')
    utils = _read('js/utils.js')
    bible = _read('js/story-bible.js')
    validators = _read('js/validators.js')
    cfg = _read('js/config.js')
    html = _read('index.html')
    assert 'window.buildUnifiedStoryPrompt' in api
    assert 'window.buildStrictMetaContext' in api
    assert 'window.OUTPUT_CONTRACTS' in api
    assert "kind = 'story'" in api or 'kind=' in api
    assert 'window.splitHistoryMemory' in bible
    assert 'window.validatePOV' in validators
    assert 'window.validateRepetition' in validators
    assert 'window.normalizeSceneKey' in validators
    assert 'window.parseDeltaNumberStrict' in validators
    assert '2-call' in game
    assert 'validateStrictMeta' in game
    assert 'stampSaveSchema' in utils
    assert 'SAVE_SCHEMA' in cfg
    assert 'stream: true' in cfg or 'stream:true' in cfg
    assert 'max_tokens: 131072' not in cfg, '異常 max_tokens 必須已修正'
    assert 'js/story-bible.js' in html and 'js/validators.js' in html
    assert '天眼' not in game or '隱性' in game or 'registerSceneVisit' in game, '隱性成長必須已移除/收斂'
    print('=> coherence 5 通過')

    # 6. 舊相容：legacy parser 行為不破
    print('[coherence 6] legacy parser 相容...')
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from run_tests import parse_delta_number, parse_pairs
    assert parse_delta_number('+15', 50) == 15
    assert parse_delta_number('90', 50) == 40
    assert parse_pairs('天眼=+5;悟性=-2')['天眼']['val'] == 5
    print('=> coherence 6 通過')

    print('====== 連貫性測試皆已通過 ======')


if __name__ == '__main__':
    run_all()
