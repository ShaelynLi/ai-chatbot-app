/**
 * Qwen (通义千问) proxy controller.
 *
 * 功能：
 * - 接收前端传来的 message（以及可选的会话 ID）
 * - 在内存中维护每个 session 的对话历史（简单“记忆”）
 * - 把最近 N 轮对话作为 messages 发送到 Qwen API (OpenAI 兼容模式)
 * - 把结果以简单 JSON 返回给前端
 *
 * 注意：这里的“记忆”是进程内内存的，会在服务重启后丢失。
 * 如果以后需要持久化，可以改成读写数据库中的历史记录。
 */

// Qwen API 使用 OpenAI 兼容模式
const QWEN_API_BASE_URL =
  process.env.QWEN_API_BASE_URL ||
  'https://dashscope.aliyuncs.com/compatible-mode/v1';

const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen-plus-2025-07-28';

// 简单的进程内会话记忆：sessionId -> messages[]
// messages 结构符合 OpenAI 兼容格式：{ role: 'user' | 'assistant' | 'system', content: string }
const sessionHistories = new Map();

// 每个会话最多保留多少条 messages（防止上下文无限变长）
const MAX_HISTORY_MESSAGES = 24; // 例如最多保留最近 12 轮对话

/**
 * POST /api/chat/completions
 * body: { message: string, sessionId?: string }
 */
export async function postChatCompletion(req, res) {
  const { message, sessionId } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required and must be a string' });
  }

  // 使用 DASHSCOPE_API_KEY 作为环境变量名（与官方文档一致）
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;

  if (!apiKey) {
    // 方便本地调试：如果没有 key，就返回一个 fake 回复
    return res.json({
      sessionId: sessionId || 'local-demo-session',
      reply:
        '（模拟回复）当前未配置 DASHSCOPE_API_KEY，请在 backend/.env 中设置后再调用真实 Qwen 接口。',
    });
  }

  try {
    // 1. 根据 sessionId 获取历史上下文（简单内存版“记忆”）
    const sid = sessionId || 'session-' + Date.now();
    const history = sessionHistories.get(sid) || [];

    // 当前用户输入追加到历史（注意：这里先不写回 Map，等拿到 AI 回复后再统一写回）
    const messages = [
      ...history,
      { role: 'user', content: message },
    ];

    // 控制上下文长度，只保留最近的 MAX_HISTORY_MESSAGES 条
    const trimmedMessages =
      messages.length > MAX_HISTORY_MESSAGES
        ? messages.slice(messages.length - MAX_HISTORY_MESSAGES)
        : messages;

    // 调用 Qwen API (非流式)
    const response = await fetch(`${QWEN_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: QWEN_MODEL,
        messages: trimmedMessages,
        stream: false, // 非流式调用
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Qwen API error:', response.status, errorText);
      return res.status(response.status || 502).json({
        error: 'Qwen API error',
        detail: errorText,
      });
    }

    const data = await response.json();

    // 解析 OpenAI 兼容格式的响应
    const reply =
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.delta?.content ||
      data.output?.text ||
      JSON.stringify(data);

    // 2. 把这轮「问 + 答」写回会话历史，实现简单记忆
    const newHistory = [
      ...messages,
      { role: 'assistant', content: reply },
    ];
    const trimmedHistory =
      newHistory.length > MAX_HISTORY_MESSAGES
        ? newHistory.slice(newHistory.length - MAX_HISTORY_MESSAGES)
        : newHistory;
    sessionHistories.set(sid, trimmedHistory);

    return res.json({
      sessionId: sid,
      reply,
    });
  } catch (err) {
    console.error('Qwen request failed:', err);
    return res.status(500).json({ 
      error: 'Internal server error',
      detail: err.message 
    });
  }
}

/**
 * POST /api/chat/title
 * body: { sessionId: string }
 * 根据当前会话的历史对话，生成一个简短的标题（用于侧边栏展示）
 */
export async function postChatTitle(req, res) {
  const { sessionId } = req.body || {};

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;

  if (!apiKey) {
    // 没有 Key 时，退化为默认标题
    return res.json({ title: '新会话' });
  }

  try {
    const history = sessionHistories.get(sessionId) || [];
    if (!history.length) {
      return res.json({ title: '新会话' });
    }

    // 取最近若干条对话作为生成标题的上下文
    const recent = history.slice(-8);
    const summaryText = recent
      .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
      .join('\n');

    const messages = [
      {
        role: 'system',
        content:
          '你是对话标题生成器。请根据下面的多轮对话内容，生成一个简洁的中文标题，长度不超过16个字，不要带引号、句号或多余说明，只返回标题本身。',
      },
      {
        role: 'user',
        content: summaryText,
      },
    ];

    const response = await fetch(`${QWEN_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: QWEN_MODEL,
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Qwen title API error:', response.status, errorText);
      return res.status(502).json({ error: 'Qwen title API error' });
    }

    const data = await response.json();
    let title =
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.delta?.content ||
      data.output?.text ||
      '新会话';

    // 简单清洗：去掉引号和换行
    title = String(title).replace(/["“”]/g, '').split('\n')[0].trim();
    if (!title) title = '新会话';

    return res.json({ title });
  } catch (err) {
    console.error('Qwen title request failed:', err);
    return res.status(500).json({
      error: 'Internal server error',
      detail: err.message,
    });
  }
}


