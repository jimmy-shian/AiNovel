# _legacy（已棄用舊劇本封存）

| 檔案 | 狀態 | 說明 |
| --- | --- | --- |
| `tianyan.json` | `.deprecated` / 已棄用 | 單代理舊劇本：僅含 `prompts.director/narrative/meta`，無 `narrative_transmigration/director_transmigration/meta_transmigration` 與 `characters`；`world.json` 未引用。由 `git mv stories/tianyan.json` 搬入，git 歷史可追，勿直接刪除。`build_world.py` 僅掃描 `stories/*.json` 頂層，本目錄不會被重建進 `world.json`。 |

舊 `scenes[].npcs` 僅作無 `characters` 劇本的回退（見 `js/api.js getSceneNpcFallbackText`），真相來源為 `characters + npc_state`。
