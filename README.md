# 天衍九州：虛數輪迴 (Tianyan JiuZhou: Virtual Reincarnation)

這是一個基於 NVIDIA NVIDIA Integrate API (Gemma 4 31B) 驅動的 AI 交互式敘事遊戲原型。採用「高維度數據修仙」世界觀，結合現代化 Web 設計美學。

## 🌟 核心特色
- **AI 裁判系統**：使用 Gemma-4-31B 模型進行敘事與數值判定，支援「思考模式」 (Thinking Mode)。
- **極簡質感 UI**：採用 Liquid Glass 設計風格，支援響應式佈局（適配手機端）。
- **動態行動系統**：根據故事情節自動生成建議行動按鈕。
- **本地數據持久化**：支援存檔碼匯出與匯入。

## 🚀 部署與運行

### 方案 A：本地運行（推薦，支援跨域代理）
由於瀏覽器 CORS 限制，直接從靜態網頁呼叫 NVIDIA API 可能會失敗。推薦使用內置的 Python 代理。

1. **安裝依賴**：
   ```bash
   pip install fastapi uvicorn requests
   ```
2. **啟動代理伺服器**：
   ```bash
   python server.py
   ```
3. **開啟網頁**：
   使用 Live Server 或直接打開 `index.html`。
4. **設定**：
   在網頁的「系統設置」中將 `useProxy` 設為 `true`。

### 方案 B：GitHub Pages 靜態部署
若部署至 GitHub Pages，無法運行 Python 代理：

1. **直接連線**：
   在 `app.js` 中將 `CONFIG.useProxy` 設為 `false`。
2. **注意**：
   若發生 CORS 錯誤，建議將項目部署至 **Vercel** 或 **Netlify**，並將 `server.py` 邏輯改寫為 Serverless Functions。

## 🛠 檔案結構
- `index.html`: 遊戲主介面
- `styles.css`: 遊戲樣式（Liquid Glass 系統）
- `app.js`: 核心邏輯與 API 交互
- `world.json`: 世界觀設定與初始狀態
- `server.py`: Python 代理伺服器（解決 CORS 問題）

## 📝 授權
本項目僅供學習與研究使用。