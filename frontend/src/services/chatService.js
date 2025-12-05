import { chatDb } from '../db/database';
import { deleteLocalFile } from './fileStorage';
import { clearAllBackendSessions, deleteBackendSession } from './api';

/**
 * 与会话 / 消息 / 图片相关的高层服务封装，
 * 用于在组件外部集中处理 SQLite 与本地文件系统的交互。
 */
export const chatService = {
  /**
   * 删除会话及其所有关联的图片记录与本地文件。
   * 同时清除后端会话上下文历史，确保数据完全清除。
   * @param {number} sessionId - 前端会话 ID（数字）
   * @returns {Promise<void>}
   */
  async deleteSessionWithImages(sessionId) {
    if (!sessionId) return { success: false, backendCleared: false };

    // 1. 删除前端数据（SQLite + 本地文件）
    const { images } = await chatDb.deleteSession(sessionId);

    if (images && images.length > 0) {
      for (const image of images) {
        try {
          await deleteLocalFile(image.uri);
        } catch (error) {
          // 单个文件删除失败不影响整体流程，仅记录警告日志
          console.warn(`Failed to delete image file: ${image.uri}`, error);
        }
      }
    }

    // 2. 清除后端数据（session_store.json）
    // 将数字 sessionId 转换为字符串，与后端存储格式一致
    let backendCleared = true;
    try {
      await deleteBackendSession(String(sessionId));
    } catch (error) {
      backendCleared = false;
      // 后端清理失败不影响前端清理，但需要告知调用方
      console.warn(`Failed to delete backend session ${sessionId}:`, error);
    }

    return { success: true, backendCleared };
  },

  /**
   * 删除一张图片（数据库记录 + 本地文件），并返回是否成功。
   * @param {{ id: number, uri: string }} image
   * @returns {Promise<void>}
   */
  async deleteImageWithFile(image) {
    if (!image?.id || !image?.uri) return;

    await chatDb.deleteImage(image.id);
    await deleteLocalFile(image.uri);
  },

  /**
   * 清空所有会话、消息与图片记录，并删除所有本地图片文件。
   * 同时清除后端会话上下文历史，确保数据完全清除。
   */
  async clearAllData() {
    try {
      // 1. 清除前端数据（SQLite + 本地文件）
      const sessions = await chatDb.listSessions();
      console.log(`[clearAllData] 找到 ${sessions.length} 个会话需要删除`);
      
      // 逐个删除会话，确保每个都成功删除
      for (const session of sessions) {
        try {
          await this.deleteSessionWithImages(session.id);
          console.log(`[clearAllData] 已删除会话 ${session.id}`);
        } catch (error) {
          // 单个会话删除失败不影响其他会话的删除
          console.error(`[clearAllData] 删除会话 ${session.id} 失败:`, error);
          // 继续删除其他会话
        }
      }
      
      // 验证所有会话是否已删除
      const remainingSessions = await chatDb.listSessions();
      if (remainingSessions.length > 0) {
        console.warn(`[clearAllData] 警告：仍有 ${remainingSessions.length} 个会话未被删除`);
        // 如果还有剩余会话，强制删除
        for (const session of remainingSessions) {
          try {
            await chatDb.deleteSession(session.id);
            console.log(`[clearAllData] 强制删除剩余会话 ${session.id}`);
          } catch (error) {
            console.error(`[clearAllData] 强制删除会话 ${session.id} 失败:`, error);
          }
        }
      }
      
      // 2. 清除后端数据（session_store.json）
      try {
        await clearAllBackendSessions();
        console.log('[clearAllData] 后端会话上下文已清除');
      } catch (error) {
        // 后端清理失败不影响前端清理，仅记录警告
        // 这样即使后端不可用，前端数据仍能被清除
        console.warn('[clearAllData] 清除后端会话失败:', error);
      }
      
      // 最终验证
      const finalSessions = await chatDb.listSessions();
      if (finalSessions.length > 0) {
        throw new Error(`清除数据后仍有 ${finalSessions.length} 个会话未被删除`);
      }
      
      console.log('[clearAllData] 所有数据已成功清除');
    } catch (error) {
      console.error('[clearAllData] 清除数据时发生错误:', error);
      throw error;
    }
  },
};


