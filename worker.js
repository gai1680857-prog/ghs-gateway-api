/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  GHS Gateway V2 — Claude Code Architecture Edition      ║
 * ║                                                         ║
 * ║  五大設計模式實裝：                                       ║
 * ║  1. Tool-as-Module   — 插件式工具架構                    ║
 * ║  2. Agent Loop       — LLM talks, program walks         ║
 * ║  3. Memory Index     — 三層記憶體 KV 索引               ║
 * ║  4. Feature Flags    — KV 遠端切換不重新部署             ║
 * ║  5. Pre/Post Hooks   — 攔截 + 審計 + 通知               ║
 * ║                                                         ║
 * ║  Endpoints:                                             ║
 * ║    POST /v1/chat          → AI Agent 對話 (tool calling)║
 * ║    POST /v1/generate      → 內容生成                    ║
 * ║    POST /webhook/:source  → Webhook 接收                ║
 * ║    GET  /api/health       → 健康檢查                    ║
 * ║    GET  /api/tools        → 工具列表                    ║
 * ║    GET  /api/flags        → Feature Flags 狀態          ║
 * ║    GET  /api/logs         → 最近操作日誌                ║
 * ║    POST /api/flags        → 更新 Feature Flags          ║
 * ║    POST /api/memory       → 更新記憶索引                ║
 * ╚══════════════════════════════════════════════════════════╝
 */

// ============================================================
// 1. TOOL-AS-MODULE — 插件式工具架構
//    每個工具 = { name, description, schema, risk, execute }
//    統一介面，獨立權限，各自驗證
// ============================================================

function defineTools(env) {
  return {
    // ──── 查詢類 (低風險，自動執行) ────
    'query-faq': {
      name: 'query-faq',
      description: '查詢 FAQ 知識庫，回傳最相關的 FAQ 條目',
      schema: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '搜尋關鍵字' }
        },
        required: ['keyword']
      },
      risk: 'low',
      async execute(input, ctx) {
        // 從 D1 faq 表搜尋
        const results = await ctx.env.DB.prepare(
          `SELECT question, answer, category FROM faq 
           WHERE question LIKE ?1 OR answer LIKE ?1 OR category LIKE ?1
           ORDER BY sort_order ASC LIMIT 5`
        ).bind(`%${input.keyword}%`).all();
        return {
          success: true,
          count: results.results.length,
          items: results.results.map(r => ({
            question: r.question,
            answer: r.answer,
            category: r.category
          }))
        };
      }
    },

    'query-announcement': {
      name: 'query-announcement',
      description: '查詢最新公告',
      schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '回傳數量', default: 3 }
        }
      },
      risk: 'low',
      async execute(input, ctx) {
        const limit = input.limit || 3;
        const results = await ctx.env.DB.prepare(
          `SELECT title, content, created_at FROM announcements 
           WHERE active = 1 ORDER BY created_at DESC LIMIT ?1`
        ).bind(limit).all();
        return { success: true, announcements: results.results };
      }
    },

    'check-campaign': {
      name: 'check-campaign',
      description: '查詢當前進行中的活動資訊',
      schema: {
        type: 'object',
        properties: {
          campaign_type: { type: 'string', description: '活動類型：deposit/slot/baccarat/daily/all', default: 'all' }
        }
      },
      risk: 'low',
      async execute(input, ctx) {
        const campaigns = JSON.parse(
          await ctx.env.KV.get('memory:topic:campaigns') || '[]'
        );
        if (input.campaign_type === 'all') return { success: true, campaigns };
        const filtered = campaigns.filter(c => c.type === input.campaign_type);
        return { success: true, campaigns: filtered };
      }
    },

    'get-vip-rules': {
      name: 'get-vip-rules',
      description: '查詢 VIP 等級規則和福利',
      schema: {
        type: 'object',
        properties: {
          level: { type: 'string', description: 'VIP 等級或 all', default: 'all' }
        }
      },
      risk: 'low',
      async execute(input, ctx) {
        const rules = await ctx.env.KV.get('memory:topic:vip-rules');
        return { success: true, rules: JSON.parse(rules || '{}') };
      }
    },

    // ──── 動作類 (中風險，需 Hook 記錄) ────
    'send-telegram': {
      name: 'send-telegram',
      description: '發送 Telegram 訊息到指定群組或用戶',
      schema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'Telegram Chat ID' },
          message: { type: 'string', description: '訊息內容' },
          parse_mode: { type: 'string', default: 'HTML' }
        },
        required: ['chat_id', 'message']
      },
      risk: 'medium',
      async execute(input, ctx) {
        const resp = await fetch(
          `https://api.telegram.org/bot${ctx.env.TG_TOKEN}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: input.chat_id,
              text: input.message,
              parse_mode: input.parse_mode || 'HTML'
            })
          }
        );
        const data = await resp.json();
        return { success: data.ok, message_id: data.result?.message_id };
      }
    },

    'generate-content': {
      name: 'generate-content',
      description: '使用 AI 生成內容（貼文、客服話術、提示詞）',
      schema: {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'threads_post / customer_service / freepik_prompt / campaign_plan' },
          prompt: { type: 'string', description: '生成指令' },
          count: { type: 'number', default: 1 }
        },
        required: ['template', 'prompt']
      },
      risk: 'medium',
      async execute(input, ctx) {
        const templates = {
          threads_post: '你是專業社群文案寫手，為台灣線上娛樂產業撰寫 Threads 貼文。繁體中文、口語化、含 hashtag、100-200 字。',
          customer_service: '你是專業客服人員，為線上娛樂城撰寫客服回覆模板。友善專業、解決問題導向。',
          freepik_prompt: '你是 AI 圖片生成提示詞專家。產出英文 Freepik Mystic API prompt，風格精準、描述具體。',
          campaign_plan: '你是活動企劃專家，為線上娛樂城設計月度活動方案。含活動名稱、機制、獎品、時程。'
        };
        const systemPrompt = templates[input.template] || templates.threads_post;
        const results = [];
        for (let i = 0; i < (input.count || 1); i++) {
          const res = await callUpstreamLLM(ctx.env, systemPrompt, input.prompt);
          results.push(res);
        }
        return { success: true, results };
      }
    },

    // ──── 寫入類 (高風險，需完整審計) ────
    'write-kv': {
      name: 'write-kv',
      description: '寫入 KV 資料（需管理員權限）',
      schema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'KV key' },
          value: { type: 'string', description: '要寫入的值' },
          ttl: { type: 'number', description: '過期秒數（可選）' }
        },
        required: ['key', 'value']
      },
      risk: 'high',
      async execute(input, ctx) {
        const opts = input.ttl ? { expirationTtl: input.ttl } : {};
        await ctx.env.KV.put(input.key, input.value, opts);
        return { success: true, key: input.key, written: true };
      }
    },

    'write-d1': {
      name: 'write-d1',
      description: '執行 D1 資料庫寫入操作（需管理員權限）',
      schema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL INSERT/UPDATE 語句' },
          params: { type: 'array', description: '參數綁定', default: [] }
        },
        required: ['sql']
      },
      risk: 'high',
      async execute(input, ctx) {
        // 安全檢查：只允許 INSERT/UPDATE/DELETE
        const upper = input.sql.trim().toUpperCase();
        if (upper.startsWith('DROP') || upper.startsWith('ALTER') || upper.startsWith('CREATE')) {
          return { success: false, error: 'DDL statements not allowed via tool' };
        }
        const result = await ctx.env.DB.prepare(input.sql)
          .bind(...(input.params || []))
          .run();
        return { success: result.success, changes: result.meta?.changes };
      }
    },

    // ──── 系統工具 ────
    'get-datetime': {
      name: 'get-datetime',
      description: '取得目前台灣時間',
      schema: { type: 'object', properties: {} },
      risk: 'low',
      async execute() {
        const now = new Date();
        const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        return {
          success: true,
          utc: now.toISOString(),
          taiwan: tw.toISOString().replace('T', ' ').substring(0, 19),
          weekday: ['日', '一', '二', '三', '四', '五', '六'][tw.getUTCDay()]
        };
      }
    },

    'track-short-url': {
      name: 'track-short-url',
      description: '查詢短網址點擊數據',
      schema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '短網址代碼' }
        },
        required: ['code']
      },
      risk: 'low',
      async execute(input, ctx) {
        // 透過 ghs-short-url Worker 的 API
        try {
          const resp = await fetch(
            `https://ghs-short-url.gai1680857.workers.dev/api/list`
          );
          const data = await resp.json();
          const found = data.find?.(u => u.code === input.code);
          return found
            ? { success: true, ...found }
            : { success: false, error: 'Code not found' };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    }
  };
}

// 產出 Anthropic tool_use 格式的工具定義
function getToolDefs(tools) {
  return Object.values(tools).map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.schema
  }));
}

// ============================================================
// 2. AGENT LOOP — LLM talks, program walks
//    while 迴圈驅動：LLM 決定做什麼，程式驗證並執行
// ============================================================

const MAX_AGENT_TURNS = 8; // 防止無限迴圈

async function agentLoop(userMessage, tools, ctx) {
  const { env, flags, memoryIndex } = ctx;

  // 建構系統提示詞（分層注入上下文）
  const systemPrompt = buildSystemPrompt(memoryIndex, flags, tools);

  const messages = [{ role: 'user', content: userMessage }];
  const toolDefs = getToolDefs(tools);
  const executionLog = []; // 記錄所有工具執行

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    // 呼叫 LLM
    const response = await callAnthropicAPI(env, systemPrompt, messages, toolDefs);

    if (!response.content || response.content.length === 0) {
      return { reply: '抱歉，系統暫時無法回應。', log: executionLog };
    }

    // 找 tool_use blocks
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const textBlocks = response.content.filter(b => b.type === 'text');

    // 沒有工具呼叫 → 回傳文字回應
    if (toolUseBlocks.length === 0) {
      const reply = textBlocks.map(b => b.text).join('\n');
      return { reply, log: executionLog, usage: response.usage };
    }

    // 追加 assistant 回應到歷史
    messages.push({ role: 'assistant', content: response.content });

    // 逐一執行工具呼叫
    const toolResults = [];
    for (const block of toolUseBlocks) {
      const tool = tools[block.name];

      if (!tool) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ error: `Unknown tool: ${block.name}` })
        });
        continue;
      }

      // ===== Pre-Hook: 攔截 + 日誌 =====
      const hookResult = await preToolHook(block.name, block.input, tool, ctx);
      if (hookResult.blocked) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ error: hookResult.reason })
        });
        executionLog.push({
          tool: block.name, input: block.input,
          status: 'blocked', reason: hookResult.reason,
          time: new Date().toISOString()
        });
        continue;
      }

      // ===== 執行工具 =====
      let result;
      try {
        result = await tool.execute(block.input, ctx);
      } catch (err) {
        result = { success: false, error: err.message };
      }

      // ===== Post-Hook: 審計 + 通知 =====
      await postToolHook(block.name, block.input, result, tool, ctx);

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result)
      });

      executionLog.push({
        tool: block.name, input: block.input,
        status: result.success ? 'success' : 'error',
        time: new Date().toISOString()
      });
    }

    // 追加工具結果到歷史
    messages.push({ role: 'user', content: toolResults });
  }

  // 超過最大輪次
  return {
    reply: '已達到最大處理輪次，請簡化您的問題再試一次。',
    log: executionLog
  };
}

// 建構系統提示詞 — 分層注入
function buildSystemPrompt(memoryIndex, flags, tools) {
  let prompt = `你是 GHS 蓋厚勝娛樂城的 AI 助手。

## 核心規則
- 繁體中文回覆
- 友善專業的客服態度
- 不確定的資訊用工具查詢，不要猜測
- 涉及金額、規則的問題必須查詢 FAQ 或公告確認

## 可用工具
你有以下工具可以使用，善用它們回答問題：
${Object.values(tools).map(t => `- ${t.name}: ${t.description}`).join('\n')}

## 工具使用策略
- 用戶問 FAQ 類問題 → 先用 query-faq 查詢
- 用戶問活動 → 先用 check-campaign 查詢
- 用戶問 VIP → 先用 get-vip-rules 查詢
- 不確定的事 → 查詢後再回答
- 需要通知 → 用 send-telegram
`;

  // 注入記憶索引（Layer 1: 永遠在 context）
  if (memoryIndex && memoryIndex.length > 0) {
    prompt += `\n## 記憶索引（可用 topic 關鍵字觸發按需載入）\n`;
    prompt += memoryIndex.map(m =>
      `- [${m.id}] ${m.summary} (更新: ${m.updated})`
    ).join('\n');
    prompt += '\n';
  }

  // 注入 Feature Flags 狀態
  if (flags) {
    const activeFlags = Object.entries(flags).filter(([_, v]) => v);
    if (activeFlags.length > 0) {
      prompt += `\n## 啟用的功能\n`;
      prompt += activeFlags.map(([k]) => `- ${k}`).join('\n');
      prompt += '\n';
    }
  }

  return prompt;
}

// ============================================================
// 3. MEMORY INDEX — 三層記憶體架構 (KV 實現)
//    Layer 1: memory:index → 永遠載入 context (輕量指標)
//    Layer 2: memory:topic:* → 按需由工具載入 (完整內容)
//    Layer 3: memory:dream:* → 背景整合 (Cron 執行)
// ============================================================

async function loadMemoryIndex(env) {
  try {
    const raw = await env.KV.get('memory:index');
    return JSON.parse(raw || '[]');
  } catch {
    return [];
  }
}

async function updateMemoryIndex(env, index) {
  await env.KV.put('memory:index', JSON.stringify(index));
}

async function loadMemoryTopic(env, topicId) {
  return await env.KV.get(`memory:topic:${topicId}`);
}

async function saveMemoryTopic(env, topicId, content, summary) {
  // 寫入完整內容
  await env.KV.put(`memory:topic:${topicId}`, content);

  // 更新索引
  const index = await loadMemoryIndex(env);
  const existing = index.findIndex(m => m.id === topicId);
  const entry = {
    id: topicId,
    summary: summary.substring(0, 150),
    updated: new Date().toISOString().substring(0, 10)
  };
  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }
  await updateMemoryIndex(env, index);
  return index;
}

// ============================================================
// 4. FEATURE FLAGS — KV 遠端切換
//    不用重新部署就能開關功能
// ============================================================

const DEFAULT_FLAGS = {
  AI_AUTO_REPLY: true,        // AI 自動客服回覆
  TOOL_CALLING: true,         // 工具呼叫功能
  CONTENT_GENERATE: true,     // 內容生成 API
  WEBHOOK_RECEIVE: true,      // Webhook 接收
  TG_NOTIFY_HIGH_RISK: true,  // 高風險操作 TG 通知
  AGENT_LOOP: true,           // Agent 迴圈模式
  MEMORY_SYSTEM: true,        // 記憶體系統
  RATE_LIMIT: true,           // 速率限制
  AUDIT_LOG: true,            // 審計日誌
  DREAM_MODE: false,          // 背景記憶整合 (未啟用)
  LINE_AUTO_REPLY: true,      // LINE OA AI 自動回覆
  MULTI_AGENT: false,         // 多 Agent 模式 (未啟用)
  VOICE_MODE: false,          // 語音模式 (未啟用)
};

async function loadFlags(env) {
  try {
    const raw = await env.KV.get('flags');
    if (!raw) return { ...DEFAULT_FLAGS };
    return { ...DEFAULT_FLAGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_FLAGS };
  }
}

async function updateFlags(env, updates) {
  const current = await loadFlags(env);
  const merged = { ...current, ...updates };
  await env.KV.put('flags', JSON.stringify(merged));
  return merged;
}

// ============================================================
// 5. PRE/POST HOOKS — 攔截 + 審計 + 通知
// ============================================================

// Pre-Hook：工具執行前
async function preToolHook(toolName, input, tool, ctx) {
  const { env, flags } = ctx;

  // 審計日誌
  if (flags.AUDIT_LOG) {
    await appendLog(env, {
      event: 'pre_tool',
      tool: toolName,
      input: JSON.stringify(input).substring(0, 500),
      risk: tool.risk,
      time: new Date().toISOString()
    });
  }

  // 高風險工具的安全檢查
  if (tool.risk === 'high') {
    // 檢查是否有管理員權限 (由 ctx.isAdmin 決定)
    if (!ctx.isAdmin) {
      return { blocked: true, reason: 'High-risk tool requires admin auth' };
    }

    // SQL 注入防護
    if (toolName === 'write-d1' && input.sql) {
      const dangerous = /;\s*(DROP|ALTER|CREATE|TRUNCATE)/i;
      if (dangerous.test(input.sql)) {
        return { blocked: true, reason: 'Dangerous SQL pattern detected' };
      }
    }

    // KV 關鍵路徑保護
    if (toolName === 'write-kv' && input.key) {
      const protected_prefixes = ['flags', 'memory:index', 'auth:'];
      if (protected_prefixes.some(p => input.key.startsWith(p))) {
        return { blocked: true, reason: `Protected key prefix: ${input.key}` };
      }
    }
  }

  return { blocked: false };
}

// Post-Hook：工具執行後
async function postToolHook(toolName, input, result, tool, ctx) {
  const { env, flags } = ctx;

  // 審計日誌
  if (flags.AUDIT_LOG) {
    await appendLog(env, {
      event: 'post_tool',
      tool: toolName,
      success: result.success,
      time: new Date().toISOString()
    });
  }

  // 高風險操作 → Telegram 通知
  if (tool.risk === 'high' && flags.TG_NOTIFY_HIGH_RISK && env.TG_TOKEN) {
    const msg = [
      `⚡ <b>高風險工具執行</b>`,
      `工具: <code>${toolName}</code>`,
      `輸入: <code>${JSON.stringify(input).substring(0, 200)}</code>`,
      `結果: ${result.success ? '✅ 成功' : '❌ 失敗'}`,
      `時間: ${new Date().toISOString()}`
    ].join('\n');

    // 非同步發送，不阻塞回應
    ctx.waitUntil?.(
      fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TG_ADMIN_CHAT || '-5133663833',
          text: msg,
          parse_mode: 'HTML'
        })
      }).catch(() => {})
    );
  }

  // 工具執行失敗 → 記錄錯誤
  if (!result.success && flags.AUDIT_LOG) {
    await appendLog(env, {
      event: 'tool_error',
      tool: toolName,
      error: result.error,
      time: new Date().toISOString()
    });
  }
}

// 日誌系統 — 使用 KV 存最近 200 條
async function appendLog(env, entry) {
  try {
    const raw = await env.KV.get('system:logs');
    const logs = JSON.parse(raw || '[]');
    logs.unshift(entry); // 最新的在前面
    // 只保留最近 200 條
    const trimmed = logs.slice(0, 200);
    await env.KV.put('system:logs', JSON.stringify(trimmed));
  } catch {
    // 日誌寫入失敗不應影響主流程
  }
}

async function getLogs(env, limit = 50) {
  try {
    const raw = await env.KV.get('system:logs');
    const logs = JSON.parse(raw || '[]');
    return logs.slice(0, limit);
  } catch {
    return [];
  }
}

// ============================================================
// LLM API 呼叫
// ============================================================

// 上游 LLM 呼叫 (簡單版，用於 generate-content 工具)
async function callUpstreamLLM(env, systemPrompt, userPrompt) {
  const resp = await fetch('https://toapis.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.TOAPIS_KEY}`
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 1024
    })
  });
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// Anthropic API 呼叫 (支援 tool_use)
async function callAnthropicAPI(env, systemPrompt, messages, tools) {
  const resp = await fetch('https://toapis.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.TOAPIS_KEY}`,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: env.AI_MODEL || 'claude-haiku-4-5',
      max_tokens: 2048,
      system: systemPrompt,
      messages,
      tools: tools.length > 0 ? tools : undefined
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`LLM API error ${resp.status}: ${err}`);
  }

  return await resp.json();
}

// ============================================================
// AUTH 認證
// ============================================================

async function authenticate(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return { authenticated: false, isAdmin: false };

  const token = authHeader.replace('Bearer ', '');

  // Admin key 檢查
  if (token === env.ADMIN_KEY) {
    return { authenticated: true, isAdmin: true, userId: 'admin' };
  }

  // 客戶 API key 檢查
  try {
    const userData = await env.KV.get(`auth:${token}`);
    if (userData) {
      const user = JSON.parse(userData);
      if (user.active) {
        return { authenticated: true, isAdmin: false, userId: user.id, user };
      }
    }
  } catch {}

  return { authenticated: false, isAdmin: false };
}

// ============================================================
// RATE LIMITER
// ============================================================

async function checkRateLimit(env, key, maxRequests = 30, windowMs = 60000) {
  const now = Date.now();
  const rlKey = `rl:${key}`;
  const raw = await env.KV.get(rlKey);
  const data = raw ? JSON.parse(raw) : { count: 0, resetAt: now + windowMs };

  if (now > data.resetAt) {
    // 視窗過期，重置
    data.count = 1;
    data.resetAt = now + windowMs;
  } else {
    data.count++;
  }

  await env.KV.put(rlKey, JSON.stringify(data), { expirationTtl: 120 });

  return {
    allowed: data.count <= maxRequests,
    remaining: Math.max(0, maxRequests - data.count),
    resetAt: data.resetAt
  };
}

// ============================================================
// CORS + Response Helpers
// ============================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

function error(msg, status = 400) {
  return json({ error: msg }, status);
}

// ============================================================
// 開發狀況追蹤
// ============================================================

async function getDevStatus(env, dateStr) {
  if (!env.GITHUB_TOKEN) {
    return {
      date: dateStr,
      summary: 'GitHub Token 未設定',
      commit_count: 0,
      files_changed: 0
    };
  }

  try {
    // 拉取今日的 commits (使用者自定，這裡假設是 gai1680857-prog/ghs-gateway-v2)
    const sinceDate = new Date(dateStr + 'T00:00:00Z').toISOString();
    const untilDate = new Date(new Date(dateStr + 'T23:59:59Z').getTime() + 1000).toISOString();

    const resp = await fetch(
      `https://api.github.com/repos/gai1680857-prog/ghs-gateway-v2/commits?since=${sinceDate}&until=${untilDate}&per_page=100`,
      {
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    if (!resp.ok) {
      return {
        date: dateStr,
        summary: `GitHub API error: ${resp.status}`,
        commit_count: 0,
        files_changed: 0
      };
    }

    const commits = await resp.json();
    let totalFiles = 0;
    const msgs = [];

    for (const commit of commits.slice(0, 10)) {
      totalFiles += commit.commit.message.split('\n')[0].length > 0 ? 1 : 0;
      msgs.push(`• ${commit.commit.message.split('\n')[0]}`);
    }

    const summary = msgs.slice(0, 3).join('\n');

    return {
      date: dateStr,
      summary: summary || '無 commits',
      commit_count: commits.length,
      files_changed: totalFiles
    };
  } catch (err) {
    return {
      date: dateStr,
      summary: `Error: ${err.message}`,
      commit_count: 0,
      files_changed: 0
    };
  }
}

// ============================================================
// MAIN ROUTER
// ============================================================

export default {
  async fetch(request, env, execCtx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 載入 Feature Flags
    const flags = await loadFlags(env);

    // ──── Health Check ────
    if (path === '/api/health') {
      return json({
        status: 'ok',
        version: 'v2.1.0',
        arch: 'claude-code-patterns',
        patterns: ['tool-as-module', 'agent-loop', 'memory-index', 'feature-flags', 'pre-post-hooks', 'line-webhook'],
        time: new Date().toISOString()
      });
    }

    // ──── Tool List (public) ────
    if (path === '/api/tools' && request.method === 'GET') {
      const tools = defineTools(env);
      return json({
        tools: Object.values(tools).map(t => ({
          name: t.name,
          description: t.description,
          risk: t.risk,
          schema: t.schema
        }))
      });
    }

    // ──── Auth required from here ────
    const auth = await authenticate(request, env);

    // ──── Rate Limit ────
    if (flags.RATE_LIMIT && auth.authenticated) {
      const rl = await checkRateLimit(env, auth.userId);
      if (!rl.allowed) {
        return error('Rate limit exceeded', 429);
      }
    }

    // ──── AI Agent Chat ────
    if (path === '/v1/chat' && request.method === 'POST') {
      if (!auth.authenticated) return error('Unauthorized', 401);
      if (!flags.AI_AUTO_REPLY) return error('AI chat is disabled', 503);

      const body = await request.json();
      const userMessage = body.message || body.content;
      if (!userMessage) return error('Missing message field');

      const tools = defineTools(env);
      const memoryIndex = flags.MEMORY_SYSTEM ? await loadMemoryIndex(env) : [];

      const ctx = {
        env,
        flags,
        memoryIndex,
        isAdmin: auth.isAdmin,
        userId: auth.userId,
        waitUntil: execCtx.waitUntil.bind(execCtx)
      };

      try {
        const result = await agentLoop(userMessage, tools, ctx);
        return json({
          reply: result.reply,
          tools_used: result.log.map(l => l.tool),
          usage: result.usage
        });
      } catch (err) {
        return error(`Agent error: ${err.message}`, 500);
      }
    }

    // ──── Content Generate ────
    if (path === '/v1/generate' && request.method === 'POST') {
      if (!auth.authenticated) return error('Unauthorized', 401);
      if (!flags.CONTENT_GENERATE) return error('Content generation is disabled', 503);

      const body = await request.json();
      if (!body.template || !body.prompt) {
        return error('Missing template or prompt');
      }

      const tools = defineTools(env);
      const ctx = { env, flags, isAdmin: auth.isAdmin };
      const tool = tools['generate-content'];

      // 走 Hook 流程
      const hookResult = await preToolHook('generate-content', body, tool, ctx);
      if (hookResult.blocked) return error(hookResult.reason, 403);

      const result = await tool.execute(body, ctx);
      await postToolHook('generate-content', body, result, tool, {
        ...ctx, waitUntil: execCtx.waitUntil.bind(execCtx)
      });

      return json(result);
    }

    // ──── LINE OA Webhook (AI 自動回覆) ────
    if (path === '/webhook/line' && request.method === 'POST') {
      if (!flags.WEBHOOK_RECEIVE || !flags.AI_AUTO_REPLY) {
        return json({ status: 'disabled' });
      }

      const body = await request.json();
      const events = body.events || [];

      for (const event of events) {
        if (event.type !== 'message' || event.message?.type !== 'text') continue;

        const userMsg = event.message.text;
        const replyToken = event.replyToken;

        // 用 Agent Loop 處理用戶問題
        execCtx.waitUntil((async () => {
          try {
            const tools = defineTools(env);
            const memoryIndex = await loadMemoryIndex(env);
            const ctx = {
              env, flags, memoryIndex,
              isAdmin: false, userId: `line:${event.source?.userId || 'unknown'}`,
            };

            const result = await agentLoop(userMsg, tools, ctx);

            // 動態取 LINE access token
            const tokenResp = await fetch("https://api.line.me/oauth2/v3/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: `grant_type=client_credentials&client_id=${env.LINE_CHANNEL_ID}&client_secret=${env.LINE_CHANNEL_SECRET}`
            });
            const tokenData = await tokenResp.json();
            const lineToken = tokenData.access_token;
            if (!lineToken) throw new Error("Failed to get LINE token");

            // 用 LINE Reply API 回覆
            await fetch('https://api.line.me/v2/bot/message/reply', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${lineToken}`
              },
              body: JSON.stringify({
                replyToken,
                messages: [{
                  type: 'text',
                  text: result.reply.substring(0, 5000) // LINE 限制 5000 字
                }]
              })
            });

            // 記錄
            await appendLog(env, {
              event: 'line_reply',
              user: event.source?.userId,
              question: userMsg.substring(0, 100),
              tools_used: result.log.map(l => l.tool).join(','),
              time: new Date().toISOString()
            });
          } catch (err) {
            await appendLog(env, {
              event: 'line_error',
              error: err.message,
              time: new Date().toISOString()
            });
          }
        })());
      }

      return json({ status: 'ok' });
    }

    // ──── Webhook Receive (Generic) ────
    if (path.startsWith('/webhook/') && request.method === 'POST') {
      if (!flags.WEBHOOK_RECEIVE) return error('Webhooks disabled', 503);

      const source = path.replace('/webhook/', '');
      const body = await request.json();

      // 簽名驗證 (如果有設定)
      if (env.WEBHOOK_SECRET) {
        const sig = request.headers.get('x-webhook-signature') ||
                    request.headers.get('x-hub-signature-256');
        // 基本驗證 — 生產環境應改用 HMAC
        if (sig && sig !== env.WEBHOOK_SECRET) {
          return error('Invalid signature', 403);
        }
      }

      // Idempotency 檢查
      const eventId = request.headers.get('x-event-id') || body.event_id;
      if (eventId) {
        const seen = await env.KV.get(`webhook:seen:${eventId}`);
        if (seen) return json({ status: 'duplicate', eventId });
        await env.KV.put(`webhook:seen:${eventId}`, '1', { expirationTtl: 86400 });
      }

      // 記錄 webhook
      await appendLog(env, {
        event: 'webhook',
        source,
        body: JSON.stringify(body).substring(0, 500),
        time: new Date().toISOString()
      });

      // TG 通知
      if (env.TG_TOKEN && flags.TG_NOTIFY_HIGH_RISK) {
        execCtx.waitUntil(
          fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: env.TG_ADMIN_CHAT || '-5133663833',
              text: `📨 Webhook [${source}]\n<code>${JSON.stringify(body).substring(0, 300)}</code>`,
              parse_mode: 'HTML'
            })
          }).catch(() => {})
        );
      }

      return json({ status: 'received', source, eventId });
    }

    // ══════ Admin Endpoints ══════

    // ──── Flags ────
    if (path === '/api/flags') {
      if (!auth.isAdmin) return error('Admin required', 403);

      if (request.method === 'GET') {
        return json({ flags });
      }
      if (request.method === 'POST') {
        const updates = await request.json();
        const merged = await updateFlags(env, updates);
        return json({ flags: merged, updated: true });
      }
    }

    // ──── Logs ────
    if (path === '/api/logs' && request.method === 'GET') {
      if (!auth.isAdmin) return error('Admin required', 403);
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const logs = await getLogs(env, limit);
      return json({ logs, count: logs.length });
    }

    // ──── 每日優惠建議 ────
    if (path === '/api/suggestions/today' && request.method === 'GET') {
      const today = new Date().toISOString().split('T')[0];
      const data = await env.KV.get(`suggestions:daily:${today}`);
      if (!data) return json({ date: today, content: null, status: 'pending' });
      return json(JSON.parse(data));
    }

    if (path === '/api/suggestions/history' && request.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '7');
      const results = [];
      for (let i = 0; i < limit; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const data = await env.KV.get(`suggestions:daily:${dateStr}`);
        if (data) results.push(JSON.parse(data));
      }
      return json({ suggestions: results, count: results.length });
    }

    // ──── 開發狀況面板 ────
    if (path === '/api/dev-status/today' && request.method === 'GET') {
      const today = new Date().toISOString().split('T')[0];
      const data = await env.KV.get(`dev-status:${today}`);
      if (!data) return json({ date: today, summary: 'No data yet', commit_count: 0 });
      return json(JSON.parse(data));
    }

    if (path === '/api/dev-status/history' && request.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '7');
      const results = [];
      for (let i = 0; i < limit; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const data = await env.KV.get(`dev-status:${dateStr}`);
        if (data) results.push(JSON.parse(data));
      }
      return json({ statuses: results, count: results.length });
    }

    // ──── Memory ────
    if (path === '/api/memory') {
      if (!auth.isAdmin) return error('Admin required', 403);

      if (request.method === 'GET') {
        const index = await loadMemoryIndex(env);
        return json({ index });
      }
      if (request.method === 'POST') {
        const body = await request.json();
        if (body.action === 'update-topic') {
          const index = await saveMemoryTopic(
            env, body.topicId, body.content, body.summary
          );
          return json({ index, updated: true });
        }
        if (body.action === 'update-index') {
          await updateMemoryIndex(env, body.index);
          return json({ updated: true });
        }
      }
    }

    // ──── 404 ────
    return error('Not found', 404);
  },

  // ============================================================
  // CRON — 背景記憶整合 (Dream Mode)
  // ============================================================
  async scheduled(event, env, ctx) {
    const flags = await loadFlags(env);
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const utcHour = now.getUTCHours();

    // ════ 08:00 UTC: 生成每日優惠建議 + 開發狀況 ════
    if (utcHour === 8) {
      try {
        // 1️⃣ 生成優惠建議
        if (flags.AI_AUTO_REPLY) {
          const suggestionPrompt = `你是 GHS 蓋厚勝娛樂城的營運助手。
基於現在的遊戲熱度和用戶習慣，生成 3 個今日最佳優惠建議。
格式：
【優惠名稱】
簡述（50字以內）
目標客群
預期效果`;

          const suggestion = await callLLM(env, [
            { role: 'user', content: suggestionPrompt }
          ]);

          const sugData = {
            date: todayStr,
            content: suggestion.text,
            generated_at: now.toISOString(),
            status: 'active'
          };

          // 存 KV (快速讀取)
          await env.KV.put(
            `suggestions:daily:${todayStr}`,
            JSON.stringify(sugData),
            { expirationTtl: 86400 * 7 }
          );

          // 存 D1 (歷史記錄)
          await env.DB.prepare(
            `INSERT INTO suggestions (id, date, content, generated_at, status)
             VALUES (?1, ?2, ?3, ?4, ?5)`
          ).bind(
            `sug-${todayStr}-${Math.random().toString(36).substring(7)}`,
            todayStr,
            suggestion.text,
            now.toISOString(),
            'active'
          ).run();
        }

        // 2️⃣ 拉取開發狀況 (如果有 GitHub Token)
        if (env.GITHUB_TOKEN) {
          const devStatus = await getDevStatus(env, todayStr);

          // 存 KV
          await env.KV.put(
            `dev-status:${todayStr}`,
            JSON.stringify(devStatus),
            { expirationTtl: 86400 * 30 }
          );

          // 推播通知
          if (env.TG_TOKEN) {
            const msg = `📊 *${todayStr} 開發狀況*\n\n${devStatus.summary}\n\n💻 Commits: ${devStatus.commit_count}\n📝 Files: ${devStatus.files_changed}`;
            await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: env.TG_ADMIN_CHAT || '-5133663833',
                text: msg,
                parse_mode: 'Markdown'
              })
            }).catch(() => {});
          }
        }

        // 3️⃣ 推播優惠建議給用戶
        if (env.TG_TOKEN) {
          const msg = `🎯 *今日優惠建議* (${todayStr})\n\n${suggestion.text.substring(0, 200)}...`;
          await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: env.TG_ADMIN_CHAT || '-5133663833',
              text: msg,
              parse_mode: 'Markdown'
            })
          }).catch(() => {});
        }
      } catch (err) {
        console.error('[Cron 08:00] Error:', err.message);
      }
    }

    // ════ 17:00 UTC: 背景記憶整合 (保留舊邏輯) ════
    if (utcHour === 17 && flags.DREAM_MODE) {
      const logs = await getLogs(env, 100);
      const toolLogs = logs.filter(l => l.event === 'post_tool');

      if (toolLogs.length > 0) {
        const usage = {};
        toolLogs.forEach(l => {
          usage[l.tool] = (usage[l.tool] || 0) + 1;
        });

        await saveMemoryTopic(env, 'tool-usage-stats',
          JSON.stringify({ usage, period: now.toISOString(), logCount: toolLogs.length }),
          `工具使用統計：${Object.entries(usage).map(([k,v]) => `${k}(${v})`).join(' ')}`
        );
      }
    }
  }
};
