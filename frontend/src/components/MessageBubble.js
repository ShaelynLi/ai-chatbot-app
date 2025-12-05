/**
 * 消息气泡组件
 * 
 * 功能：
 * - 显示用户消息和 AI 回复（左右对齐）
 * - 支持多版本消息切换（用户可编辑提问，AI 生成多版回复）
 * - 支持图片显示（单图/多图，横向滑动预览）
 * - 支持消息状态显示（发送中/待发送/失败/已发送）
 * - 支持内联编辑用户消息
 * - 支持复制、删除、重试等操作
 * - 支持图片大图预览（Modal）
 * 
 * Props：
 * - role: 'user' | 'assistant' - 消息角色
 * - content: string - 消息内容
 * - status: 'sending' | 'queued' | 'failed' | 'sent' - 消息状态（仅用户消息）
 * - imageUri: string - 单张图片 URI（向后兼容）
 * - allImageUris: string[] - 多张图片 URI 数组
 * - versions: Array - AI 回复版本列表
 * - onUserRetry: function - 重试失败/待发送消息的回调
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Alert, Image, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { toastTexts, alertTexts } from '../utils/strings';

export function MessageBubble({
  role,
  content,
  isError,
  onRetry,
  versions,
  currentVersionIndex,
  onRegenerate,
  onVersionChange,
  onEdit,
  // 内联编辑相关
  isEditing,
  editValue,
  onChangeEditValue,
  onCancelEdit,
  onConfirmEdit,
  isSending,
  editMetaText,
  // 用户消息版本信息（仅在会话详情页使用）
  userMessageVersions,
  currentUserVersionIndex,
  onUserVersionChange,
  onDelete,
  // 图片相关
  imageUri,
  allImageUris, // 支持多张图片
  // 发送状态（仅用户消息使用）：sending | queued | failed | sent
  status,
  onUserRetry,
  createdAt,
  onShowToast,
}) {
  const isUser = role === 'user';
  const isQueued = isUser && status === 'queued';
  const isFailed = isUser && status === 'failed';
  const isSendingStatus = isUser && status === 'sending';
  const [copied, setCopied] = useState(false);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  
  // 确定要显示的图片列表
  const imagesToShow = allImageUris && allImageUris.length > 0 ? allImageUris : (imageUri ? [imageUri] : []);

  const hasMultipleVersions = versions && versions.length > 1;
  const currentVersion = currentVersionIndex !== undefined ? currentVersionIndex + 1 : 1;
  const totalVersions = versions ? versions.length : 1;

  const hasMultipleUserVersions = userMessageVersions && userMessageVersions.length > 1;
  const currentUserVersion =
    currentUserVersionIndex !== undefined ? currentUserVersionIndex + 1 : 1;
  const totalUserVersions = userMessageVersions ? userMessageVersions.length : 1;

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const hh = `${d.getHours()}`.padStart(2, '0');
    const mm = `${d.getMinutes()}`.padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      onShowToast && onShowToast(toastTexts.copySuccess);
    } catch (e) {
      console.error(e);
      Alert.alert(alertTexts.copyFailTitle, alertTexts.copyFailMessage);
      onShowToast && onShowToast(toastTexts.copyFail);
    }
  };

  return (
    <View
      style={[
        styles.messageContainer,
        isUser && styles.messageContainerUser,
      ]}
    >
      {/* 图片显示（仅用户消息） */}
      {isUser && imagesToShow.length > 0 && (
        <View style={[styles.imagesContainerAbove, styles.imagesContainerAboveUser]}>
          {imagesToShow.length === 1 ? (
            // 单张图片
            <TouchableOpacity
              onPress={() => {
                setSelectedImageIndex(0);
                setImageModalVisible(true);
              }}
              style={[
                styles.imageThumbnailContainer,
                // 只有图片没有文字时，给图片添加气泡样式
                (!content || !content.trim()) && styles.imageOnlyBubble,
              ]}
            >
              <Image
                source={{ uri: imagesToShow[0] }}
                style={styles.imageThumbnail}
                resizeMode="cover"
              />
              <View style={styles.imageOverlay}>
                <Ionicons name="expand" size={16} color="#FFFFFF" />
              </View>
            </TouchableOpacity>
          ) : (
            // 多张图片 - 横向滑动
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.imagesScrollContent}
            >
              {imagesToShow.map((uri, index) => (
                <TouchableOpacity
                  key={index}
                  onPress={() => {
                    setSelectedImageIndex(index);
                    setImageModalVisible(true);
                  }}
                  style={[
                    styles.imageThumbnailContainer,
                    // 只有图片没有文字时，给图片添加气泡样式
                    (!content || !content.trim()) && styles.imageOnlyBubble,
                  ]}
                >
                  <Image
                    source={{ uri }}
                    style={styles.imageThumbnail}
                    resizeMode="cover"
                  />
                  <View style={styles.imageOverlay}>
                    <Ionicons name="expand" size={16} color="#FFFFFF" />
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* 图片-only 的时间/状态条：保持与文本气泡信息一致 */}
      {isUser && imagesToShow.length > 0 && (!content || !content.trim()) && (
        <View style={styles.imageMetaRow}>
          <Text style={styles.imageMetaTime}>{formatTime(createdAt)}</Text>
          {isSendingStatus && <Text style={styles.imageMetaStatus}>发送中</Text>}
          {isQueued && <Text style={styles.imageMetaStatus}>待发送</Text>}
          {isFailed && <Text style={styles.imageMetaStatusFailed}>发送失败</Text>}
        </View>
      )}
      {!isUser && imagesToShow.length > 0 && (!content || !content.trim()) && (
        <View style={styles.imageMetaRow}>
          <Text style={styles.imageMetaTime}>{formatTime(createdAt)}</Text>
        </View>
      )}

      {/* 气泡框：只有当有文字内容时才显示 */}
      {(content && content.trim()) && (
        <View
          style={[
            styles.bubble,
            isUser ? styles.userBubble : styles.assistantBubble,
            isError && styles.errorBubble,
            isUser && imagesToShow.length > 0 && styles.bubbleWithImagesAbove,
          ]}
        >
          {isUser && isEditing ? (
            <TextInput
              style={[styles.text, styles.editTextInput]}
              multiline
              value={editValue}
              onChangeText={onChangeEditValue}
              placeholder="编辑消息..."
              placeholderTextColor="rgba(255,255,255,0.7)"
            />
          ) : (
            <Text
              style={[
                styles.text,
                isUser ? styles.userText : styles.assistantText,
                isError && styles.errorText,
                imagesToShow.length > 0 && styles.textWithImage,
              ]}
              numberOfLines={0}
            >
              {content}
            </Text>
          )}
        </View>
      )}

      {/* 图片预览 Modal */}
      <Modal
        visible={imageModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setImageModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.imageModalOverlay}
          activeOpacity={1}
          onPress={() => setImageModalVisible(false)}
        >
          <View style={styles.imageModalContent}>
            <TouchableOpacity
              style={styles.imageModalCloseButton}
              onPress={() => setImageModalVisible(false)}
            >
              <Ionicons name="close" size={28} color="#FFFFFF" />
            </TouchableOpacity>
            {imagesToShow.length > 0 && (
              <>
                <Image
                  source={{ uri: imagesToShow[selectedImageIndex] }}
                  style={styles.imageModalImage}
                  resizeMode="contain"
                />
                {imagesToShow.length > 1 && (
                  <>
                    <TouchableOpacity
                      style={[styles.imageModalNavButton, styles.imageModalNavButtonLeft]}
                      onPress={() => {
                        setSelectedImageIndex((prev) => (prev > 0 ? prev - 1 : imagesToShow.length - 1));
                      }}
                    >
                      <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.imageModalNavButton, styles.imageModalNavButtonRight]}
                      onPress={() => {
                        setSelectedImageIndex((prev) => (prev < imagesToShow.length - 1 ? prev + 1 : 0));
                      }}
                    >
                      <Ionicons name="chevron-forward" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                    <View style={styles.imageModalIndicator}>
                      <Text style={styles.imageModalIndicatorText}>
                        {selectedImageIndex + 1} / {imagesToShow.length}
                      </Text>
                    </View>
                  </>
                )}
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 用户消息：版本信息 + 内联编辑操作 */}
      {isUser && (
        <>
          {/* 用户气泡下方的版本切换（如 1/2、2/2） */}
          {hasMultipleUserVersions && (
            <View style={styles.versionControl}>
              <TouchableOpacity
                style={[
                  styles.versionButton,
                  currentUserVersionIndex === 0 && styles.versionButtonDisabled,
                ]}
                onPress={() => onUserVersionChange && onUserVersionChange('prev')}
                disabled={currentUserVersionIndex === 0}
              >
                <Ionicons
                  name="chevron-back"
                  size={16}
                  color={currentUserVersionIndex === 0 ? '#D1D5DB' : '#6B7280'}
                />
              </TouchableOpacity>
              <Text style={styles.versionText}>
                {currentUserVersion}/{totalUserVersions}
              </Text>
              <TouchableOpacity
                style={[
                  styles.versionButton,
                  currentUserVersionIndex === totalUserVersions - 1 &&
                    styles.versionButtonDisabled,
                ]}
                onPress={() => onUserVersionChange && onUserVersionChange('next')}
                disabled={currentUserVersionIndex === totalUserVersions - 1}
              >
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={
                    currentUserVersionIndex === totalUserVersions - 1 ? '#D1D5DB' : '#6B7280'
                  }
                />
              </TouchableOpacity>
            </View>
          )}

          {/* 用户气泡下方的编辑操作区 + 发送状态提示 */}
          <View style={styles.userActionRow}>
            {/* 状态提示：不换行，右对齐，尾部紧贴铅笔icon */}
            {(isSendingStatus || isQueued || isFailed) && (
              <View style={styles.statusContainer}>
                {isSendingStatus && (
                  <Text style={styles.statusText} numberOfLines={1}>
                    发送中...
                  </Text>
                )}
                {isQueued && (
                  <Text style={styles.statusText} numberOfLines={1}>
                    待发送（网络恢复后将自动重试）
                  </Text>
                )}
                {isFailed && (
                  <Text style={styles.statusText} numberOfLines={1}>
                    发送失败，请检查网络后重试
                  </Text>
                )}
                {(isQueued || isFailed) && onUserRetry && (
                  <TouchableOpacity
                    style={styles.statusRetryButton}
                    onPress={onUserRetry}
                  >
                    <Text style={styles.statusRetryButtonText}>重试</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* 右侧操作按钮：固定宽度，靠右对齐 */}
            <View style={styles.userActionRight}>
              {/* 内联编辑按钮或编辑操作按钮 */}
              {!isEditing && onEdit && (
                <TouchableOpacity style={styles.userActionButton} onPress={onEdit}>
                  <Ionicons name="pencil" size={18} color="#6B7280" />
                </TouchableOpacity>
              )}

              {isEditing && (
                <View style={styles.inlineEditContainer}>
                  {editMetaText ? (
                    <Text style={styles.editMetaText}>{editMetaText}</Text>
                  ) : null}
                  <View style={styles.inlineButtonsRow}>
                    <TouchableOpacity
                      style={[styles.inlineButton, styles.inlineCancelButton]}
                      onPress={onCancelEdit}
                      disabled={isSending}
                    >
                      <Text style={styles.inlineCancelText}>取消</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.inlineButton,
                        styles.inlineSendButton,
                        ((!editValue || !editValue.trim()) || isSending) &&
                          styles.inlineSendButtonDisabled,
                      ]}
                      onPress={onConfirmEdit}
                      disabled={!editValue || !editValue.trim() || isSending}
                    >
                      <Text style={styles.inlineSendText}>发送</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </View>
        </>
      )}

      {/* 助手机器人消息：版本切换 + 重试/重新生成 + 复制 */}
      {!isUser && (
        <>
          {hasMultipleVersions && (
            <View style={styles.versionControl}>
              <TouchableOpacity
                style={[
                  styles.versionButton,
                  currentVersionIndex === 0 && styles.versionButtonDisabled,
                ]}
                onPress={() => onVersionChange && onVersionChange('prev')}
                disabled={currentVersionIndex === 0}
              >
                <Ionicons
                  name="chevron-back"
                  size={16}
                  color={currentVersionIndex === 0 ? '#D1D5DB' : '#6B7280'}
                />
              </TouchableOpacity>
              <Text style={styles.versionText}>
                {currentVersion}/{totalVersions}
              </Text>
              <TouchableOpacity
                style={[
                  styles.versionButton,
                  currentVersionIndex === totalVersions - 1 && styles.versionButtonDisabled,
                ]}
                onPress={() => onVersionChange && onVersionChange('next')}
                disabled={currentVersionIndex === totalVersions - 1}
              >
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={currentVersionIndex === totalVersions - 1 ? '#D1D5DB' : '#6B7280'}
                />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.actionButtonsContainer}>
            {isError && onRetry && (
              <TouchableOpacity
                style={[styles.actionButton, styles.actionButtonFirst]}
                onPress={onRetry}
              >
                <Ionicons name="refresh" size={18} color="#6B7280" />
              </TouchableOpacity>
            )}
            {!isError && onRegenerate && (
              <TouchableOpacity
                style={[styles.actionButton, styles.actionButtonFirst]}
                onPress={onRegenerate}
              >
                <Ionicons name="refresh" size={18} color="#6B7280" />
              </TouchableOpacity>
            )}
            {onDelete && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={onDelete}
              >
                <Ionicons name="trash-outline" size={18} color="#6B7280" />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.actionButton} onPress={handleCopy}>
              <Ionicons
                name={copied ? 'checkmark-circle' : 'copy-outline'}
                size={18}
                color={copied ? '#10B981' : '#6B7280'}
              />
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  messageContainer: {
    maxWidth: '80%',
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  messageContainerUser: {
    alignSelf: 'flex-end',
  },
  bubble: {
    minWidth: 60,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    marginBottom: 4, // 与下方状态/操作区域留一点间距，避免视觉遮挡
  },
  bubbleWithImagesAbove: {
    marginTop: 4, // 图片在上方时，气泡与图片之间留一点间距
    // 移除 flexDirection 和 flexWrap，保持与纯文本消息一致的气泡框大小
  },
  imageOnlyBubble: {
    // 只有图片没有文字时，给图片添加气泡样式，让它看起来更自然
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.2)', // 淡紫色边框，与用户气泡颜色呼应
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2, // Android 阴影
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#7C3AED',
    // 继承 bubble 的统一圆角，避免底部被“切平”的视觉错觉
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    // 同样继承 bubble 的统一圆角
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
    flexShrink: 1,
  },
  userText: {
    color: '#FFFFFF',
  },
  assistantText: {
    color: '#111827',
  },
  errorBubble: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: {
    color: '#DC2626',
  },
  // 助手机器人版本控制
  versionControl: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 4,
    paddingHorizontal: 8,
  },
  versionButton: {
    padding: 4,
    borderRadius: 4,
  },
  versionButtonDisabled: {
    opacity: 0.5,
  },
  versionText: {
    fontSize: 12,
    color: '#6B7280',
    marginHorizontal: 8,
    minWidth: 30,
    textAlign: 'center',
  },
  // 助手机器人操作按钮
  actionButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 4,
    paddingRight: 4,
  },
  actionButton: {
    padding: 4,
    marginLeft: 8,
    borderRadius: 4,
  },
  actionButtonFirst: {
    marginLeft: 0,
  },
  // 用户内联编辑
  editTextInput: {
    color: '#FFFFFF',
    paddingVertical: 0,
  },
  userActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end', // 整体靠右对齐
    alignItems: 'center', // 垂直居中对齐
    marginTop: 4,
    paddingRight: 4,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0, // 防止被压缩
    marginRight: 8, // 与铅笔icon的间距
  },
  userActionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0, // 防止右侧按钮被压缩
  },
  statusText: {
    fontSize: 11,
    color: '#9CA3AF',
    flexShrink: 0, // 防止文本被压缩
    marginRight: 8, // 与重试按钮的间距
  },
  statusRetryButton: {
    flexShrink: 0, // 防止按钮被压缩
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#9CA3AF',
  },
  statusRetryButtonText: {
    fontSize: 12,
    color: '#6B7280',
  },
  userActionButton: {
    padding: 4,
    borderRadius: 4,
  },
  inlineEditContainer: {
    flexShrink: 1,
    marginLeft: 8,
  },
  editMetaText: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
    textAlign: 'right',
  },
  inlineButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  inlineButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginLeft: 8,
  },
  inlineCancelButton: {
    backgroundColor: '#E5E7EB',
  },
  inlineSendButton: {
    backgroundColor: '#7C3AED',
  },
  inlineSendButtonDisabled: {
    backgroundColor: '#E5E7EB',
    opacity: 0.6,
  },
  inlineCancelText: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '500',
  },
  inlineSendText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  // 图片相关样式
  imagesContainerAbove: {
    marginBottom: 8,
    maxWidth: '80%',
  },
  imagesContainerAboveUser: {
    alignSelf: 'flex-end',
  },
  imagesScrollContent: {
    gap: 8,
    paddingRight: 8,
  },
  imageThumbnailContainer: {
    width: 133, // 从 200 缩小约 1/3
    height: 133,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    marginRight: 8,
  },
  imageThumbnail: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textWithImage: {
    marginTop: 0,
  },
  imageModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageModalContent: {
    width: '90%',
    height: '80%',
    position: 'relative',
  },
  imageModalCloseButton: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageModalImage: {
    width: '100%',
    height: '100%',
  },
  imageCountOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageCountText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  imageModalNavButton: {
    position: 'absolute',
    top: '50%',
    transform: [{ translateY: -20 }],
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  imageModalNavButtonLeft: {
    left: 20,
  },
  imageModalNavButtonRight: {
    right: 20,
  },
  imageModalIndicator: {
    position: 'absolute',
    bottom: 20,
    left: '50%',
    transform: [{ translateX: -30 }],
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  imageModalIndicatorText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  imageMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  imageMetaTime: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  imageMetaStatus: {
    fontSize: 12,
    color: '#6B7280',
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  imageMetaStatusFailed: {
    fontSize: 12,
    color: '#B91C1C',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
});

