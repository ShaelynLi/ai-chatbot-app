const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:4000';

async function handleResponse(res) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with status ${res.status}`);
  }
  return res.json();
}

function handleNetworkError(error) {
  if (error.message === 'Network request failed' || error.message.includes('Network')) {
    throw new Error(
      '无法连接到后端服务。请确保后端服务正在运行，并且如果使用真机测试，请配置正确的后端地址。'
    );
  }
  throw error;
}

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

// 根据会话内容自动生成标题（用于侧边栏展示）
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

