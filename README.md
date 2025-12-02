## AI Chat Mini — 全栈 iOS 原型框架（当前版本说明）

目录结构如下：

- `backend/`：Node.js + Express，作为通义千问 (Qwen) 的代理层（统一调用 Qwen Chat & 标题生成功能）
- `frontend/`：React Native (Expo) iOS App，负责聊天 UI、本地历史存储（SQLite）和会话侧边栏

### 一、Backend（Qwen 代理）

- 入口：`backend/src/server.js`
- 路由前缀：`/api/chat`
- 主要路由：
- `POST /api/chat/completions`
- 控制器：`backend/src/controllers/qwen.controller.js`
  - 从前端接收 `message` 和可选 `sessionId`
  - 在内存中维护简单的会话历史（用于多轮上下文）
  - 调用 Qwen OpenAI 兼容 HTTP 接口 `/chat/completions`
  - 返回 `{ sessionId, reply }`
  - 如果未配置 `DASHSCOPE_API_KEY`，会返回一条「模拟回复」方便本地调试
  - 额外提供 `POST /api/chat/title`：根据会话历史自动生成简短标题（用于会话列表展示）

#### 1. 安装依赖

```bash
cd ai-chatbot-app/backend
npm install
```

#### 2. 配置环境变量

在 `backend` 目录下新建 `.env`：

```bash
# Qwen API Key (使用 DASHSCOPE_API_KEY，与官方文档一致)
DASHSCOPE_API_KEY=你的通义千问API Key

# 可选：模型名称（默认为 qwen-plus-2025-07-28）
QWEN_MODEL=qwen-plus-2025-07-28

# 可选：API 基础 URL（默认为 OpenAI 兼容模式）
# QWEN_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# 可选：服务端口（默认为 4000）
PORT=4000
```

**注意**：代码也支持 `QWEN_API_KEY` 作为环境变量名（向后兼容），但推荐使用 `DASHSCOPE_API_KEY`。

仓库根目录已有 `.gitignore`，默认会忽略：

- 根目录 `.env`
- `backend/.env`
- `frontend/.env`
- 以及 `*.env.*.local` 等敏感环境变量文件（不会被提交到 GitHub）。

#### 3. 启动后端

```bash
cd ai-chatbot-app/backend
npm run dev
```

默认监听：`http://localhost:4000`

---

### 二、Frontend（React Native + Expo）

- 入口：`frontend/App.js`
- 技术栈：
  - React Native (Expo)
  - React Native Paper（UI）
  - SQLite（`expo-sqlite`，本地存储会话和消息）
- 关键模块（与当前代码保持一致）：
  - `App.js`：
    - 使用 `NavigationContainer + createNativeStackNavigator` 管理路由
    - 路由：
      - `Chatbot`：主聊天页（当前默认首页）
      - `Chat`：会话详情页（备用/历史版本，可按需使用）
      - `Profile`：占位的用户信息 / 关于页面
    - 使用 `Sidebar` 组件实现左侧抽屉式会话列表（随时切换会话）
    - 使用 `ChatProvider` / `SidebarProvider` 管理全局会话和侧边栏状态
  - `src/context/ChatContext.js`：封装会话列表的全局状态，负责从本地 SQLite 加载 `sessions`，并提供 `refreshSessions`。
  - `src/context/SidebarContext.js`：控制侧边栏显隐（`openSidebar` / `closeSidebar`）。
  - `src/db/database.js`：
    - 定义本地 SQLite 数据库：
      - `sessions` 表：会话基本信息（标题、创建时间等）
      - `messages` 表：消息内容（角色、文本、时间、`parent_message_id` 用于多版本管理）
    - 提供会话和消息的 CRUD、删除整轮对话、按父消息获取多版本回复等方法。
  - `src/services/api.js`：
    - 统一调用后端：
      - `sendMessageToBackend({ message, sessionId })` → `POST /api/chat/completions`
      - `generateTitleFromBackend({ sessionId })` → `POST /api/chat/title`
    - 支持通过环境变量 `EXPO_PUBLIC_BACKEND_URL` 自定义后端地址（否则默认 `http://localhost:4000`）。
  - `src/components/MessageBubble.js`：
    - 聊天气泡组件（用户消息右对齐、AI 消息左对齐）
    - 支持：
      - AI 回复多版本切换（上一版 / 下一版）
      - 用户提问多版本（编辑后重新发送）+ 内联编辑交互
      - 重试、重新生成、复制文本、删除整轮消息等操作
  - `src/components/Sidebar.js`：
    - 左侧滑入的会话列表抽屉，内部渲染 `SessionListScreen`
    - 带半透明遮罩、动画过渡、点击遮罩关闭等交互
  - `src/screens/ChatbotScreen.js`（当前主聊天界面）：
    - 顶部：左侧汉堡按钮打开侧边栏，右侧进入 `Profile`
    - 中部：机器人欢迎界面（无消息时）+ 聊天记录（按“提问 + 回答”成对渲染，多版本同步切换）
    - 底部：圆角输入框 + 发送按钮，限制消息长度 ≤ 1000 字
    - 功能：
      - 创建新会话 / 在同一会话中连续多轮对话
      - 本地保存所有消息（SQLite），支持下拉刷新
      - 对单轮对话进行删除、多版本切换、编辑后重新生成 AI 回复
      - 自动调用后端生成会话标题（默认标题为“新会话”时才触发）
  - `src/screens/SessionListScreen.js`：
    - 在侧边栏中显示会话列表（按“Today / Previous 7 Days” 分组）
    - 顶部 `+` 按钮新建会话并跳转到 `Chatbot`（带入新的 `sessionId`）
    - 每个会话卡片支持：重命名、删除、预览首条问答内容
  - `src/screens/ChatScreen.js`：
    - 传统“会话详情页”风格的聊天界面，与 `ChatbotScreen` 类似，也支持多版本提问/回答、编辑和删除
    - 可以根据需要选择继续使用或逐步迁移逻辑到 `ChatbotScreen`
  - `src/screens/ProfileScreen.js`：
    - 占位 Profile 页面：展示固定的 AI Assistant 信息和一些设置项（Account / About），方便后续扩展为真正的用户中心。

#### 1. 安装依赖

```bash
cd ai-chatbot-app/frontend
npm install
```

#### 2. 配置后端地址（可选）

如需自定义后端 URL，可在 Expo 环境变量中设置：

```bash
EXPO_PUBLIC_BACKEND_URL=http://你的后端地址:4000
```

不设置时默认使用 `http://localhost:4000`。

#### 3. 启动 iOS App

```bash
cd ai-chatbot-app/frontend
npm run ios
```

在 Xcode 模拟器或真机中调试。

> 提示：确保在启动前端之前，后端已经在本机 `http://localhost:4000` 正常运行，或者在前端配置了正确的 `EXPO_PUBLIC_BACKEND_URL`。

---

### 三、下一步你可以做的事情

- 在 `qwen.controller.js` 里根据最新 Qwen 文档，精确定义请求/响应字段
- 在后端增加数据库（如 MongoDB/Postgres）保存云端会话历史
- 在前端根据 Figma 原型继续完善 UI（主题、Markdown 渲染等），并统一主聊天页面逻辑（按需保留/删除 `ChatScreen`）
- 参考 `mobile/frontend` 和 `chatterbox` 项目，把你熟悉的代码模式迁移进来

后续你所有的开发都可以集中在 `ai-chatbot-app` 这个目录下完成。


