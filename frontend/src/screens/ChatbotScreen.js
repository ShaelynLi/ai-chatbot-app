/**
 * 聊天主界面（ChatbotScreen）
 * 
 * 功能：
 * - 支持纯文本和多模态（图片+文本）消息发送
 * - 支持多版本消息管理（编辑提问，生成多版回复）
 * - 支持离线队列和自动重试（网络恢复后自动重发待发送消息）
 * - 支持消息状态显示（发送中/待发送/失败/已发送）
 * - 支持图片上传和预览（单图/多图）
 * - 支持性能优化（只渲染最近 N 轮对话，支持加载更多历史）
 * - 支持动态思考状态显示（"正在分析图片..." vs "正在思考回复..."）
 * 
 * UI 结构：
 * - 顶部导航栏：左侧汉堡按钮（打开侧边栏）+ 中间标题 + 右侧 Profile 图标
 * - 中间聊天区域：机器人形象 + 欢迎气泡（无消息时）或消息列表
 * - 底部输入区：文本输入框 + 图片按钮 + 发送按钮
 * 
 * 核心特性：
 * - 会话管理：自动创建会话，支持切换会话
 * - 消息持久化：所有消息保存到本地 SQLite
 * - 网络监听：自动检测网络状态，网络恢复后重试待发送消息
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Snackbar } from 'react-native-paper';
import { useSidebar } from '../context/SidebarContext';
import { chatDb } from '../db/database';
import { sendMessageToBackend, generateTitleFromBackend, sendMessageWithImage } from '../services/api';
import { useChat } from '../context/ChatContext';
import { MessageBubble } from '../components/MessageBubble';
import * as ImagePicker from 'expo-image-picker';
import { saveImageToLocal, readImageAsBase64, base64ToDataUrl } from '../services/fileStorage';
import NetInfo from '@react-native-community/netinfo';
import { toastTexts } from '../utils/strings';

// 最大自动重试次数（用于离线队列功能）
const MAX_AUTO_RETRY = 3;

export function ChatbotScreen({ navigation, route }) {
  const { openSidebar } = useSidebar();
  const { sessions, refreshSessions, createSession } = useChat();
  const [message, setMessage] = useState('');
  const scrollViewRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  // 初始加载状态：如果有初始 sessionId，需要加载消息
  const [isLoadingMessages, setIsLoadingMessages] = useState(() => {
    // 如果初始有 sessionId，需要加载消息，显示加载状态
    return !!route?.params?.sessionId;
  });

  // 编辑用户消息相关状态（内联编辑）
  const [editingMessage, setEditingMessage] = useState(null);
  const [editInput, setEditInput] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  
  // 待发送的图片预览列表（选择后暂存，等待用户发送）
  const [pendingImages, setPendingImages] = useState([]);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    setToastVisible(true);
  }, []);

  // 组织消息版本：将同一用户消息的多个AI回复版本组织在一起
  // 将扁平 messages 组织成对话轮（Turn）：每轮包含多版提问 + 多版回答
  const [turnVersionIndices, setTurnVersionIndices] = useState({});
  const [isOnline, setIsOnline] = useState(true);
  const retryingQueuedRef = useRef(false);
  // 为避免大量历史消息一次性渲染导致卡顿，只显示最近若干轮对话，支持“加载更多”
  const [visibleTurnCount, setVisibleTurnCount] = useState(20);

  const buildTurns = useCallback((rawMessages) => {
    const anchors = new Map(); // anchorUserId -> { userVersions, assistantVersions }
    const order = [];

    // 先记录锚点用户消息（第一版提问）
    rawMessages.forEach((msg) => {
      if (msg.role === 'user' && !msg.parent_message_id) {
        if (!anchors.has(msg.id)) {
          anchors.set(msg.id, { userVersions: [msg], assistantVersions: [] });
          order.push(msg.id);
        } else {
          anchors.get(msg.id).userVersions.unshift(msg);
        }
      }
    });

    // 挂载用户编辑版本和 AI 版本
    rawMessages.forEach((msg) => {
      if (msg.role === 'user' && msg.parent_message_id) {
        const anchorId = msg.parent_message_id;
        if (!anchors.has(anchorId)) {
          anchors.set(anchorId, { userVersions: [msg], assistantVersions: [] });
          order.push(anchorId);
        } else {
          anchors.get(anchorId).userVersions.push(msg);
        }
      }
      if (msg.role === 'assistant' && (msg.parent_message_id || msg.parentMessageId)) {
        const anchorId = msg.parent_message_id || msg.parentMessageId;
        if (!anchors.has(anchorId)) {
          anchors.set(anchorId, { userVersions: [], assistantVersions: [msg] });
          order.push(anchorId);
        } else {
          anchors.get(anchorId).assistantVersions.push(msg);
        }
      }
    });

    const turns = order.map((anchorUserId) => {
      const entry = anchors.get(anchorUserId) || { userVersions: [], assistantVersions: [] };
      const userVersions = [...entry.userVersions].sort(
        (a, b) => (a.created_at || 0) - (b.created_at || 0)
      );
      const assistantVersions = [...entry.assistantVersions].sort(
        (a, b) => (a.created_at || 0) - (b.created_at || 0)
      );

      const pairedCount = Math.min(userVersions.length, assistantVersions.length);
      const safeUserVersions =
        pairedCount > 0 ? userVersions.slice(0, pairedCount) : userVersions;
      const safeAssistantVersions =
        pairedCount > 0 ? assistantVersions.slice(0, pairedCount) : assistantVersions;

      const total = safeAssistantVersions.length;
      const defaultIndex = total > 0 ? total - 1 : 0;

      return {
        anchorUserId,
        userVersions: safeUserVersions,
        assistantVersions: safeAssistantVersions,
        defaultIndex,
      };
    });

    return turns;
  }, []);

  const updateMessageStatusInState = useCallback((messageId, status, retryCount) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              status,
              retry_count:
                typeof retryCount === 'number' ? retryCount : msg.retry_count,
            }
          : msg
      )
    );
  }, []);

  const resendUserMessage = useCallback(
    async (messageRecord, { force = false } = {}) => {
      if (!messageRecord) return;
      const sessionId = messageRecord.session_id || messageRecord.sessionId || currentSessionId;
      if (!sessionId) return;

      await chatDb.updateMessageStatus(messageRecord.id, 'sending', messageRecord.retry_count || 0);
      if (sessionId === currentSessionId) {
        updateMessageStatusInState(messageRecord.id, 'sending', messageRecord.retry_count || 0);
      }

      try {
        const { reply } = await sendMessageToBackend({
          message: messageRecord.content,
          sessionId,
        });

        await chatDb.updateMessageStatus(messageRecord.id, 'sent', 0);
        if (sessionId === currentSessionId) {
          updateMessageStatusInState(messageRecord.id, 'sent', 0);
        }

        const aiMsg = await chatDb.addMessage(
          sessionId,
          'assistant',
          reply,
          messageRecord.parent_message_id || messageRecord.id
        );
        if (sessionId === currentSessionId) {
          setMessages((prev) => [...prev, aiMsg]);
        }
      } catch (error) {
        if (error.code === 'NETWORK_ERROR') {
          const baseRetry = messageRecord.retry_count || 0;
          const nextRetry = force ? 0 : baseRetry + 1;
          const reachedLimit = !force && nextRetry >= MAX_AUTO_RETRY;
          const nextStatus = reachedLimit ? 'failed' : 'queued';
          await chatDb.updateMessageStatus(messageRecord.id, nextStatus, nextRetry);
          if (sessionId === currentSessionId) {
            updateMessageStatusInState(messageRecord.id, nextStatus, nextRetry);
          }
        } else {
          await chatDb.updateMessageStatus(messageRecord.id, 'failed', messageRecord.retry_count || 0);
          if (sessionId === currentSessionId) {
            updateMessageStatusInState(messageRecord.id, 'failed', messageRecord.retry_count || 0);
          }
          Alert.alert('发送失败', error.message);
        }
      }
    },
    [currentSessionId, updateMessageStatusInState]
  );

  const retryQueuedMessages = useCallback(async () => {
    if (retryingQueuedRef.current) return;
    retryingQueuedRef.current = true;
    try {
      const queued = await chatDb.listQueuedUserMessages();
      for (const msg of queued) {
        await resendUserMessage(msg, { force: false });
      }
    } catch (error) {
      console.error('Retry queued messages failed:', error);
    } finally {
      retryingQueuedRef.current = false;
    }
  }, [resendUserMessage]);

  const handleManualRetryUserMessage = useCallback(
    (message) => resendUserMessage(message, { force: true }),
    [resendUserMessage]
  );

  const ensureSessionHasTitle = useCallback(
    async (sessionId) => {
      if (!sessionId) return;
      try {
        const session = sessions.find((s) => s.id === sessionId);
        const isDefaultTitle = !session || !session.title || session.title === '新会话';
        if (isDefaultTitle) {
          const { title } = await generateTitleFromBackend({ sessionId });
          if (title && title.trim()) {
            await chatDb.updateSessionTitle(sessionId, title.trim());
          }
        }
      } catch (e) {
        // 静默处理自动生成标题失败，不影响用户体验
        // 自动生成标题是辅助功能，失败时不应该影响正常使用
        const errorMsg = e?.message || String(e);
        const isNetworkError = 
          errorMsg.includes('无法连接到后端服务') || 
          errorMsg.includes('NETWORK_ERROR') ||
          errorMsg.includes('Network request failed') ||
          errorMsg.includes('timeout');
        
        // 网络错误完全静默处理，不输出任何日志
        // 其他错误只在开发环境输出简要日志
        if (!isNetworkError && __DEV__) {
          console.warn('Auto-generate session title failed (non-critical):', errorMsg);
        }
      }
    },
    [sessions]
  );

  // 后台补全默认标题：当会话列表变化时，尝试为默认标题的会话补拉标题（静默）
  useEffect(() => {
    const fetchTitles = async () => {
      const targets = sessions.filter((s) => !s.title || s.title === '新会话').slice(0, 3);
      for (const sess of targets) {
        await ensureSessionHasTitle(sess.id);
      }
    };
    if (sessions && sessions.length > 0) {
      fetchTitles().catch(() => {});
    }
  }, [sessions, ensureSessionHasTitle]);

  // 使用 useFocusEffect 监听页面聚焦和路由参数变化
  // 仅当路由显式带上 sessionId 时，才根据路由切换会话；
  // 普通在主界面连续聊天（没有路由参数变化）时，不会重置当前会话。
  useFocusEffect(
    useCallback(() => {
      const sessionId = route?.params?.sessionId;
      
      // 使用函数式更新来获取最新的 currentSessionId，避免闭包问题
      setCurrentSessionId((prevSessionId) => {
        // 如果路由没有带 sessionId（普通在主界面聊天的场景），保持当前会话不变
        if (sessionId == null) {
          return prevSessionId;
        }

        // 路由显式切换到另一个会话时，才根据 sessionId 加载对应消息
        if (sessionId !== prevSessionId) {
          // 切换会话时，清空输入框，避免误发送到错误的会话
          setMessage('');

          setIsLoadingMessages(true);
            chatDb.listMessages(sessionId)
              .then((rawMsgs) => {
                setMessages(rawMsgs);
                setIsLoadingMessages(false);
              })
            .catch((error) => {
              console.error('Error loading messages:', error);
              setMessages([]);
              setIsLoadingMessages(false);
            });
          return sessionId;
        }
        // sessionId 没有变化，保持当前状态
        return prevSessionId;
      });
    }, [route?.params?.sessionId])
  );

  // 监听会话列表变化，如果当前会话被删除，重置为欢迎界面
  useEffect(() => {
    // 只有在有当前会话且会话列表不为空时才检查
    // 注意：初始加载时 sessions 可能为空，所以需要 sessions.length > 0 的判断
    if (currentSessionId && sessions.length > 0) {
      const sessionExists = sessions.some(s => s.id === currentSessionId);
      if (!sessionExists) {
        // 当前会话已被删除，重置为欢迎界面
        setCurrentSessionId(null);
        setMessages([]);
        setMessage(''); // 清空输入框
        setIsLoadingMessages(false);
        // 清除路由参数，避免 useFocusEffect 再次加载已删除的会话
        if (navigation && route?.params?.sessionId === currentSessionId) {
          navigation.setParams({ sessionId: undefined });
        }
      }
    }
  }, [sessions, currentSessionId, navigation, route?.params?.sessionId]);

  // 当消息更新时，自动滚动到底部
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  // 最近一条用户消息是否包含图片，用于动态展示“正在分析图片 / 正在思考回复”文案
  const lastUserHasImages = useMemo(() => {
    if (!messages || messages.length === 0) return false;
    const reversed = [...messages].reverse();
    const found = reversed.find(
      (m) => m.role === 'user' && m.allImageUris && m.allImageUris.length > 0
    );
    return !!found;
  }, [messages]);

  // 重新生成AI回复
  const handleRegenerate = async (aiMessage) => {
    if (loading) return;
    
    // 找到对应的用户消息
    const messageIndex = messages.findIndex(m => 
      m.role === 'assistant' && 
      (m.id === aiMessage.id || m.parentMessageId === aiMessage.parentMessageId)
    );
    if (messageIndex === -1) return;
    
    // 向上查找用户消息
    let userMessage = null;
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMessage = messages[i];
        break;
      }
    }
    
    if (!userMessage) return;
    
    const userContent = userMessage.content;
    const sessionId = currentSessionId;
    const parentMessageId = userMessage.id;
    
    setLoading(true);
    try {
      // 调用 API 获取新的 AI 回复
      const { reply } = await sendMessageToBackend({ 
        message: userContent, 
        sessionId 
      });
      
      // 保存新版本到数据库（关联到用户消息）
      const newVersion = await chatDb.addMessage(sessionId, 'assistant', reply, parentMessageId);
      
      // 更新消息列表，添加新版本
      setMessages((prev) => {
        const updated = [...prev];
        const aiMsgIndex = updated.findIndex(m => 
          m.role === 'assistant' && 
          (m.id === aiMessage.id || m.parentMessageId === parentMessageId)
        );
        
        if (aiMsgIndex !== -1) {
          const aiMsg = updated[aiMsgIndex];
          const versions = [...(aiMsg.versions || [aiMsg]), newVersion];
          updated[aiMsgIndex] = {
            ...aiMsg,
            versions: versions,
            currentVersionIndex: versions.length - 1, // 切换到最新版本
            content: newVersion.content, // 更新显示内容
            parentMessageId: parentMessageId,
          };
        }
        return updated;
      });
      
      // 刷新会话列表
      await refreshSessions();
      showToast(toastTexts.newVersion);
    } catch (error) {
      console.error('Error regenerating message:', error);
      Alert.alert('重新生成失败', error.message);
    } finally {
      setLoading(false);
    }
  };

  // 打开编辑用户消息
  const handleEditMessage = (userMessage) => {
    if (!userMessage || userMessage.role !== 'user') return;
    setEditingMessage(userMessage);
    setEditInput(userMessage.content);
  };

  const handleCancelEdit = () => {
    setEditingMessage(null);
    setEditInput('');
  };

  // 编辑后重新发送，生成新的 AI 回复版本
  const handleSendEdit = async () => {
    if (loading || !editInput.trim() || !editingMessage) return;

    const editedContent = editInput.trim();
    let sessionId = currentSessionId;

    // 如果还没有会话，先通过上下文创建
    if (!sessionId) {
      const session = await createSession();
      sessionId = session.id;
      setCurrentSessionId(sessionId);
    }

    const anchorUserId = editingMessage.parent_message_id || editingMessage.id;

    const newUserMsg = await chatDb.addMessage(sessionId, 'user', editedContent, anchorUserId);
    setMessages((prev) => [...prev, newUserMsg]);

    // 退出编辑模式
    setEditingMessage(null);
    setEditInput('');

    setLoading(true);
    try {
      await resendUserMessage({ ...newUserMsg, session_id: sessionId }, { force: true });
      await ensureSessionHasTitle(sessionId);
      await refreshSessions();
      Alert.alert('已重新发送', '基于最新内容生成了新的回复版本');
    } catch (error) {
      console.error('Error sending edited message:', error);
      Alert.alert('发送失败', error.message);
    } finally {
      setLoading(false);
    }
  };

  // 切换消息版本
  const handleVersionChange = (aiMessage, direction) => {
    if (!aiMessage.versions || aiMessage.versions.length <= 1) return;
    
    setMessages((prev) => {
      const updated = [...prev];
      const index = updated.findIndex(m => 
        m.role === 'assistant' && 
        (m.id === aiMessage.id || m.parentMessageId === aiMessage.parentMessageId)
      );
      
      if (index !== -1) {
        const msg = updated[index];
        let newIndex = msg.currentVersionIndex;
        if (direction === 'prev') {
          newIndex = Math.max(0, newIndex - 1);
        } else if (direction === 'next') {
          newIndex = Math.min(msg.versions.length - 1, newIndex + 1);
        }
        
        updated[index] = {
          ...msg,
          currentVersionIndex: newIndex,
          content: msg.versions[newIndex].content,
        };
      }
      return updated;
    });
  };

  // 重试发送失败的消息
  const handleRetry = async (errorMsg) => {
    if (loading) return;
    
    const userContent = errorMsg.retryMessage;
    const sessionId = errorMsg.sessionId || currentSessionId;
    
    // 移除错误消息
    setMessages((prev) => prev.filter(msg => msg.id !== errorMsg.id));
    
    setLoading(true);
    try {
      // 调用 API 获取 AI 回复
      const { reply } = await sendMessageToBackend({ 
        message: userContent, 
        sessionId 
      });
      
      // 保存 AI 回复到数据库（第一个版本）
      const aiMsg = await chatDb.addMessage(sessionId, 'assistant', reply);
      // 添加版本信息
      const aiMsgWithVersions = {
        ...aiMsg,
        versions: [aiMsg],
        currentVersionIndex: 0,
      };
      setMessages((prev) => [...prev, aiMsgWithVersions]);
      
      // 刷新会话列表
      await refreshSessions();
    } catch (error) {
      console.error('Error retrying message:', error);
      // 重新显示错误消息
      const newErrorMsg = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: error.message || '发送失败，请检查网络或稍后重试。',
        isError: true,
        retryMessage: userContent,
        sessionId,
      };
      setMessages((prev) => [...prev, newErrorMsg]);
    } finally {
      setLoading(false);
    }
  };

  // 选择图片（添加到预览列表，不立即发送）
  const MAX_IMAGE_SIZE_MB = 8; // 单张最大 8MB
  const MAX_TOTAL_IMAGE_MB = 24; // 总计最大 24MB

  const handlePickImage = async () => {
    if (loading) return;

    try {
      // 请求相册权限
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('需要权限', '需要相册权限才能选择图片');
        return;
      }

      // 选择图片
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: false,
        quality: 0.8,
        allowsMultipleSelection: true, // 支持多选
      });

      if (result.canceled) return;

      // 处理选中的图片（支持多选）
      const newImages = [];
      let totalBytes = pendingImages.length
        ? (await Promise.all(
            pendingImages.map(async (img) => (await FileSystem.getInfoAsync(img.uri)).size || 0)
          )).reduce((a, b) => a + b, 0)
        : 0;

      for (const asset of result.assets) {
        try {
          // 大小校验：单张 & 累计
          const info = await FileSystem.getInfoAsync(asset.uri);
          const fileSize = info?.size || 0;
          if (fileSize > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
            Alert.alert('图片过大', `单张图片限制 ${MAX_IMAGE_SIZE_MB}MB，请重新选择。`);
            continue;
          }
          if (totalBytes + fileSize > MAX_TOTAL_IMAGE_MB * 1024 * 1024) {
            Alert.alert('图片总大小超限', `最多可选约 ${MAX_TOTAL_IMAGE_MB}MB，已跳过超限图片。`);
            continue;
          }
          totalBytes += fileSize;

          // 保存图片到本地文件系统
          const localUri = await saveImageToLocal(asset.uri);
          newImages.push({
            id: `pending-${Date.now()}-${Math.random()}`, // 临时 ID
            uri: localUri,
            originalUri: asset.uri,
          });
        } catch (error) {
          console.error('Error saving image:', error);
          Alert.alert('保存图片失败', `无法保存图片: ${error.message}`);
        }
      }

      // 添加到预览列表
      if (newImages.length > 0) {
        setPendingImages((prev) => [...prev, ...newImages]);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('选择图片失败', error.message || '请稍后重试');
    }
  };

  // 删除预览中的图片
  const handleRemovePendingImage = (imageId) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== imageId));
  };

  const handleSend = async () => {
    // 验证：至少要有文字或图片
    const hasText = message.trim().length > 0;
    const hasImages = pendingImages.length > 0;
    
    if (loading || (!hasText && !hasImages) || message.length > 1000) {
      if (!hasText && !hasImages) {
        Alert.alert('提示', '请输入消息或选择图片');
      } else if (message.length > 1000) {
        Alert.alert('提示', '单条消息最多 1000 字，请精简后再发送。');
      }
      return;
    }

    const userContent = message.trim();
    const imagesToSend = [...pendingImages]; // 复制待发送的图片列表
    
    // 清空输入和预览
    setMessage('');
    setPendingImages([]);

    // 如果没有当前会话，根据路由或直接新建一个全新的会话
    let sessionId = currentSessionId;
    if (!sessionId) {
      if (route?.params?.sessionId) {
        sessionId = route.params.sessionId;
      } else {
        const session = await createSession();
        sessionId = session.id;
      }
      setCurrentSessionId(sessionId);
    }

    let imageUserMessage = null;
    let savedImageIds = [];

    if (imagesToSend.length === 0) {
      try {
        setLoading(true);
        const userMsg = await chatDb.addMessage(sessionId, 'user', userContent);
        setMessages((prev) => [...prev, userMsg]);
        await resendUserMessage({ ...userMsg, session_id: sessionId });
        await ensureSessionHasTitle(sessionId);
        await refreshSessions();
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);

    try {
      // 图片消息发送流程
      let allImageUris = [];
      let allImageIds = [];

      // 保存所有图片到数据库
      for (const img of imagesToSend) {
        const imageRecord = await chatDb.addImage(sessionId, img.uri);
        allImageUris.push(img.uri);
        allImageIds.push(imageRecord.id);
      }
      savedImageIds = allImageIds;

      // 创建用户消息（带第一张图片的 URI，用于显示）
      imageUserMessage = await chatDb.addMessage(sessionId, 'user', userContent);
      
      // 在消息中添加图片信息（用于显示）
      const userMsgWithImage = {
        ...imageUserMessage,
        imageUri: allImageUris[0], // 第一张图片用于显示
        imageId: allImageIds[0],
        allImageUris: allImageUris, // 所有图片 URI
      };
      setMessages((prev) => [...prev, userMsgWithImage]);

      // 读取所有图片为 base64，发送到后端（支持多图）
      const imagesBase64 = [];
      for (const img of imagesToSend) {
        const base64 = await readImageAsBase64(img.uri);
        const imageDataUrl = base64ToDataUrl(base64);
        imagesBase64.push(imageDataUrl);
      }

      const { reply } = await sendMessageWithImage({
        message: userContent,
        imagesBase64,
        sessionId,
      });

      await chatDb.updateMessageStatus(imageUserMessage.id, 'sent', 0);
      updateMessageStatusInState(imageUserMessage.id, 'sent', 0);

      // 保存 AI 回复
      const aiMsg = await chatDb.addMessage(sessionId, 'assistant', reply, imageUserMessage.id);
      const aiMsgWithVersions = {
        ...aiMsg,
        parentMessageId: imageUserMessage.id,
        versions: [aiMsg],
        currentVersionIndex: 0,
      };
      setMessages((prev) => [...prev, aiMsgWithVersions]);

      await ensureSessionHasTitle(sessionId);
      await refreshSessions();
    } catch (error) {
      console.error('Error sending message:', error);
      if (imagesToSend.length > 0) {
        if (imageUserMessage) {
          try {
            await chatDb.deleteMessage(imageUserMessage.id);
          } catch (e) {
            console.warn('Failed to delete failed image message:', e);
          }
          setMessages((prev) => prev.filter((msg) => msg.id !== imageUserMessage.id));
        }
        if (savedImageIds.length > 0) {
          for (const imageId of savedImageIds) {
            try {
              await chatDb.deleteImage(imageId);
            } catch (e) {
              console.warn('Failed to delete pending image record:', imageId, e);
            }
          }
        }
        setPendingImages(imagesToSend);
        setMessage(userContent);
        Alert.alert('发送失败', error.message || '网络异常，请稍后重试。');
      }
    } finally {
      setLoading(false);
    }
  };

  // 删除一轮消息（用户提问 + 该提问下的所有 AI 回复版本）
  const handleDeleteMessage = (msg) => {
    if (!currentSessionId || !msg?.id) return;

    // 锚点消息 ID：优先使用 parentMessageId / parent_message_id，退回到自身 id
    const anchorId =
      msg.parentMessageId || msg.parent_message_id || msg.id;

    Alert.alert(
      '删除这条消息？',
      '删除后将从当前会话中移除这轮提问和对应的所有回复，仅在本机生效，不会影响模型历史。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              // 删除锚点消息，以及以其为 parent_message_id 的所有消息（用户/AI 各个版本）
              await chatDb.deleteMessage(anchorId);
              // 重新加载当前会话的消息列表，保持版本结构正确
              setIsLoadingMessages(true);
              const rawMsgs = await chatDb.listMessages(currentSessionId);
              setMessages(rawMsgs);
              setIsLoadingMessages(false);
            } catch (error) {
              console.error('Delete message error:', error);
              Alert.alert('删除失败', error.message || '请稍后重试');
            }
          },
        },
      ]
    );
  };

  // 下拉刷新：重新加载当前会话的消息
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (currentSessionId) {
        const rawMsgs = await chatDb.listMessages(currentSessionId);
        setMessages(rawMsgs);
      } else {
        await refreshSessions();
      }
    } catch (error) {
      console.error('Error refreshing messages:', error);
    } finally {
      setRefreshing(false);
    }
  };

  // 同一轮对话的版本切换（提问 & 回答同步）
  const handleTurnVersionChange = (anchorUserId, direction, totalVersions) => {
    if (!anchorUserId || totalVersions <= 1) return;
    setTurnVersionIndices((prev) => {
      const currentIndex =
        typeof prev[anchorUserId] === 'number' ? prev[anchorUserId] : totalVersions - 1;
      let newIndex = currentIndex;
      if (direction === 'prev') {
        newIndex = Math.max(0, currentIndex - 1);
      } else if (direction === 'next') {
        newIndex = Math.min(totalVersions - 1, currentIndex + 1);
      }
      if (newIndex === currentIndex) return prev;
      return { ...prev, [anchorUserId]: newIndex };
    });
  };

  // 判断是否显示欢迎界面（无消息时显示）
  const showWelcome = messages.length === 0;

  // 根据扁平 messages 构建对话轮，用于渲染成“提问 + 回答”成对的版本化气泡
  const turns = useMemo(() => buildTurns(messages), [messages, buildTurns]);

  // 当消息或当前会话变化时，重置可见轮数为默认值
  useEffect(() => {
    setVisibleTurnCount(20);
  }, [currentSessionId, messages.length]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = !!(state.isConnected && (state.isInternetReachable ?? true));
      setIsOnline(connected);
      if (connected) {
        retryQueuedMessages();
      }
    });
    return () => unsubscribe();
  }, [retryQueuedMessages]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.safeArea}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* 顶部导航栏 */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={openSidebar}
          >
            <MaterialCommunityIcons name="menu" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>AI 助手</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => {
                if (currentSessionId) {
                  navigation?.navigate('ImageGallery', { sessionId: currentSessionId });
                } else {
                  Alert.alert('提示', '请先开始一个会话');
                }
              }}
            >
              <Ionicons name="images-outline" size={24} color="#111827" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => navigation?.navigate('Profile')}
            >
              <Ionicons name="person-outline" size={24} color="#111827" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 中间内容区域 */}
        <ScrollView
          ref={scrollViewRef}
          style={styles.content}
          contentContainerStyle={[
            styles.contentInner,
            !showWelcome && styles.contentInnerWithMessages,
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#7C3AED"
              colors={['#7C3AED']}
            />
          }
        >
          {/* 欢迎界面：仅在无消息时显示 */}
          {showWelcome && (
            <>
              {/* 机器人形象 */}
              <Image
                source={require('../../assets/robot.png')}
                style={styles.robotImage}
                resizeMode="contain"
              />

              {/* 欢迎气泡 */}
              <View style={styles.welcomeBubbleWrapper}>
                <View style={styles.welcomeBubble}>
                  <View style={styles.welcomeIconWrapper}>
                    <Ionicons name="sparkles" size={18} color="#7C3AED" />
                  </View>
                  <Text style={styles.welcomeText}>
                    我是你的 AI 助手，有什么可以帮你的吗？
                  </Text>
                </View>
              </View>
            </>
          )}

          {/* 加载状态 */}
          {isLoadingMessages && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#7C3AED" />
              <Text style={styles.loadingText}>加载中...</Text>
            </View>
          )}

          {/* 聊天记录：有消息时显示（按对话轮渲染，提问 + 回答成对，版本同步） */}
          {!showWelcome && !isLoadingMessages && (
            <View style={styles.chatList}>
              {(() => {
                const totalTurns = turns.length;
                const startIndex =
                  totalTurns > visibleTurnCount ? totalTurns - visibleTurnCount : 0;
                const visibleTurns = turns.slice(startIndex);

                return (
                  <>
                    {/* 顶部“加载更多”按钮：仅在有更多历史轮次时显示 */}
                    {startIndex > 0 && (
                      <TouchableOpacity
                        style={styles.loadMoreButton}
                        onPress={() =>
                          setVisibleTurnCount((prev) =>
                            Math.min(prev + 20, totalTurns)
                          )
                        }
                      >
                        <Text style={styles.loadMoreText}>加载更多历史对话</Text>
                      </TouchableOpacity>
                    )}

                    {visibleTurns.map((turn) => {
                const { anchorUserId, userVersions, assistantVersions, defaultIndex } = turn;
                if (!userVersions.length) return null;

                const totalVersions = assistantVersions.length || 1;
                const currentIndex =
                  typeof turnVersionIndices[anchorUserId] === 'number'
                    ? turnVersionIndices[anchorUserId]
                    : defaultIndex;

                const userMsg = userVersions[currentIndex] || userVersions[0];
                const aiMsg = assistantVersions[currentIndex] || assistantVersions[0];

                const isEditingThis = editingMessage && editingMessage.id === userMsg.id;

                const editMetaText =
                  totalVersions > 1
                    ? `编辑第 ${currentIndex + 1}/${totalVersions} 版消息`
                    : '编辑这条提问以生成新的回复版本';

                const onVersionChange = (direction) =>
                  handleTurnVersionChange(anchorUserId, direction, totalVersions);

                      return (
                  <View key={anchorUserId}>
                    {/* 提问气泡：显示当前版本的提问内容 + 版本号（与回答同步） */}
                    <MessageBubble
                      role="user"
                      content={userMsg.content}
                      imageUri={userMsg.imageUri}
                      allImageUris={userMsg.allImageUris}
                    createdAt={userMsg.created_at}
                      userMessageVersions={assistantVersions}
                      currentUserVersionIndex={currentIndex}
                      onUserVersionChange={onVersionChange}
                      onEdit={() => handleEditMessage(userMsg)}
                      isEditing={isEditingThis}
                      editValue={isEditingThis ? editInput : undefined}
                      onChangeEditValue={isEditingThis ? setEditInput : undefined}
                      onCancelEdit={isEditingThis ? handleCancelEdit : undefined}
                      onConfirmEdit={isEditingThis ? handleSendEdit : undefined}
                      isSending={loading}
                      editMetaText={isEditingThis ? editMetaText : undefined}
                      status={userMsg.status}
                    onShowToast={showToast}
                      onUserRetry={
                        userMsg.status === 'queued' || userMsg.status === 'failed'
                          ? () => {
                              showToast(toastTexts.retryQueued);
                              handleManualRetryUserMessage(userMsg);
                            }
                          : undefined
                      }
                    />

                    {/* 回答气泡：同一轮的当前版本回答，版本箭头会驱动问答同步切换 */}
                    {aiMsg && (
                      <MessageBubble
                        role="assistant"
                        content={aiMsg.content}
                        versions={assistantVersions}
                        currentVersionIndex={currentIndex}
                        onVersionChange={onVersionChange}
                        onRegenerate={() => handleRegenerate(aiMsg)}
                        onRetry={
                          aiMsg.isError && aiMsg.retryMessage ? () => handleRetry(aiMsg) : undefined
                        }
                        isError={aiMsg.isError}
                        onDelete={() => handleDeleteMessage(aiMsg)}
                      createdAt={aiMsg.created_at}
                      onShowToast={showToast}
                      />
                    )}
                  </View>
                      );
                    })}

                    {/* AI 思考中 / 分析中状态提示 */}
                    {loading && (
                      <View style={styles.typingContainer}>
                        <View style={styles.typingBubble}>
                          <Text style={styles.typingText}>
                            {lastUserHasImages ? '正在分析图片并生成回复...' : '正在思考回复...'}
                          </Text>
                        </View>
                      </View>
                    )}
                  </>
                );
              })()}
            </View>
          )}
        </ScrollView>

        {/* 图片预览区域 */}
        {pendingImages.length > 0 && (
          <View style={styles.pendingImagesContainer}>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pendingImagesScrollContent}
            >
              {pendingImages.map((img) => (
                <View key={img.id} style={styles.pendingImageWrapper}>
                  <Image
                    source={{ uri: img.uri }}
                    style={styles.pendingImage}
                    resizeMode="cover"
                  />
                  <TouchableOpacity
                    style={styles.pendingImageDeleteButton}
                    onPress={() => handleRemovePendingImage(img.id)}
                  >
                    <Ionicons name="close" size={14} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* 底部输入区域 */}
        <View style={styles.inputContainerOuterWithPadding}>
          <View style={[styles.inputContainer, loading && styles.inputContainerDisabled]}>
            <TextInput
              style={[styles.textInput, loading && styles.textInputDisabled]}
              placeholder="输入消息..."
              placeholderTextColor="#9CA3AF"
              value={message}
              onChangeText={setMessage}
              returnKeyType="send"
              onSubmitEditing={handleSend}
              editable={!loading}
            />
            <TouchableOpacity 
              style={styles.micButton} 
              onPress={handlePickImage}
              disabled={loading}
            >
              <Ionicons
                name="image-outline"
                size={22}
                color={loading ? '#D1D5DB' : '#7C3AED'}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[
              styles.sendButton, 
              loading && styles.sendButtonDisabled,
              (!message.trim() && pendingImages.length === 0) && styles.sendButtonDisabled
            ]}
            onPress={handleSend}
            disabled={loading || (!message.trim() && pendingImages.length === 0)}
          >
            <Ionicons
              name="paper-plane"
              size={26}
              color={
                loading || (!message.trim() && pendingImages.length === 0)
                  ? '#D1D5DB'
                  : '#ffffff'
              }
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Snackbar
        visible={toastVisible}
        onDismiss={() => setToastVisible(false)}
        duration={2200}
        style={{ marginBottom: 16 }}
      >
        {toastMessage}
      </Snackbar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F7FB',
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  headerIconButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  content: {
    flex: 1,
  },
  contentInner: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 24,
  },
  contentInnerWithMessages: {
    alignItems: 'stretch',
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  robotImage: {
    width: 220,
    height: 220,
    marginBottom: 24,
  },
  welcomeBubbleWrapper: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 32,
  },
  welcomeBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 24,
    backgroundColor: '#F3F4F6',
    width: '100%',
  },
  welcomeIconWrapper: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  welcomeText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22, // 与气泡框文本保持一致
    color: '#111827',
  },
  chatList: {
    width: '100%',
    marginTop: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 200,
    paddingTop: 100,
  },
  loadingText: {
    fontSize: 16,
    color: '#9CA3AF',
    marginTop: 12,
  },
  typingContainer: {
    marginTop: 8,
    paddingHorizontal: 8,
  },
  typingBubble: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#E5E7EB',
  },
  typingText: {
    fontSize: 13,
    color: '#4B5563',
  },
  inputContainerOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: '#F7F7FB',
  },
  // 拆出一个带底部 padding 的样式，避免在样式中直接依赖 hook 变量
  inputContainerOuterWithPadding: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: '#F7F7FB',
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 8,
    color: '#111827',
  },
  textInputDisabled: {
    color: '#9CA3AF',
  },
  inputContainerDisabled: {
    backgroundColor: '#F3F4F6',
    opacity: 0.6,
  },
  micButton: {
    marginLeft: 12,
  },
  sendButton: {
    marginLeft: 12,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 4,
  },
  sendButtonDisabled: {
    backgroundColor: '#E5E7EB',
    shadowOpacity: 0,
    elevation: 0,
  },
  // 图片预览区域样式
  pendingImagesContainer: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    paddingVertical: 12,
    paddingHorizontal: 16,
    maxHeight: 120,
  },
  pendingImagesScrollContent: {
    gap: 12,
    paddingRight: 16,
  },
  pendingImageWrapper: {
    position: 'relative',
    width: 80,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden', // 只裁剪图片，不裁剪删除按钮
    backgroundColor: '#F3F4F6',
  },
  pendingImage: {
    width: '100%',
    height: '100%',
  },
  pendingImageDeleteButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});


