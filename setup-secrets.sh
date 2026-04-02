#!/bin/bash

# GHS Gateway V2 — 互動式密鑰設定工具

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║   GHS Gateway V2 — Secrets 設定工具                         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 必須設定
echo -e "${BLUE}═══ 第 1 步：必須設定 ═══${NC}"
echo ""

# TOAPIS_KEY
echo -e "${YELLOW}1. TOAPIS_KEY (必須)${NC}"
echo "   用於 AI 優惠建議生成"
echo "   來源: https://toapis.com"
echo "   格式: sk-xxx..."
echo ""
read -p "   按 Enter 開始設定 TOAPIS_KEY (或 Ctrl+C 跳過)..."
wrangler secret put TOAPIS_KEY
echo -e "${GREEN}   ✅ TOAPIS_KEY 已設定${NC}"
echo ""

# ADMIN_KEY
echo -e "${YELLOW}2. ADMIN_KEY (必須)${NC}"
echo "   Dashboard 管理員密鑰 (自訂即可)"
echo "   建議使用強密碼，長度 16+ 含大小寫和特殊字符"
echo ""
read -p "   按 Enter 開始設定 ADMIN_KEY..."
wrangler secret put ADMIN_KEY
echo -e "${GREEN}   ✅ ADMIN_KEY 已設定${NC}"
echo ""

# 可選設定
echo -e "${BLUE}═══ 第 2 步：可選設定 ═══${NC}"
echo ""

# GITHUB_TOKEN
echo -e "${YELLOW}3. GITHUB_TOKEN (可選但推薦)${NC}"
echo "   用於自動追蹤開發狀況 (commits)"
echo "   來源: https://github.com/settings/tokens"
echo "   需要 scopes: read:user, public_repo"
echo ""
read -p "   要設定 GITHUB_TOKEN 嗎? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  wrangler secret put GITHUB_TOKEN
  echo -e "${GREEN}   ✅ GITHUB_TOKEN 已設定${NC}"
else
  echo -e "${YELLOW}   ⊘ GITHUB_TOKEN 跳過${NC}"
fi
echo ""

# TG_TOKEN
echo -e "${YELLOW}4. TG_TOKEN (可選)${NC}"
echo "   用於 Telegram 推播通知"
echo "   來源: @BotFather (Telegram)"
echo ""
read -p "   要設定 TG_TOKEN 嗎? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  wrangler secret put TG_TOKEN
  echo -e "${GREEN}   ✅ TG_TOKEN 已設定${NC}"
  
  # TG_ADMIN_CHAT
  echo ""
  echo -e "${YELLOW}5. TG_ADMIN_CHAT (必須配合 TG_TOKEN)${NC}"
  echo "   接收通知的 Telegram Chat ID (通常是負數)"
  echo "   查詢方式: 在 Telegram 搜尋 @userinfobot"
  echo ""
  read -p "   按 Enter 設定 TG_ADMIN_CHAT..."
  wrangler secret put TG_ADMIN_CHAT
  echo -e "${GREEN}   ✅ TG_ADMIN_CHAT 已設定${NC}"
else
  echo -e "${YELLOW}   ⊘ TG_TOKEN 跳過 (無法發送 Telegram 通知)${NC}"
fi

echo ""
echo -e "${BLUE}═══ 第 3 步：部署 ═══${NC}"
echo ""
read -p "按 Enter 開始重新部署到 Cloudflare..."

cd /Users/xiang/Downloads/fi001les
npx wrangler deploy

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ 設定完成！${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""
echo "📍 Worker 網址:"
echo "   https://ghs-gateway-v2.gai1680857.workers.dev"
echo ""
echo "📊 Dashboard 網址:"
echo "   https://ghs-gateway-v2.gai1680857.workers.dev/"
echo "   (用 ADMIN_KEY 登入)"
echo ""
echo "🔍 查看 secrets 狀態:"
echo "   wrangler secret list"
echo ""
echo "📝 查看日誌:"
echo "   curl https://ghs-gateway-v2.gai1680857.workers.dev/api/logs \\"
echo "     -H 'Authorization: Bearer YOUR_ADMIN_KEY'"
echo ""
echo "💡 提示:"
echo "   - 優惠建議每天 UTC 08:00 (台灣 16:00) 自動生成"
echo "   - 開發狀況每天同時自動追蹤"
echo "   - Telegram 通知同步推送"
echo ""
