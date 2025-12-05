/**
 * 后端服务器入口文件
 * 
 * 功能：
 * - 启动 Express 服务器，监听指定端口（默认 4000）
 * - 配置 CORS 跨域支持
 * - 配置 JSON body 解析，支持大图片 base64 传输（最大 10MB）
 * - 注册聊天相关路由（/api/chat/*）
 * - 提供健康检查接口（/health）
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { router as chatRouter } from './routes/chat.route.js';

// 加载环境变量配置
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// 配置 CORS：允许前端跨域请求
app.use(cors());

// 配置 JSON body 解析：增加 body size 限制以支持大图片 base64
// 默认限制为 100kb，增加到 10mb 以支持多张图片同时上传
app.use(express.json({ limit: '10mb' }));

// 健康检查接口：用于检测后端服务是否正常运行
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// 注册聊天相关路由：所有 /api/chat/* 的请求都会转发到 chatRouter
app.use('/api/chat', chatRouter);

// 启动服务器
app.listen(PORT, () => {
  console.log(`[ai-chatbot-app] Backend listening on port ${PORT}`);
});


