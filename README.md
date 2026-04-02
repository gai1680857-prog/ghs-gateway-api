# GHS Gateway V2 — Claude Code Architecture Edition

## 架構升級：五大設計模式實裝

| 模式 | 實裝位置 | 說明 |
|------|---------|------|
| Tool-as-Module | `defineTools()` | 10+ 獨立工具，各自 schema/risk/execute |
| Agent Loop | `agentLoop()` | while 迴圈 + tool calling，最多 8 輪 |
| Memory Index | `loadMemoryIndex()` | KV 三層：index → topic → dream |
| Feature Flags | `loadFlags()` | KV 遠端切換，12 個 flag |
| Pre/Post Hooks | `preToolHook()` / `postToolHook()` | 安全攔截 + 審計日誌 + TG 通知 |

---

## 部署步驟

### 1. 建 KV Namespace

```bash
npx wrangler kv namespace create "GHS_GATEWAY_KV"
```

拿到 ID 填入 `wrangler.toml` 的 `[[kv_namespaces]]` 區塊。

### 2. 設定 Secrets

```bash
npx wrangler secret put TOAPIS_KEY
npx wrangler secret put ADMIN_KEY
npx wrangler secret put TG_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put TG_ADMIN_CHAT
```

### 3. 部署

```bash
npx wrangler deploy
```

部署後網址：`ghs-gateway-v2.gai1680857.workers.dev`

### 4. 灌入初始記憶

```bash
# 灌入 memory:index
curl -X POST https://ghs-gateway-v2.gai1680857.workers.dev/api/memory \
  -H "Authorization: Bearer 你的ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"update-index","index":[
    {"id":"faq-deposit","summary":"入金相關 FAQ","updated":"2026-04-02"},
    {"id":"faq-withdraw","summary":"出金相關 FAQ","updated":"2026-04-02"},
    {"id":"vip-rules","summary":"VIP 等級制度","updated":"2026-04-02"},
    {"id":"campaigns","summary":"當前活動 愚樂連假狂歡月","updated":"2026-04-02"},
    {"id":"platform-info","summary":"平台基本資訊","updated":"2026-04-02"}
  ]}'

# 灌入各 topic (範例)
curl -X POST https://ghs-gateway-v2.gai1680857.workers.dev/api/memory \
  -H "Authorization: Bearer 你的ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"update-topic","topicId":"vip-rules","summary":"VIP 等級制度","content":"銅牌0/銀牌5000週返水0.3%/金牌30000週返水0.5%+生日禮/鑽石100000週返水0.8%+專屬客服/至尊500000週返水1.2%+全套福利"}'
```

---

## API 測試

### 健康檢查

```bash
curl https://ghs-gateway-v2.gai1680857.workers.dev/api/health
```

### 工具列表

```bash
curl https://ghs-gateway-v2.gai1680857.workers.dev/api/tools
```

### AI Agent 對話（核心功能）

```bash
# 簡單問題 — Agent 會自動呼叫 query-faq 工具
curl -X POST https://ghs-gateway-v2.gai1680857.workers.dev/v1/chat \
  -H "Authorization: Bearer 你的ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"入金最低多少？多久到帳？"}'

# 活動查詢 — Agent 會呼叫 check-campaign
curl -X POST https://ghs-gateway-v2.gai1680857.workers.dev/v1/chat \
  -H "Authorization: Bearer 你的ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"現在有什麼優惠活動？"}'

# VIP 問題 — Agent 會呼叫 get-vip-rules
curl -X POST https://ghs-gateway-v2.gai1680857.workers.dev/v1/chat \
  -H "Authorization: Bearer 你的ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"VIP 鑽石等級要充多少？有什麼福利？"}'

# 複合問題 — Agent 可能連續呼叫多個工具
curl -X POST https://ghs-gateway-v2.gai1680857.workers.dev/v1/chat \
  -H "Authorization: Bearer 你的ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"我是新會員，有什麼首充優惠？入金方式有哪些？"}'
```

### 內容生成

```bash
# Threads 貼文
curl -X POST https://ghs-gateway-v2.gai1680857.workers.dev/v1/generate \
  -H "Authorization: Bearer 你的ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"template":"threads_post","prompt":"愚人節活動 — 猜謎送彩金","count":3}'

# Freepik 提示詞
curl -X POST https://ghs-gateway-v2.gai1680857.workers.dev/v1/generate \
  -H "Authorization: Bearer 你的ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"template":"freepik_prompt","prompt":"四月活動 banner 櫻花主題 Q版財神"}'
```

### Webhook 接收

```bash
curl -X POST https://ghs-gateway-v2.gai1680857.workers.dev/webhook/payment \
  -H "Content-Type: application/json" \
  -H "x-event-id: test-001" \
  -d '{"order_id":"test001","user_id":"player123","amount":1000,"status":"success"}'
```

### Feature Flags 管理

```bash
# 查看所有 flags
curl https://ghs-gateway-v2.gai1680857.workers.dev/api/flags \
  -H "Authorization: Bearer 你的ADMIN_KEY"

# 更新 flags（不用重新部署！）
curl -X POST https://ghs-gateway-v2.gai1680857.workers.dev/api/flags \
  -H "Authorization: Bearer 你的ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"DREAM_MODE":true,"MULTI_AGENT":false}'

# 緊急關閉 AI 回覆
curl -X POST https://ghs-gateway-v2.gai1680857.workers.dev/api/flags \
  -H "Authorization: Bearer 你的ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"AI_AUTO_REPLY":false}'
```

### 日誌查看

```bash
curl "https://ghs-gateway-v2.gai1680857.workers.dev/api/logs?limit=20" \
  -H "Authorization: Bearer 你的ADMIN_KEY"
```

### 記憶索引管理

```bash
# 查看索引
curl https://ghs-gateway-v2.gai1680857.workers.dev/api/memory \
  -H "Authorization: Bearer 你的ADMIN_KEY"

# 新增/更新 topic
curl -X POST https://ghs-gateway-v2.gai1680857.workers.dev/api/memory \
  -H "Authorization: Bearer 你的ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"update-topic","topicId":"new-rules","summary":"2026年4月新規則","content":"完整規則內容..."}'
```

---

## 架構圖

```
用戶請求
  │
  ▼
┌─────────────┐
│   Router    │ → /api/health, /api/tools, /api/flags, /api/logs
└──────┬──────┘
       │
  ┌────┴────┐
  ▼         ▼
/v1/chat  /v1/generate  /webhook/:source
  │         │              │
  ▼         │              ▼
Auth ───────┼──────────> Flags Check
  │         │              │
  ▼         │              ▼
Rate Limit  │           Log + TG Notify
  │         │
  ▼         ▼
┌──────────────────┐
│   Agent Loop     │ ← Memory Index (Layer 1)
│   while(turns)   │
│     │            │
│     ▼            │
│   Call LLM       │
│     │            │
│     ▼            │
│   tool_use?      │
│   ┌─yes──┐       │
│   ▼      │       │
│ Pre-Hook │       │
│   │      │       │
│   ▼      │       │
│ Execute  │       │
│   │      │       │
│   ▼      │       │
│ Post-Hook│       │
│   │      │       │
│   ▼      │       │
│ Continue │       │
│   └──────┘       │
│                  │
│   end_turn → Reply
└──────────────────┘
```

---

## 工具清單

| 工具 | 風險 | 用途 | 自動執行 |
|------|------|------|---------|
| query-faq | low | 搜尋 FAQ 知識庫 | ✅ |
| query-announcement | low | 查詢最新公告 | ✅ |
| check-campaign | low | 查詢活動資訊 | ✅ |
| get-vip-rules | low | 查詢 VIP 規則 | ✅ |
| get-datetime | low | 取得台灣時間 | ✅ |
| track-short-url | low | 短網址數據 | ✅ |
| send-telegram | medium | 發送 TG 訊息 | Hook 記錄 |
| generate-content | medium | AI 內容生成 | Hook 記錄 |
| write-kv | high | 寫入 KV | 需 Admin + Hook + TG 通知 |
| write-d1 | high | D1 資料庫寫入 | 需 Admin + Hook + TG 通知 |

---

## Feature Flags 說明

| Flag | 預設 | 說明 |
|------|------|------|
| AI_AUTO_REPLY | ✅ | AI 客服回覆 |
| TOOL_CALLING | ✅ | 工具呼叫 |
| CONTENT_GENERATE | ✅ | 內容生成 API |
| WEBHOOK_RECEIVE | ✅ | Webhook 接收 |
| TG_NOTIFY_HIGH_RISK | ✅ | 高風險操作 TG 通知 |
| AGENT_LOOP | ✅ | Agent 迴圈模式 |
| MEMORY_SYSTEM | ✅ | 記憶體系統 |
| RATE_LIMIT | ✅ | 速率限制 |
| AUDIT_LOG | ✅ | 審計日誌 |
| DREAM_MODE | ❌ | 背景記憶整合（Cron） |
| MULTI_AGENT | ❌ | 多 Agent 模式 |
| VOICE_MODE | ❌ | 語音模式 |
