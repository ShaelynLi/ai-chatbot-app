# AI Chatbot App — iOS PRD v0.1

## 目标
为用户提供一个轻量、离线可用的 AI 聊天工具，满足快速问答与思路记录需求。核心能力包括：
- 发送消息给 Qwen 大模型
- 清晰显示 AI 回复（支持 Markdown 格式）
- 本地保存所有聊天历史，保护隐私
- 支持创建新会话或回顾历史对话

## 核心功能
1. 聊天气泡界面（用户消息右对齐，AI 回复左对齐）
   - 输入时自动聚焦并确保聊天区域可见
2. 底部输入框 + 发送按钮（支持回车发送，防空提交，≤1000 字限制）
3. 在会话列表页顶部提供“+ 新对话”按钮，点击后进入全新聊天界面（上下文清空）
4. SideBar会话列表页（按创建时间倒序排列，显示最后一条消息预览 + 时间）
5. 点击任一会话可进入并继续对话（保留完整历史）
6. 调用 Qwen 免费 API（通义千问API文档：https://help.aliyun.com/zh/model-studio/qwen-api-reference）
7. AI 回复时显示“加载中”状态，避免用户重复点击

## 非目标（MVP中不做）
- 用户登录（所以Prototype中不支持”Profile“组件按钮）
- 云端同步
- 支持语音/图片
- 额外多技能标签（如“分析”、“导出”等）
- 实时流式回复（Qwen免费版不支持Streaming，所以Prototype中不支持”Stop generating...“等组件按钮）


## 技术栈
- 前端框架：React Native (Expo)
- 网络请求：原生 `fetch` 调用 Qwen API
- UI 组件库：React Native Paper
- 本地存储：SQLite（via expo-sqlite）
- 状态管理：React Context + useState（轻量级全局状态共享）

## 附录：界面原型
- 低保真原型图已绘制于Figma：  
  https://www.figma.com/design/MhXg9S3oypEfiDxPfuk7Dg/ai-chat-mini-wireframe?node-id=0-1&t=MFAfSGdyKD1Dtuti-1
- 包含：
  - 会话列表页：顶部“+ 新对话”按钮 + 按时间倒序排列的会话卡片
  - 聊天主界面：左右对齐气泡、底部输入框、加载状态示意