/**
 * Qwen (通义千问) proxy controller.
 *
 * 功能：
 * - 接收前端传来的 message（以及可选的会话 ID）
 * - 在后端本地文件中维护每个 session 的对话历史（轻量持久化“记忆”）
 * - 把最近 N 轮对话作为 messages 发送到 Qwen API (OpenAI 兼容模式)
 * - 把结果以简单 JSON 返回给前端
 *
 * 注意：这里的“记忆”通过本地文件持久化存储，服务重启后仍可保留最近历史。
 */

// Qwen API 使用 OpenAI 兼容模式
const QWEN_API_BASE_URL =
  process.env.QWEN_API_BASE_URL ||
  'https://dashscope.aliyuncs.com/compatible-mode/v1';

// 文本模型（纯文本对话）
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen-plus-2025-07-28';
// 多模态模型（图片+文本）
const QWEN_VL_MODEL = process.env.QWEN_VL_MODEL || 'qwen3-vl-plus';

// 思考模式开关（enable_thinking）：通过环境变量控制，前端暂不暴露
// QWEN_ENABLE_THINKING = 'true' / 'false'
// QWEN_THINKING_BUDGET = 8192（令牌预算，可选）
const ENABLE_THINKING = String(process.env.QWEN_ENABLE_THINKING || '').toLowerCase() === 'true';
const THINKING_BUDGET = Number.parseInt(process.env.QWEN_THINKING_BUDGET || '', 10) || 8192;

// 后端持久化会话存储（本地 JSON 文件）
// 用于维护每个会话的对话历史，实现上下文记忆
import { getRecentMessages, appendMessages, deleteSession, clearAllSessions } from '../sessionStore.js';
import crypto from 'crypto';

// 每个会话最多保留多少条 messages（防止上下文无限变长）
const MAX_HISTORY_MESSAGES = 24; // 例如最多保留最近 12 轮对话

/**
 * POST /api/chat/completions
 * body: { message: string, sessionId?: string, imageBase64?: string, imagesBase64?: string[] }
 * 
 * 支持三种模式：
 * 1. 纯文本：message 为字符串，使用 QWEN_MODEL
 * 2. 多模态（单图）：imageBase64 存在时，使用 QWEN_VL_MODEL，message 可选（作为附加文本）
 * 3. 多模态（多图）：imagesBase64 数组存在时，使用 QWEN_VL_MODEL，支持多张图片
 * 
 * 注意：imageBase64 和 imagesBase64 可以同时存在，会合并处理（向后兼容）
 */
export async function postChatCompletion(req, res) {
  const { message, sessionId, imageBase64, imagesBase64 } = req.body || {};
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;

  // 验证：至少要有 message 或图片之一
  const hasMessage = message !== undefined && message !== null && message !== '';
  
  // 处理图片：支持单图（imageBase64）和多图（imagesBase64）两种格式
  const singleImage = imageBase64 !== undefined && imageBase64 !== null && imageBase64 !== '';
  const multipleImages = Array.isArray(imagesBase64) && imagesBase64.length > 0;
  const hasImages = singleImage || multipleImages;
  
  if (!hasMessage && !hasImages) {
    return res.status(400).json({ 
      error: 'Either message or image(s) is required',
      requestId,
    });
  }

  // 如果有图片，message 可以是空字符串或可选文本
  const userText = hasMessage ? message : (hasImages ? '请描述这些图片' : '');

  // 使用 DASHSCOPE_API_KEY 作为环境变量名（与官方文档一致）
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;

  if (!apiKey) {
    // 方便本地调试：如果没有 key，就返回一个 fake 回复
    return res.json({
      sessionId: sessionId || 'local-demo-session',
      reply:
        '（模拟回复）当前未配置 DASHSCOPE_API_KEY，请在 backend/.env 中设置后再调用真实 Qwen 接口。',
      requestId,
    });
  }

  try {
    // 1. 根据 sessionId 获取历史上下文（持久化版“记忆”）
    const sid = sessionId || 'session-' + Date.now();
    const history = await getRecentMessages(sid, MAX_HISTORY_MESSAGES);

    // 2. 构造当前用户消息
    let currentUserMessage;
    if (hasImages) {
      // 多模态消息：图片 + 文本
      // 收集所有图片（支持单图和多图两种格式）
      const allImages = [];
      
      // 处理单图格式（向后兼容）
      if (singleImage) {
        const imageDataUrl = imageBase64.startsWith('data:')
          ? imageBase64
          : `data:image/jpeg;base64,${imageBase64}`;
        allImages.push({ type: 'image_url', image_url: { url: imageDataUrl } });
      }
      
      // 处理多图格式
      if (multipleImages) {
        for (const imgBase64 of imagesBase64) {
          if (imgBase64) {
            const imageDataUrl = imgBase64.startsWith('data:')
              ? imgBase64
              : `data:image/jpeg;base64,${imgBase64}`;
            allImages.push({ type: 'image_url', image_url: { url: imageDataUrl } });
          }
        }
      }
      
      // 构建 content 数组：所有图片 + 文本
      currentUserMessage = {
        role: 'user',
        content: [
          ...allImages,
          { type: 'text', text: userText },
        ],
      };
    } else {
      // 纯文本消息
      currentUserMessage = {
        role: 'user',
        content: userText,
      };
    }

    // 3. 将当前消息追加到历史（注意：这里先不写回 Map，等拿到 AI 回复后再统一写回）
    const messages = [...history, currentUserMessage];

    // 4. 控制上下文长度，只保留最近的 MAX_HISTORY_MESSAGES 条
    const trimmedMessages =
      messages.length > MAX_HISTORY_MESSAGES
        ? messages.slice(messages.length - MAX_HISTORY_MESSAGES)
        : messages;

    // 5. 根据是否有图片选择模型
    // 纯文本消息使用 QWEN_MODEL，带图片的消息使用 QWEN_VL_MODEL（多模态模型）
    const model = hasImages ? QWEN_VL_MODEL : QWEN_MODEL;
    
    // 日志：显示使用的模型（方便调试）
    const imageCount = hasImages ? (singleImage ? 1 : (multipleImages ? imagesBase64.length : 0)) : 0;
    console.info(
      `[API] requestId=${requestId} 请求类型: ${hasImages ? `多模态（${imageCount}张图片+文本）` : '纯文本'}, 使用模型: ${model}`
    );

    // 6. 调用 Qwen API (非流式)
    const requestBody = {
      model: model,
      messages: trimmedMessages,
      stream: false, // 非流式调用
    };

    // 如果启用思考模式，则为支持的模型透传 enable_thinking / thinking_budget
    //（当前主要针对 QWEN3 系列模型，如 qwen3-vl-plus，纯文本模型也可按需打开）
    if (ENABLE_THINKING) {
      requestBody.enable_thinking = true;
      requestBody.thinking_budget = THINKING_BUDGET;
    }

    const response = await fetch(`${QWEN_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Qwen API error:', response.status, `requestId=${requestId}`, errorText);
      return res.status(response.status || 502).json({
        error: 'Qwen API error',
        detail: errorText,
        requestId,
      });
    }

    const data = await response.json();

    // 解析 OpenAI 兼容格式的响应
    let reply =
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.delta?.content ||
      data.output?.text ||
      '';

    if (!reply || typeof reply !== 'string') {
      reply = '很抱歉，暂时没有生成内容，请稍后再试。';
      console.warn(`[API] requestId=${requestId} 空回复，已使用兜底文案`);
    }

    // 7. 把这轮「问 + 答」写回会话历史，实现持久化记忆
    // 注意：对于多模态消息，content 可能是结构化对象，这里会在 sessionStore 中序列化保存
    await appendMessages(sid, [
      currentUserMessage,
      { role: 'assistant', content: reply },
    ]);

    return res.json({
      sessionId: sid,
      reply,
      requestId,
    });
  } catch (err) {
    console.error('Qwen request failed:', `requestId=${requestId}`, err);
    return res.status(500).json({ 
      error: 'Internal server error',
      detail: err.message,
      requestId,
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
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `title-${Date.now()}`;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required', requestId });
  }

  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;

  if (!apiKey) {
    // 没有 Key 时，退化为默认标题
    return res.json({ title: '新会话', requestId });
  }

  try {
    const history = await getRecentMessages(sessionId, 32);
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
      console.error('Qwen title API error:', response.status, `requestId=${requestId}`, errorText);
      return res.status(502).json({ error: 'Qwen title API error', requestId });
    }

    const data = await response.json();
    let title =
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.delta?.content ||
      data.output?.text ||
      '';

    // 简单清洗：去掉引号和换行
    title = String(title).replace(/["“”]/g, '').split('\n')[0].trim();
    if (!title) {
      title = '新会话';
      console.warn(`[API] requestId=${requestId} 标题为空，已使用默认标题`);
    }

    return res.json({ title, requestId });
  } catch (err) {
    console.error('Qwen title request failed:', `requestId=${requestId}`, err);
    return res.status(500).json({
      error: 'Internal server error',
      detail: err.message,
      requestId,
    });
  }
}

/**
 * DELETE /api/chat/sessions/:sessionId
 * 删除指定会话的上下文历史
 */
export async function deleteSessionHistory(req, res) {
  const { sessionId } = req.params || {};
  
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  try {
    await deleteSession(sessionId);
    return res.json({ success: true, message: 'Session history deleted' });
  } catch (err) {
    console.error('Delete session history failed:', err);
    return res.status(500).json({
      error: 'Internal server error',
      detail: err.message,
    });
  }
}

/**
 * DELETE /api/chat/sessions
 * 清空所有会话的上下文历史
 */
export async function clearAllSessionsHistory(req, res) {
  try {
    await clearAllSessions();
    return res.json({ success: true, message: 'All sessions history cleared' });
  } catch (err) {
    console.error('Clear all sessions history failed:', err);
    return res.status(500).json({
      error: 'Internal server error',
      detail: err.message,
    });
  }
}

