/**
 * 会话列表屏幕
 * 
 * 功能：
 * - 显示所有会话列表，按时间分组（今天 / 最近 7 天）
 * - 支持创建新会话
 * - 支持删除会话（级联删除关联图片）
 * - 支持重命名会话
 * - 显示会话预览（最后一条 AI 回复）
 * - 支持下拉刷新
 * - 点击会话进入聊天界面
 * 
 * 使用场景：
 * - 作为侧边栏的主要内容
 * - 独立作为会话管理页面
 */

import React, { useState, useEffect, useLayoutEffect } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Snackbar } from 'react-native-paper';
import { useChat } from '../context/ChatContext';
import { chatDb } from '../db/database';

export function SessionListScreen({ navigation, onClose }) {
  const { sessions, refreshSessions, deleteSessionWithImages, createSession } = useChat();
  const [sessionPreviews, setSessionPreviews] = useState({});
  const [expandedSections, setExpandedSections] = useState({
    today: true,
    previous7Days: true,
  });
  const [menuVisible, setMenuVisible] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const isSkeletonLoading = refreshing && sessions.length === 0;
  const [isLayoutReady, setIsLayoutReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const renderSkeletonCards = () => {
    const placeholders = [1, 2, 3, 4];
    return placeholders.map((idx) => (
      <View key={idx} style={styles.skeletonCard}>
        <View style={styles.skeletonTitle} />
        <View style={styles.skeletonPreview} />
      </View>
    ));
  };

  // 加载每个会话的预览消息
  const loadPreviews = async () => {
    const previews = {};
    for (const session of sessions) {
      try {
        const messages = await chatDb.listMessages(session.id);
        const firstUserMessage = messages.find((m) => m.role === 'user');
        const firstAssistantMessage = messages.find((m) => m.role === 'assistant');

        const displayTitle =
          session.title && session.title !== '新会话'
            ? session.title
            : firstUserMessage?.content || session.title || '未命名会话';

        previews[session.id] = {
          title: displayTitle,
          preview: firstAssistantMessage?.content || '',
        };
      } catch (error) {
        console.error('Error loading preview:', error);
        previews[session.id] = {
          title: session.title || '未命名会话',
          preview: '',
        };
      }
    }
    setSessionPreviews(previews);
  };

  useEffect(() => {
    loadPreviews();
  }, [sessions]);

  // Use useLayoutEffect to ensure layout is calculated when component mounts
  useLayoutEffect(() => {
    setIsLayoutReady(false);
    // Force layout recalculation on mount - use multiple frames to ensure layout is stable
    const timer = setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsLayoutReady(true);
        });
      });
    }, 0);
    return () => clearTimeout(timer);
  }, []);


  const handleMenuPress = (session, e) => {
    e.stopPropagation();
    setSelectedSession(session);
    setMenuVisible(true);
  };

  const handleDelete = () => {
    if (!selectedSession) return;
    
    Alert.alert(
      '删除会话',
      '确定要删除这个会话吗？此操作无法撤销。',
      [
        {
          text: '取消',
          style: 'cancel',
          onPress: () => setMenuVisible(false),
        },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              const deletedSessionId = selectedSession.id;

              // 通过上下文统一处理会话删除及其图片清理 + 刷新列表
              const result = await deleteSessionWithImages(deletedSessionId);
              setMenuVisible(false);
              setSelectedSession(null);
              
              // 如果当前正在查看被删除的会话，导航回主界面
              // 注意：ChatbotScreen 会通过监听 sessions 变化自动重置，这里作为额外保障
              if (navigation) {
                const state = navigation.getState();
                const currentRoute = state?.routes[state?.index];
                // 检查 Chatbot 路由（当前版本只使用 Chatbot 作为会话入口）
                if (currentRoute?.name === 'Chatbot' && 
                    currentRoute?.params?.sessionId === deletedSessionId) {
                  navigation.navigate('Chatbot');
                }
              }

              // 轻提示：前端已删；后端未清理成功时提示用户
              if (result && result.backendCleared === false) {
                setSnackbarMessage('已删除本地会话，后端未清理成功，请稍后重试。');
              } else {
                setSnackbarMessage('已删除本地会话。');
              }
              setSnackbarVisible(true);
            } catch (error) {
              console.error('Error deleting session:', error);
              Alert.alert('错误', '删除会话失败，请稍后重试。');
            }
          },
        },
      ]
    );
  };

  const handleRename = () => {
    if (!selectedSession) return;
    const preview = sessionPreviews[selectedSession.id];
    setRenameText(preview?.title || selectedSession.title || '');
    setMenuVisible(false);
    setRenameModalVisible(true);
  };

  const handleRenameConfirm = async () => {
    if (!selectedSession || !renameText.trim()) {
      Alert.alert('错误', '请输入有效的名称。');
      return;
    }

    try {
      const newTitle = renameText.trim();
      await chatDb.updateSessionTitle(selectedSession.id, newTitle);
      await refreshSessions();
      
      // Update sessionPreviews immediately to reflect the change
      setSessionPreviews((prev) => ({
        ...prev,
        [selectedSession.id]: {
          ...prev[selectedSession.id],
          title: newTitle,
        },
      }));
      
      setRenameModalVisible(false);
      setRenameText('');
      setSelectedSession(null);
    } catch (error) {
      console.error('Error renaming session:', error);
      Alert.alert('错误', '重命名会话失败，请稍后重试。');
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) {
      const hours = date.getHours();
      const mins = date.getMinutes();
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    }
    if (diffDays <= 7) {
      const hours = date.getHours();
      const mins = date.getMinutes();
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    }
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const groupSessions = () => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const today = [];
    const previous7Days = [];

    sessions.forEach((session) => {
      const sessionDate = new Date(session.created_at);
      if (sessionDate >= todayStart) {
        today.push(session);
      } else if (sessionDate >= sevenDaysAgo) {
        previous7Days.push(session);
      }
    });

    return { today, previous7Days };
  };

  const { today, previous7Days } = groupSessions();

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const renderSessionCard = (session) => {
    const preview = sessionPreviews[session.id] || {
      title: session.title || '未命名会话',
      preview: '',
    };
    const truncatedTitle =
      preview.title.length > 30 ? preview.title.substring(0, 30) + '..' : preview.title;
    const truncatedPreview =
      preview.preview.length > 60 ? preview.preview.substring(0, 60) + '..' : preview.preview;

    return (
      <TouchableOpacity
        key={session.id}
        style={styles.sessionCard}
        onPress={() => handleSessionPress(session.id)}
      >
        <View style={styles.sessionCardContent}>
          <View style={styles.sessionCardText}>
            <Text style={styles.sessionCardTitle}>{truncatedTitle}</Text>
            {truncatedPreview && (
              <Text style={styles.sessionCardPreview} numberOfLines={2}>
                {truncatedPreview}
              </Text>
            )}
          </View>
          <View style={styles.sessionCardRight}>
            <TouchableOpacity
              style={styles.moreButton}
              onPress={(e) => handleMenuPress(session, e)}
            >
              <Ionicons name="ellipsis-vertical" size={20} color="#6B7280" />
            </TouchableOpacity>
            <Text style={styles.sessionCardTime}>{formatTime(session.created_at)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderSection = (title, sessions, sectionKey) => {
    if (sessions.length === 0) return null;

    return (
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => toggleSection(sectionKey)}
        >
          <Text style={styles.sectionTitle}>{title}</Text>
          <Ionicons
            name={expandedSections[sectionKey] ? 'chevron-down' : 'chevron-forward'}
            size={20}
            color="#6B7280"
          />
        </TouchableOpacity>
        {expandedSections[sectionKey] && (
          <View style={styles.sectionContent}>
            {sessions.map((session) => renderSessionCard(session))}
          </View>
        )}
      </View>
    );
  };

  const handleSessionPress = (sessionId) => {
    // Close sidebar first
    if (onClose) {
      onClose();
    }
    // Navigate to Chatbot screen with sessionId - use a small delay to ensure sidebar closes smoothly
    setTimeout(() => {
      if (navigation) {
        navigation.navigate('Chatbot', { sessionId });
      }
    }, 100);
  };

  const handleNewSessionPress = async () => {
    try {
      // 先关闭侧边栏
      if (onClose) {
        onClose();
      }

      // 通过上下文创建新会话（内部负责刷新列表）
      const newSession = await createSession();

      // 略微延迟后导航到 Chatbot，并携带新的 sessionId
      // 这样 ChatbotScreen 会加载这个全新的空会话，相当于“新建页面”
      setTimeout(() => {
        if (navigation) {
          navigation.navigate('Chatbot', { sessionId: newSession.id });
        }
      }, 100);
    } catch (error) {
      console.error('Error creating new session:', error);
      Alert.alert('错误', '创建新会话失败，请稍后重试。');
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshSessions();
      await loadPreviews();
    } catch (error) {
      console.error('Error refreshing sessions:', error);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView 
      style={styles.safeArea} 
      edges={['top', 'bottom']}
      onLayout={() => setIsLayoutReady(true)}
    >
      {/* 顶部导航栏 */}
      <View style={styles.header}>
        <View style={styles.headerLeftPlaceholder} />
        <Text style={styles.headerTitle}>会话记录</Text>
        <TouchableOpacity style={styles.headerIconButton} onPress={handleNewSessionPress}>
          <Ionicons name="add" size={24} color="#111827" />
        </TouchableOpacity>
      </View>

      {/* 分隔线 */}
      <View style={styles.divider} />

      {/* 会话列表 */}
      <ScrollView 
        style={styles.content} 
        contentContainerStyle={sessions.length === 0 ? styles.emptyContentContainer : undefined}
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
        {isSkeletonLoading ? (
          <View style={styles.skeletonContainer}>{renderSkeletonCards()}</View>
        ) : sessions.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={64} color="#D1D5DB" />
            <Text style={styles.emptyStateTitle}>暂无会话记录</Text>
            <Text style={styles.emptyStateSubtitle}>下拉刷新或点击右上角创建新会话</Text>
          </View>
        ) : (
          <>
            {renderSection('今天', today, 'today')}
            {renderSection('最近7天', previous7Days, 'previous7Days')}
          </>
        )}
      </ScrollView>

      {/* 菜单 Modal */}
      <Modal
        visible={menuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View style={styles.menuContainer}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleRename}
            >
              <Ionicons name="pencil-outline" size={20} color="#111827" />
              <Text style={styles.menuItemText}>Rename</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity
              style={[styles.menuItem, styles.menuItemDanger]}
              onPress={handleDelete}
            >
              <Ionicons name="trash-outline" size={20} color="#EF4444" />
              <Text style={[styles.menuItemText, styles.menuItemTextDanger]}>删除</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 删除状态提示 */}
      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={2500}
        style={styles.snackbar}
      >
        {snackbarMessage}
      </Snackbar>

      {/* 重命名 Modal */}
      <Modal
        visible={renameModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setRenameModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setRenameModalVisible(false)}
        >
          <View style={styles.renameModalContainer}>
            <View style={styles.renameModalContent}>
              <Text style={styles.renameModalTitle}>Rename Conversation</Text>
              <TextInput
                style={styles.renameInput}
                placeholder="输入会话名称"
                placeholderTextColor="#9CA3AF"
                value={renameText}
                onChangeText={setRenameText}
                autoFocus={true}
                maxLength={50}
              />
              <View style={styles.renameModalButtons}>
                <TouchableOpacity
                  style={[styles.renameButton, styles.renameButtonCancel]}
                  onPress={() => {
                    setRenameModalVisible(false);
                    setRenameText('');
                  }}
                >
                  <Text style={styles.renameButtonTextCancel}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.renameButton, styles.renameButtonConfirm]}
                  onPress={handleRenameConfirm}
                >
                  <Text style={styles.renameButtonTextConfirm}>保存</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  snackbar: {
    marginBottom: 24,
  },
  skeletonContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  skeletonCard: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 12,
  },
  skeletonTitle: {
    height: 18,
    width: '60%',
    backgroundColor: '#E5E7EB',
    borderRadius: 8,
    marginBottom: 8,
  },
  skeletonPreview: {
    height: 14,
    width: '90%',
    backgroundColor: '#E5E7EB',
    borderRadius: 8,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
  },
  headerIconButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLeftPlaceholder: {
    width: 32,
    height: 32,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
  },
  content: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  emptyContentContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100%',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: 40,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  sectionContent: {
    gap: 12,
  },
  sessionCard: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  sessionCardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sessionCardText: {
    flex: 1,
    marginRight: 12,
  },
  sessionCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  sessionCardPreview: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  sessionCardRight: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  moreButton: {
    padding: 4,
    marginBottom: 8,
  },
  sessionCardTime: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 8,
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  menuItemDanger: {
    // Additional styling for delete item if needed
  },
  menuItemText: {
    fontSize: 16,
    color: '#111827',
    marginLeft: 12,
  },
  menuItemTextDanger: {
    color: '#EF4444',
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
    marginVertical: 4,
  },
  renameModalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  renameModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  renameModalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
  },
  renameInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#FFFFFF',
    marginBottom: 20,
  },
  renameModalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  renameButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  renameButtonCancel: {
    backgroundColor: '#F3F4F6',
  },
  renameButtonConfirm: {
    backgroundColor: '#7C3AED',
  },
  renameButtonTextCancel: {
    fontSize: 16,
    color: '#6B7280',
    fontWeight: '500',
  },
  renameButtonTextConfirm: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
});


