/**
 * 聊天上下文（ChatContext）
 * 
 * 功能：
 * - 管理全局会话列表状态
 * - 提供会话 CRUD 操作的统一入口
 * - 封装会话删除时的级联操作（删除关联图片）
 * - 提供清空所有数据的功能
 * 
 * 使用方式：
 * - 在组件中使用 useChat() Hook 获取上下文
 * - 确保组件被 ChatProvider 包裹
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { chatDb } from '../db/database';
import { chatService } from '../services/chatService';

const ChatContext = createContext(null);

/**
 * 聊天上下文提供者组件
 * 在应用启动时初始化数据库并加载会话列表
 * @param {Object} props
 * @param {React.ReactNode} props.children - 子组件
 */
export function ChatProvider({ children }) {
  const [sessions, setSessions] = useState([]);

  // 组件挂载时初始化数据库并加载会话列表
  useEffect(() => {
    chatDb
      .init()
      .then(chatDb.listSessions)
      .then(async (list) => {
        setSessions(list);
        // 启动后做一次孤儿图片清理（静默）
        try {
          await chatService.cleanupOrphanImages();
        } catch (e) {
          console.warn('[ChatContext] cleanupOrphanImages warning:', e.message);
        }
      })
      .catch(console.error);
  }, []);

  /**
   * 刷新会话列表（从数据库重新加载）
   * 在创建、删除、更新会话后调用，确保 UI 显示最新数据
   */
  const refreshSessions = async () => {
    const list = await chatDb.listSessions();
    setSessions(list);
  };

  /**
   * 删除会话及其关联图片（数据库 + 本地文件），并自动刷新会话列表。
   * 统一入口，避免页面各自处理删除逻辑。
   */
  const deleteSessionWithImages = async (sessionId) => {
    const result = await chatService.deleteSessionWithImages(sessionId);
    await refreshSessions();
    return result;
  };

  /**
   * 创建一个新会话，并刷新会话列表，返回新会话对象。
   */
  const createSession = async (initialTitle = '新会话') => {
    const session = await chatDb.createSession(initialTitle);
    await refreshSessions();
    return session;
  };

  /**
   * 清空所有会话与本地图片资产，并刷新会话列表。
   */
  const clearAllData = async () => {
    try {
      await chatService.clearAllData();
      // 强制刷新会话列表，确保 UI 更新
      await refreshSessions();
      // 再次验证，确保列表为空
      const finalList = await chatDb.listSessions();
      if (finalList.length > 0) {
        console.warn(`[ChatContext] 清除数据后仍有 ${finalList.length} 个会话，强制清空状态`);
        setSessions([]);
      }
    } catch (error) {
      console.error('[ChatContext] clearAllData error:', error);
      // 即使出错，也尝试刷新列表
      await refreshSessions();
      throw error;
    }
  };

  const value = {
    sessions,
    refreshSessions,
    deleteSessionWithImages,
    createSession,
    clearAllData,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

/**
 * 使用聊天上下文的 Hook
 * 必须在 ChatProvider 内部使用
 * @returns {Object} 上下文对象，包含 sessions, refreshSessions, deleteSessionWithImages, createSession, clearAllData
 * @throws {Error} 如果不在 ChatProvider 内部使用，抛出错误
 */
export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error('useChat must be used within ChatProvider');
  }
  return ctx;
}


