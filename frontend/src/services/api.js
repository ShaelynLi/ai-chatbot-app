/**
 * API 服务模块
 * 
 * 功能：
 * - 封装与后端的 HTTP 通信
 * - 统一处理响应解析和错误处理
 * - 提供友好的错误提示（区分网络错误、业务错误等）
 * - 支持纯文本和多模态（图片+文本）消息发送
 */

// 后端服务地址：优先使用环境变量，否则默认本地开发地址
const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:4000';

/**
 * 处理 HTTP 响应
 * 解析 JSON 响应，处理错误状态码，生成友好的错误消息
 * @param {Response} res - fetch 返回的 Response 对象
 * @returns {Promise<Object>} 解析后的 JSON 数据
 * @throws {Error} 如果响应不成功，抛出包含友好错误消息的 Error
 */
async function handleResponse(res) {
  const text = await res.text();

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // 如果不是合法 JSON，就保留原始文本
      data = null;
    }
  }

  if (!res.ok) {
    // 尝试从后端响应中提取更具体的错误信息
    let serverMessage = '';
    if (data && typeof data === 'object') {
      serverMessage =
        data.error || data.message || data.msg || data.detail || data.reason || '';
    } else if (text) {
      serverMessage = text;
    }

    let friendly = '';
    if (res.status >= 500) {
      friendly =
        'AI 服务暂时不可用，请稍后重试。如果你正在本地开发，请检查后端控制台日志是否有错误。';
    } else if (res.status === 429) {
      friendly = '请求过于频繁，请稍后再试。如在本地测试，请适当放慢提问频率。';
    } else if (res.status === 400) {
      friendly = '请求参数异常，请检查提问内容或图片大小是否合理，然后再试一次。';
    } else if (res.status === 401 || res.status === 403) {
      friendly =
        '认证失败或无权限访问。请确认后端已正确配置 DASHSCOPE_API_KEY，并且密钥没有过期或被撤销。';
    } else {
      friendly = '请求失败，请稍后重试。如果问题持续出现，请检查后端服务配置。';
    }

    if (serverMessage && !friendly.includes(serverMessage)) {
      friendly += `（详情：${serverMessage}）`;
    }

    const error = new Error(friendly);
    error.status = res.status;
    error.rawBody = text;
    throw error;
  }

  // 正常响应：如果后端没有返回 JSON，则返回空对象，避免调用方出错
  return data ?? {};
}

/**
 * 处理网络错误
 * 识别典型的网络错误（连接失败、超时等），并标记为网络错误类型
 * 便于上层逻辑区分网络错误和业务错误，实现离线队列和自动重试
 * @param {Error} error - 原始错误对象
 * @throws {Error} 包含友好错误消息和错误代码的 Error
 */
function handleNetworkError(error) {
  const message = error?.message || '';

  // 典型的 React Native / fetch 网络错误
  if (
    message.includes('Network request failed') ||
    message.includes('Network request timed out') ||
    message.toLowerCase().includes('timeout')
  ) {
    const err = new Error(
      '无法连接到后端服务。\n\n请检查：\n- 当前设备是否已连接网络；\n- 后端是否已在本机 4000 端口启动；\n- 如在真机上测试，请确认 EXPO_PUBLIC_BACKEND_URL 指向你的电脑 IP 地址。'
    );
    // 标记为网络错误，便于上层做“待发送队列”等特殊处理
    err.code = 'NETWORK_ERROR';
    throw err;
  }

  // 主动超时或被中断
  if (error.name === 'AbortError') {
    throw new Error('请求超时，请检查网络状态或稍后重试。');
  }

  // 其它错误保持原样，由上层决定如何展示
  throw error;
}

/**
 * 发送纯文本消息到后端
 * @param {Object} params
 * @param {string} params.message - 用户输入的文本消息
 * @param {string} params.sessionId - 会话 ID（可选）
 * @returns {Promise<{sessionId: string, reply: string}>} 返回会话 ID 和 AI 回复
 */
export async function sendMessageToBackend({ message, sessionId }) {
  try {
    const res = await fetch(`${BASE_URL}/api/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, sessionId }),
    });
    return await handleResponse(res);
  } catch (error) {
    handleNetworkError(error);
  }
}

/**
 * 根据会话内容自动生成标题（用于侧边栏展示）
 * @param {Object} params
 * @param {string} params.sessionId - 会话 ID
 * @returns {Promise<{title: string}>} 返回生成的标题
 */
export async function generateTitleFromBackend({ sessionId }) {
  try {
    const res = await fetch(`${BASE_URL}/api/chat/title`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId }),
    });
    return await handleResponse(res);
  } catch (error) {
    handleNetworkError(error);
  }
}

/**
 * 发送带图片的消息到后端
 * @param {Object} params
 * @param {string} params.message - 可选的文本消息
 * @param {string} params.imageBase64 - 单张图片的 base64 编码（data URL 格式，向后兼容）
 * @param {string[]} params.imagesBase64 - 多张图片的 base64 编码数组（data URL 格式）
 * @param {string} params.sessionId - 会话 ID
 * @returns {Promise<{sessionId: string, reply: string}>}
 */
export async function sendMessageWithImage({ message, imageBase64, imagesBase64, sessionId }) {
  try {
    const res = await fetch(`${BASE_URL}/api/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        message: message || '', 
        imageBase64, // 向后兼容单图格式
        imagesBase64, // 多图格式
        sessionId 
      }),
    });
    return await handleResponse(res);
  } catch (error) {
    handleNetworkError(error);
  }
}

/**
 * 删除后端指定会话的上下文历史
 * @param {string} sessionId - 会话 ID
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function deleteBackendSession(sessionId) {
  try {
    const res = await fetch(`${BASE_URL}/api/chat/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return await handleResponse(res);
  } catch (error) {
    handleNetworkError(error);
  }
}

/**
 * 清空后端所有会话的上下文历史
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function clearAllBackendSessions() {
  try {
    const res = await fetch(`${BASE_URL}/api/chat/sessions`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return await handleResponse(res);
  } catch (error) {
    handleNetworkError(error);
  }
}

