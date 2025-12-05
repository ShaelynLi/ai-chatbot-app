/**
 * 聊天相关路由定义
 * 
 * 路由列表：
 * - POST /api/chat/completions - 发送消息给 AI，获取回复
 * - POST /api/chat/title - 根据会话历史生成标题
 * - DELETE /api/chat/sessions/:sessionId - 删除指定会话的上下文历史
 * - DELETE /api/chat/sessions - 清空所有会话的上下文历史
 */

import { Router } from 'express';
import { 
  postChatCompletion, 
  postChatTitle, 
  deleteSessionHistory, 
  clearAllSessionsHistory 
} from '../controllers/qwen.controller.js';

export const router = Router();

// POST /api/chat/completions - 聊天完成接口
// 支持纯文本和多模态（图片+文本）消息
router.post('/completions', postChatCompletion);

// POST /api/chat/title - 生成会话标题接口
// 基于会话历史自动生成简短标题，用于侧边栏展示
router.post('/title', postChatTitle);

// DELETE /api/chat/sessions/:sessionId - 删除指定会话的上下文历史
router.delete('/sessions/:sessionId', deleteSessionHistory);

// DELETE /api/chat/sessions - 清空所有会话的上下文历史
router.delete('/sessions', clearAllSessionsHistory);


