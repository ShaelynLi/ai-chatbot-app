/**
 * 会话历史存储模块（基于本地 JSON 文件）
 * 
 * 功能：
 * - 为每个会话（sessionId）维护最近 N 条对话历史
 * - 使用本地 JSON 文件持久化存储，服务重启后仍可保留历史
 * - 提供内存缓存机制，减少磁盘 I/O
 * - 自动截断过长的历史记录，防止文件无限膨胀
 * 
 * 存储结构：
 * {
 *   sessions: {
 *     "session-123": [
 *       { role: "user", content: "..." },
 *       { role: "assistant", content: "..." }
 *     ]
 *   }
 * }
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 计算 data 目录与存储文件路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', 'data');
const storePath = path.join(dataDir, 'session_store.json');

// 确保 data 目录存在（如果不存在则创建）
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 内存中的缓存，避免频繁读写磁盘
// 首次读取后缓存到内存，后续操作直接修改缓存，最后统一写回文件
let cache = null;
let writeQueue = Promise.resolve(); // 简单写入队列，串行化文件写操作

/**
 * 从文件加载存储数据到内存缓存
 * 如果文件不存在或解析失败，返回空对象
 * @returns {Object} 存储对象，格式为 { sessions: { [sessionId]: Array } }
 */
function loadStore() {
  // 如果已有缓存，直接返回（避免重复读取）
  if (cache) return cache;
  
  // 如果文件不存在，初始化空存储
  if (!fs.existsSync(storePath)) {
    cache = { sessions: {} };
    return cache;
  }
  
  // 尝试读取并解析 JSON 文件
  try {
    const raw = fs.readFileSync(storePath, 'utf-8');
    const parsed = JSON.parse(raw);
    cache = {
      sessions: parsed.sessions || {},
    };
  } catch (e) {
    // 文件损坏或格式错误时，重置为空存储（避免服务崩溃）
    console.warn('[sessionStore] 读取存储文件失败，将重置为空：', e.message);
    cache = { sessions: {} };
  }
  return cache;
}

/**
 * 将存储对象保存到文件
 * 同时更新内存缓存，确保后续读取时使用最新数据
 * @param {Object} store - 要保存的存储对象
 */
function saveStore(store) {
  // 所有写操作串行化，避免并发写导致文件损坏
  writeQueue = writeQueue.then(async () => {
    cache = store;
    const content = JSON.stringify(store, null, 2);
    await fs.promises.writeFile(storePath, content, 'utf-8');
  });
  return writeQueue;
}

/**
 * 读取某个会话最近的 N 条消息，按时间顺序返回。
 * @param {string} sessionId
 * @param {number} limit
 * @returns {Promise<Array<{role: string, content: any}>>}
 */
export async function getRecentMessages(sessionId, limit) {
  if (!sessionId) return [];
  const store = loadStore();
  const all = store.sessions[sessionId] || [];
  if (!all.length) return [];

  const sliced =
    all.length > limit ? all.slice(all.length - limit) : all;
  return sliced;
}

/**
 * 将一批消息追加到会话历史中，并做简单截断。
 * @param {string} sessionId
 * @param {Array<{role: string, content: any}>} messages
 * @returns {Promise<void>}
 */
export async function appendMessages(sessionId, messages) {
  if (!sessionId || !Array.isArray(messages) || messages.length === 0) {
    return;
  }

  const store = loadStore();
  const current = store.sessions[sessionId] || [];
  const merged = [...current, ...messages];

  // 为避免文件无限膨胀，这里做一个软截断（例如最多保留最近 200 条）
  const MAX_PER_SESSION = 200;
  const trimmed =
    merged.length > MAX_PER_SESSION
      ? merged.slice(merged.length - MAX_PER_SESSION)
      : merged;

  store.sessions[sessionId] = trimmed;
  await saveStore(store);
}

/**
 * 删除指定会话的上下文历史
 * @param {string} sessionId - 会话 ID
 * @returns {Promise<void>}
 */
export async function deleteSession(sessionId) {
  if (!sessionId) return;
  const store = loadStore();
  if (store.sessions[sessionId]) {
    delete store.sessions[sessionId];
    await saveStore(store);
  }
}

/**
 * 清空所有会话的上下文历史
 * @returns {Promise<void>}
 */
export async function clearAllSessions() {
  const store = loadStore();
  store.sessions = {};
  await saveStore(store);
}

