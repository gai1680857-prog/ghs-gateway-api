# GHS Gateway V2 — Secrets 設定指南

## 必須設定 (核心功能)

### 1. TOAPIS_KEY — AI API 認證
用於每日優惠建議生成。

**來源：** https://toapis.com
**格式：** 通常以 `sk-` 開頭

```bash
wrangler secret put TOAPIS_KEY
# 當提示時貼上你的 API key，按 Enter 確認
```

**測試命令：**
```bash
curl https://ghs-gateway-v2.gai1680857.workers.dev/api/suggestions/today \
  -H "Authorization: Bearer YOUR_ADMIN_KEY"
```

### 2. ADMIN_KEY — Dashboard 管理員密鑰
用於保護 Dashboard 和 API 存取。可以自訂任意密鑰。

**建議設定方式：** 使用強密碼 (長度 16+，含大小寫和特殊字符)

```bash
wrangler secret put ADMIN_KEY
# 輸入你想設定的密鑰，例如: GHS_Admin_2024_SecureKey123!
```

---

## 可選但推薦

### 3. GITHUB_TOKEN — 開發狀況追蹤
用於自動拉取你的 GitHub commits，展示每日開發進度。

**來源：** https://github.com/settings/tokens

**建立步驟：**
1. 進入 GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. 點 "Generate new token (classic)"
3. Token name: `ghs-gateway-v2`
4. Expiration: 90 days (或更長)
5. **Select scopes:**
   - ☑ `read:user` (讀取公開信息)
   - ☑ `public_repo` (讀取 public commits)
6. 點 "Generate token"
7. 複製 token (只會顯示一次！)

```bash
wrangler secret put GITHUB_TOKEN
# 貼上你的 personal access token
```

**測試命令：**
```bash
curl https://ghs-gateway-v2.gai1680857.workers.dev/api/dev-status/today \
  -H "Authorization: Bearer YOUR_ADMIN_KEY"
```

### 4. TG_TOKEN — Telegram Bot Token
用於推播優惠建議和開發狀況通知。

**來源：** @BotFather (Telegram)

**建立步驟：**
1. 在 Telegram 搜尋 @BotFather
2. 傳送 `/start` 或 `/newbot`
3. 按指示輸入 bot 名稱，例如 `GHS_Gateway_Bot`
4. BotFather 會給你 token，格式: `123456789:ABCdefGHIjklmnoPQRstuvWXYZ`
5. 複製這個 token

```bash
wrangler secret put TG_TOKEN
# 貼上 bot token
```

### 5. TG_ADMIN_CHAT — Telegram Admin Chat ID
接收推播通知的 Telegram Chat ID。通常是負數。

**查詢步驟：**
1. 在 Telegram 搜尋 @userinfobot
2. 傳送 `/start`
3. 機器人會回覆你的 User ID（正數）
4. 如果是 group 或 channel，需要另外取得 Chat ID（負數）

```bash
wrangler secret put TG_ADMIN_CHAT
# 輸入你的 Chat ID，例如: -123456789
```

---

## 完整設定流程

### 快速方式 (推薦)

複製下面指令一行一行執行：

```bash
cd /Users/xiang/Downloads/fi001les

# 必須設定
wrangler secret put TOAPIS_KEY
wrangler secret put ADMIN_KEY

# 可選但推薦
wrangler secret put GITHUB_TOKEN
wrangler secret put TG_TOKEN
wrangler secret put TG_ADMIN_CHAT

# 重新部署
npx wrangler deploy
```

設定完後，打開 Dashboard 測試：
```
https://ghs-gateway-v2.gai1680857.workers.dev/
輸入 ADMIN_KEY，即可看到「Today's Tips」和「Dev Status」面板
```

### 查看已設定的 Secrets

```bash
# 列出所有 secrets (內容被隱藏)
wrangler secret list
```

### 更新/修改 Secret

```bash
# 重新設定某個 secret (會覆蓋舊值)
wrangler secret put TOAPIS_KEY
```

---

## 驗證設定

### 測試 API

**1. 健康檢查 (不需要 TOAPIS_KEY)**
```bash
curl https://ghs-gateway-v2.gai1680857.workers.dev/api/health
```

預期回應：
```json
{
  "status": "ok",
  "version": "v2.1.0",
  "arch": "claude-code-patterns"
}
```

**2. 查看優惠建議 (需要 TOAPIS_KEY + ADMIN_KEY)**
```bash
curl https://ghs-gateway-v2.gai1680857.workers.dev/api/suggestions/today \
  -H "Authorization: Bearer YOUR_ADMIN_KEY"
```

預期回應：
```json
{
  "date": "2026-04-02",
  "content": "【優惠名稱】\n簡述...",
  "status": "pending" // 或 "active" 如果已生成
}
```

**3. 查看開發狀況 (需要 GITHUB_TOKEN + ADMIN_KEY)**
```bash
curl https://ghs-gateway-v2.gai1680857.workers.dev/api/dev-status/today \
  -H "Authorization: Bearer YOUR_ADMIN_KEY"
```

---

## 故障排除

| 問題 | 解決方案 |
|------|----------|
| `401 Unauthorized` | 檢查 ADMIN_KEY 是否正確，或未設定 |
| `400 Bad Request` | 檢查 API 參數格式 |
| 優惠建議始終為空 | 等待 Cron 觸發 (08:00 UTC = 台灣 16:00) 或檢查 TOAPIS_KEY |
| 開發狀況為空 | 檢查 GITHUB_TOKEN 是否設定且權限正確 |
| Telegram 沒收到通知 | 檢查 TG_TOKEN 和 TG_ADMIN_CHAT，確保 bot 已啟動 |

---

## 安全建議

1. **不要** 在 GitHub 或程式碼中寫入 secrets
2. secrets 存儲在 Cloudflare 的加密金鑰庫，Claude 無法讀取
3. 定期輪換 API keys (每 90 天更新一次)
4. GitHub Token 設定最小權限 (不需要 write 權限)
5. 如果 token 洩露，立即在來源服務重新生成

---

## 已設定的 Secrets

設定完後，你可以查看：

```bash
wrangler secret list
```

應該看到類似：
```
┌──────────────────┬──────────────────────┐
│ Name             │ Last Modified        │
├──────────────────┼──────────────────────┤
│ TOAPIS_KEY       │ 2026-04-02 04:18 UTC │
│ ADMIN_KEY        │ 2026-04-02 04:18 UTC │
│ GITHUB_TOKEN     │ 2026-04-02 04:18 UTC │
│ TG_TOKEN         │ 2026-04-02 04:18 UTC │
│ TG_ADMIN_CHAT    │ 2026-04-02 04:18 UTC │
└──────────────────┴──────────────────────┘
```

---

## 下一步

1. ✅ 設定上面的 secrets
2. ✅ 執行 `npx wrangler deploy`
3. ✅ 打開 Dashboard: https://ghs-gateway-v2.gai1680857.workers.dev/
4. ✅ 輸入 ADMIN_KEY 登入
5. ✅ 查看「Today's Tips」和「Dev Status」面板

有問題？ 檢查日誌：
```bash
curl https://ghs-gateway-v2.gai1680857.workers.dev/api/logs \
  -H "Authorization: Bearer YOUR_ADMIN_KEY"
```
