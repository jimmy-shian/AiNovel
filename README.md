# 天衍九州：虛數輪迴 (Tianyan JiuZhou: Virtual Reincarnation)

這是一個基於 NVIDIA NVIDIA Integrate API (Gemma 4 31B) 驅動的 AI 交互式敘事遊戲原型。採用「高維度數據修仙」世界觀，結合現代化 Web 設計美學。

## 🌟 核心特色
- **AI 裁判系統**：使用 Gemma-4-31B 模型進行敘事與數值判定，支援「思考模式」 (Thinking Mode)。
- **極簡質感 UI**：採用 Liquid Glass 設計風格，支援響應式佈局（適配手機端）。
- **動態行動系統**：根據故事情節自動生成建議行動按鈕。
- **本地數據持久化**：支援存檔碼匯出與匯入。

## 🚀 部署與運行

### 方案 A：本地運行（開發與個人使用推薦）
由於 NVIDIA API 限制瀏覽器直接存取 (CORS)，且 GitHub Pages (HTTPS) 無法直接存取本地 HTTP 代理。

1. **安裝依賴**：
   ```bash
   pip install fastapi uvicorn requests
   ```
2. **啟動本地代理伺服器**：
   ```bash
   python server.py
   ```
   *伺服器將運行於 `http://127.0.0.1:4444`*
3. **啟動網頁**：
   請勿直接從 GitHub Pages 連結使用本地代理。建議在本地使用 VS Code 的 `Live Server` 擴充功能開啟 `index.html`。
4. **設定**：
   點擊「系統設置」，勾選 **「使用代理伺服器」** 並儲存。

### 方案 B：GitHub Pages 部署（線上版解決方案）
若要在線上環境（如 GitHub Pages）正常使用，有以下選擇：

1. **Cloudflare Worker 代理（推薦）**：
   建立一個免費的 Cloudflare Worker 作為 HTTPS 代理，解決跨域與安全性限制。
2. **瀏覽器擴充功能**：
   安裝 `Allow CORS: Access-Control-Allow-Origin` 插件並開啟，即可直接繞過限制。

---

## 🛠 檔案結構
- `index.html`: 遊戲主介面（採用現代液態玻璃設計）
- `styles.css`: 核心樣式表（包含跨平台自適應與動畫邏輯）
- `app.js`: 遊戲引擎邏輯（包含 AI 流式輸出與數據管理）
- `world.json`: 世界觀設定（場景、屬性、初始狀態）
- `server.py`: 本地 Python 代理伺服器（解決 CORS 跨域問題）

---

## ⚠️ 常見問題 (Troubleshooting)
* **Q: 為什麼線上版點擊「儲存」沒反應？**
  * A: 請檢查瀏覽器控制台。若出現 `Mixed Content` 錯誤，表示 HTTPS 網站無法存取 HTTP 代理。請改用本地運行模式或部署 HTTPS 代理。
* **Q: 側邊欄顯示不正常？**
  * A: 本項目針對手機與桌面端做了深度優化。手機版縮小後會顯示為「懸浮控制島」，桌面版則為「控制膠囊」。


## 📝 授權
本項目僅供學習與研究使用。