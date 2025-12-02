import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { chatDb } from '../db/database';
import { sendMessageToBackend } from '../services/api';
import { MessageBubble } from '../components/MessageBubble';
import { useSidebar } from '../context/SidebarContext';
import { useChat } from '../context/ChatContext';

export function ChatScreen({ route, navigation }) {
  const { openSidebar } = useSidebar();
  const { sessions } = useChat();
  const { sessionId } = route.params;
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollViewRef = useRef(null);
  
  // 编辑消息相关状态
  const [editingMessage, setEditingMessage] = useState(null);
  const [editInput, setEditInput] = useState('');
  // 按对话轮管理版本索引：anchorUserId -> currentVersionIndex
  const [turnVersionIndices, setTurnVersionIndices] = useState({});

  // 检查会话是否存在，如果不存在则返回主界面
  useEffect(() => {
    // 只有在 sessions 列表不为空时才检查（避免初始加载时的误判）
    if (sessions.length > 0) {
      const sessionExists = sessions.some(s => s.id === sessionId);
      if (!sessionExists) {
        // 会话已被删除，返回主界面
        navigation.navigate('Chatbot');
      }
    }
  }, [sessions, sessionId, navigation]);

  const [isLoadingMessages, setIsLoadingMessages] = useState(true);

  useEffect(() => {
    setIsLoadingMessages(true);
    chatDb.listMessages(sessionId)
      .then(async (msgs) => {
        setMessages(msgs);
        setIsLoadingMessages(false);
      })
      .catch((error) => {
        console.error('Error loading messages:', error);
        setIsLoadingMessages(false);
      });
  }, [sessionId]);

  // 将扁平 messages 组织成对话轮（Turn）：每轮包含多版提问 + 多版回答 + 共享版本索引
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
      if (msg.role === 'assistant' && msg.parent_message_id) {
        const anchorId = msg.parent_message_id;
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

  const turns = useMemo(() => buildTurns(messages), [messages, buildTurns]);

  useEffect(() => {
    if (messages.length > 0) {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages]);

  const handleSend = async () => {
    if (loading || !input.trim() || input.length > 1000) return;
    const userContent = input.trim();
    setInput('');

    const userMsg = await chatDb.addMessage(sessionId, 'user', userContent);
    setMessages((prev) => [...prev, userMsg]);

    setLoading(true);
    try {
      const { reply } = await sendMessageToBackend({ message: userContent, sessionId });
      // 将首个 AI 回复与该用户消息作为一轮对话关联
      const aiMsg = await chatDb.addMessage(sessionId, 'assistant', reply, userMsg.id);
      setMessages((prev) => [...prev, aiMsg]);
    } catch (e) {
      const errorMsg = await chatDb.addMessage(
        sessionId,
        'assistant',
        `请求失败：${e.message}`
      );
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  // 处理编辑消息
  const handleEditMessage = (message) => {
    setEditingMessage(message);
    setEditInput(message.content);
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingMessage(null);
    setEditInput('');
  };

  // 发送编辑后的消息
  const handleSendEdit = async () => {
    if (loading || !editInput.trim() || !editingMessage) return;
    
    const editedContent = editInput.trim();
    // 找到原始消息ID（如果当前消息是编辑版本，使用parent_message_id；否则使用当前消息ID）
    const originalMessageId = editingMessage.parent_message_id || editingMessage.id;
    
    // 创建新的用户消息版本，关联到原消息（锚点）
    const newUserMsg = await chatDb.addMessage(
      sessionId, 
      'user', 
      editedContent, 
      originalMessageId
    );
    
    // 更新消息列表（先追加新用户版本，后面会整体重载）
    setMessages((prev) => [...prev, newUserMsg]);
    
    // 关闭编辑Modal
    setEditingMessage(null);
    setEditInput('');
    
    // 发送到后端获取AI回复
    setLoading(true);
    try {
      const { reply } = await sendMessageToBackend({ message: editedContent, sessionId });
      // 新的 AI 回复也挂在同一轮锚点下面
      const aiMsg = await chatDb.addMessage(
        sessionId,
        'assistant',
        reply,
        originalMessageId
      );
      setMessages((prev) => [...prev, aiMsg]);

      // 为确保提问/回答版本与本地 state 完全同步，重新从数据库加载当前会话消息
      try {
        const reloaded = await chatDb.listMessages(sessionId);
        setMessages(reloaded);
      } catch (e) {
        console.error('Reload messages after edit failed:', e);
      }
    } catch (e) {
      const errorMsg = await chatDb.addMessage(
        sessionId,
        'assistant',
        `请求失败：${e.message}`
      );
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
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

  // 删除一轮消息（用户提问 + 该提问下的所有 AI 回复/用户版本）
  const handleDeleteMessage = (msg) => {
    if (!sessionId || !msg?.id) return;

    // 锚点消息 ID：优先使用 parent_message_id，退回到自身 id
    const anchorId = msg.parent_message_id || msg.id;

    Alert.alert(
      '删除这条消息？',
      '删除后将从当前会话中移除这轮提问和对应的所有回复版本，仅在本机生效。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              // 删除锚点消息及其所有子消息（同一轮下的用户/AI 版本）
              await chatDb.deleteMessage(anchorId);
              setIsLoadingMessages(true);
              const msgs = await chatDb.listMessages(sessionId);
              setMessages(msgs);
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

        {/* 聊天消息区域 */}
        <ScrollView
          ref={scrollViewRef}
          style={styles.content}
          contentContainerStyle={[
            styles.contentInner,
            messages.length === 0 && !isLoadingMessages && styles.contentInnerEmpty,
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* 加载状态 */}
          {isLoadingMessages ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>加载中...</Text>
            </View>
          ) : messages.length === 0 ? (
            <>
              {/* 空状态：显示欢迎界面 */}
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
          ) : (
            /* 有消息时显示消息列表：按对话轮渲染，提问 + 回答成对，版本同步 */
            turns.map((turn) => {
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
                      onRegenerate={
                        aiMsg.role === 'assistant' && !aiMsg.isError
                          ? () => handleRegenerate(aiMsg)
                          : undefined
                      }
                      onRetry={
                        aiMsg.isError && aiMsg.retryMessage ? () => handleRetry(aiMsg) : undefined
                      }
                      isError={aiMsg.isError}
                      onDelete={() => handleDeleteMessage(aiMsg)}
                    />
                  )}
                </View>
              );
            })
          )}
        </ScrollView>

        {/* 底部输入区域 */}
        <View style={styles.inputContainerOuterWithPadding}>
          <View style={[styles.inputContainer, loading && styles.inputContainerDisabled]}>
            <TextInput
              style={[styles.textInput, loading && styles.textInputDisabled]}
              placeholder="Message..."
              placeholderTextColor="#9CA3AF"
              value={input}
              onChangeText={setInput}
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
      
      {/* 编辑消息Modal */}
      <Modal
        visible={editingMessage !== null}
        transparent={true}
        animationType="slide"
        onRequestClose={handleCancelEdit}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>编辑消息</Text>
              <TouchableOpacity onPress={handleCancelEdit}>
                <Ionicons name="close" size={24} color="#111827" />
              </TouchableOpacity>
            </View>
            
            <TextInput
              style={styles.modalTextInput}
              placeholder="输入消息..."
              placeholderTextColor="#9CA3AF"
              value={editInput}
              onChangeText={setEditInput}
              multiline
              autoFocus
              maxLength={1000}
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={handleCancelEdit}
              >
                <Text style={styles.modalButtonCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSend, (!editInput.trim() || loading) && styles.modalButtonDisabled]}
                onPress={handleSendEdit}
                disabled={!editInput.trim() || loading}
              >
                <Text style={styles.modalButtonSendText}>发送</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  contentInnerEmpty: {
    alignItems: 'center',
    paddingTop: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  loadingText: {
    fontSize: 16,
    color: '#9CA3AF',
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
  inputContainerOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: '#F7F7FB',
  },
  // 单独拆出一个带安全区域 padding 的样式，避免在 StyleSheet 中引用 hook 变量
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
  inputContainerDisabled: {
    backgroundColor: '#F3F4F6',
    opacity: 0.6,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingHorizontal: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  modalTextInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#111827',
    minHeight: 120,
    maxHeight: 300,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#F3F4F6',
  },
  modalButtonSend: {
    backgroundColor: '#7C3AED',
  },
  modalButtonDisabled: {
    backgroundColor: '#E5E7EB',
    opacity: 0.6,
  },
  modalButtonCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  modalButtonSendText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});


