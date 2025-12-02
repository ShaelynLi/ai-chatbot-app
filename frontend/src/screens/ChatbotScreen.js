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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSidebar } from '../context/SidebarContext';
import { chatDb } from '../db/database';
import { sendMessageToBackend, generateTitleFromBackend } from '../services/api';
import { useChat } from '../context/ChatContext';
import { MessageBubble } from '../components/MessageBubble';

/**
 * 聊天主界面，支持在主界面直接聊天，不跳转到新页面
 * - 顶部导航栏：左侧汉堡按钮 + 中间标题 "Chatbot AI" + 右侧 Profile 图标
 * - 中间机器人形象 + 欢迎气泡（仅在无消息时显示）
 * - 底部圆角输入框 + 麦克风图标 + 紫色发送按钮
 */

export function ChatbotScreen({ navigation, route }) {
  const { openSidebar } = useSidebar();
  const { sessions, refreshSessions } = useChat();
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

  // 组织消息版本：将同一用户消息的多个AI回复版本组织在一起
  // 将扁平 messages 组织成对话轮（Turn）：每轮包含多版提问 + 多版回答
  const [turnVersionIndices, setTurnVersionIndices] = useState({});

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

    // 如果还没有会话，先创建
    if (!sessionId) {
      const session = await chatDb.createSession();
      sessionId = session.id;
      setCurrentSessionId(sessionId);
      await refreshSessions();
    }

    // 以最初的用户消息作为锚点：所有用户/AI 版本都挂在这个锚点下面
    const anchorUserId = editingMessage.parent_message_id || editingMessage.id;

    // 在数据库中记录这条新的用户消息（作为单独一条记录，用于保留历史）
    await chatDb.addMessage(sessionId, 'user', editedContent, anchorUserId);

    setLoading(true);
    try {
      const { reply } = await sendMessageToBackend({ message: editedContent, sessionId });

      // 保存新的 AI 版本到数据库，关联到锚点用户消息
      const newVersion = await chatDb.addMessage(
        sessionId,
        'assistant',
        reply,
        anchorUserId
      );

      // 在现有 AI 消息上追加一个版本（或新建一条带版本的 AI 消息）
      setMessages(prev => {
        const updated = [...prev];

        // 在当前消息列表中查找与该用户消息关联的 AI 消息
        const aiIndex = updated.findIndex(
          (m) =>
            m.role === 'assistant' &&
            ((m.parentMessageId ?? m.parent_message_id) === anchorUserId)
        );

        // 没有找到已聚合的 AI 消息，直接追加一条新的带版本的消息
        if (aiIndex === -1) {
          const aiMsgWithVersions = {
            ...newVersion,
            versions: [newVersion],
            currentVersionIndex: 0,
          };
          return [...updated, aiMsgWithVersions];
        }

        // 找到已存在的 AI 消息，在其 versions 上追加一个版本
        const aiMsg = updated[aiIndex];
        const baseVersions = Array.isArray(aiMsg.versions) && aiMsg.versions.length > 0
          ? aiMsg.versions
          : [aiMsg];
        const versions = [...baseVersions, newVersion];

        updated[aiIndex] = {
          ...aiMsg,
          versions,
          currentVersionIndex: versions.length - 1,
          content: newVersion.content,
          parentMessageId: editingMessage.id,
        };

        return updated;
      });

      // 编辑完成，退出编辑模式
      setEditingMessage(null);
      setEditInput('');

      // 为确保提问/回答版本与本地 state 完全同步，重新从数据库加载当前会话消息
      try {
        if (sessionId) {
          const rawMsgs = await chatDb.listMessages(sessionId);
          setMessages(rawMsgs);
        }
      } catch (e) {
        console.error('Reload messages after edit failed:', e);
      }

      // 刷新会话列表（更新时间等）
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
        content: `请求失败：${error.message}`,
        isError: true,
        retryMessage: userContent,
        sessionId,
      };
      setMessages((prev) => [...prev, newErrorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (loading || !message.trim() || message.length > 1000) return;
    
    const userContent = message.trim();
    setMessage('');

    // 如果没有当前会话，根据路由或直接新建一个全新的会话
    let sessionId = currentSessionId;
    if (!sessionId) {
      // 优先使用路由上携带的 sessionId（例如从侧边栏点进来的已有会话）
      if (route?.params?.sessionId) {
        sessionId = route.params.sessionId;
      } else {
        // 否则就创建一个全新的会话（防止误把消息写进上一次的会话）
        const session = await chatDb.createSession();
        sessionId = session.id;
        await refreshSessions();
      }
      setCurrentSessionId(sessionId);
    }

    // 先显示用户消息，提供即时反馈
    const userMsg = await chatDb.addMessage(sessionId, 'user', userContent);
    setMessages((prev) => [...prev, userMsg]);

    setLoading(true);
    try {
      // 调用 API 获取 AI 回复
      const { reply } = await sendMessageToBackend({
        message: userContent,
        sessionId,
      });
      
      // 保存 AI 回复到数据库（第一个版本），直接关联到该用户消息作为锚点
      const aiMsg = await chatDb.addMessage(sessionId, 'assistant', reply, userMsg.id);
      // 添加版本信息，并显式保存 camelCase 的 parentMessageId，方便前端使用
      const aiMsgWithVersions = {
        ...aiMsg,
        parentMessageId: userMsg.id,
        versions: [aiMsg],
        currentVersionIndex: 0,
      };
      setMessages((prev) => [...prev, aiMsgWithVersions]);

      // 自动生成会话标题（仅在标题为默认值时）
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
        console.error('Auto-generate session title failed:', e);
      }

      // 刷新会话列表以显示最新标题
      await refreshSessions();
    } catch (error) {
      console.error('Error sending message:', error);
      // 错误消息不保存到数据库，只显示在 UI 中（临时状态）
      // 使用临时 ID 标识错误消息，方便后续重试时替换
      const errorMsg = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `请求失败：${error.message}`,
        isError: true, // 标记为错误消息
        retryMessage: userContent, // 保存原始消息，用于重试
        sessionId, // 保存会话 ID，用于重试
      };
      setMessages((prev) => [...prev, errorMsg]);
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
          <Text style={styles.headerTitle}>Chatbot AI</Text>
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={() => navigation?.navigate('Profile')}
          >
            <Ionicons name="person-outline" size={24} color="#111827" />
          </TouchableOpacity>
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
                    Hi, I'm your AI assistant. Ask me anything!
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
              {turns.map((turn) => {
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
                      />
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* 底部输入区域 */}
        <View style={styles.inputContainerOuterWithPadding}>
          <View style={[styles.inputContainer, loading && styles.inputContainerDisabled]}>
            <TextInput
              style={[styles.textInput, loading && styles.textInputDisabled]}
              placeholder="Message..."
              placeholderTextColor="#9CA3AF"
              value={message}
              onChangeText={setMessage}
              returnKeyType="send"
              onSubmitEditing={handleSend}
              editable={!loading}
            />
            <TouchableOpacity style={styles.micButton} disabled={loading}>
              <Ionicons
                name="mic-outline"
                size={22}
                color={loading ? '#D1D5DB' : '#7C3AED'}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.sendButton, loading && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={loading}
          >
            <Ionicons
              name="paper-plane"
              size={26}
              color={loading ? '#D1D5DB' : '#ffffff'}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
});


