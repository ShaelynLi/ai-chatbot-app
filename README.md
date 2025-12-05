## AI Chatbot App

全栈聊天原型：后端使用 Node.js/Express 代理通义千问（Qwen），前端基于 React Native + Expo 的 iOS 客户端，支持文本与图片多模态对话，本地 SQLite 持久化会话与消息，侧边栏可切换会话。

### 目录与角色
- `backend/`：Qwen 代理服务（Express）
  - 入口：`backend/src/server.js`
  - 路由：`POST /api/chat/completions`、`POST /api/chat/title`
- `frontend/`：Expo iOS App
  - 入口：`frontend/App.js`
  - 主要模块：`src/screens/ChatbotScreen.js`（主界面）、`src/components/MessageBubble.js`（气泡）、`src/db/database.js`（SQLite）、`src/services/api.js`（后端调用）、`src/components/Sidebar.js`（会话侧边栏）

### 功能概览
- 多轮聊天，用户消息右对齐，AI 回复左对齐
- 支持多张图片 + 文本发送，图片大图预览
- AI 回复多版本切换，用户消息可编辑后重发
- 本地 SQLite 存储会话与消息，侧边栏分组展示
- 自动生成会话标题（默认标题为“新会话”时触发，网络不可用时静默忽略）

### 环境要求
- Node.js 18+
- npm 9+
- Expo CLI（本地调试 iOS）
- iOS 模拟器或真机（真机需与后端同一网络）

---

## 后端（Express + Qwen 代理）

1) 安装依赖
```bash
cd backend
npm install
```

2) 配置环境变量：在 `backend/.env` 中填写
```bash
DASHSCOPE_API_KEY=你的通义千问APIKey   # 或 QWEN_API_KEY（向后兼容）
QWEN_MODEL=qwen-plus-2025-07-28        # 可选，默认值同代码
QWEN_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 # 可选
PORT=4000                              # 可选，默认 4000
```

3) 启动服务
```bash
cd backend
npm run dev
```
默认监听 `http://localhost:4000`。未配置 API Key 时会返回模拟回复，便于本地联调。

主要接口：
- `POST /api/chat/completions`：文本或多模态消息转发至 Qwen，返回 `{ sessionId, reply }`
- `POST /api/chat/title`：根据会话历史生成简短标题（无 Key 时返回“新会话”）

---

## 前端（React Native + Expo）

1) 安装依赖
```bash
cd frontend
npm install
```

2) 配置后端地址（可选）
- 默认使用 `http://localhost:4000`
- 如需指定：在 `frontend/.env` 或 Expo 配置里添加
```
EXPO_PUBLIC_BACKEND_URL=http://你的后端IP或域名:4000
```
真机调试时需填写电脑的局域网 IP。

3) 启动 iOS
```bash
cd frontend
npm run ios
```
请先确保后端已运行，或已正确设置 `EXPO_PUBLIC_BACKEND_URL`。

### 前端要点
- 数据存储：`src/db/database.js` 使用 `expo-sqlite` 维护 `sessions`、`messages`、图片表
- API 调用：`src/services/api.js` 封装后端接口，统一处理网络与业务错误
- UI：`ChatbotScreen` 为主入口，`SessionListScreen` 侧边栏列表，`MessageBubble` 负责文字/图片气泡、状态提示、重试与版本切换
- 多模态：`sendMessageWithImage` 支持多张图片；后端会走多模态模型；无文本时默认用空串

---

## 常见问题
- 真机无法请求后端：检查手机与电脑是否同一网络，并在前端配置 `EXPO_PUBLIC_BACKEND_URL=http://电脑IP:4000`
- 自动生成标题报网络错误：功能会静默忽略，不影响聊天；需保证后端可达并配置 API Key
- 图片消息只有图片时：气泡不再占位，直接展示图片卡片，点按可全屏预览

---

## 下一步可做
- 后端接入持久化存储（替换当前内存会话）并增加鉴权
- 前端增加 Markdown 渲染和更完整的多模态 UI
- 统一 `ChatbotScreen` 与历史 `ChatScreen` 的逻辑，减少重复路径


