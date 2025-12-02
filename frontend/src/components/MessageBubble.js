import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

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
}) {
  const isUser = role === 'user';
  const [copied, setCopied] = useState(false);

  const hasMultipleVersions = versions && versions.length > 1;
  const currentVersion = currentVersionIndex !== undefined ? currentVersionIndex + 1 : 1;
  const totalVersions = versions ? versions.length : 1;

  const hasMultipleUserVersions = userMessageVersions && userMessageVersions.length > 1;
  const currentUserVersion =
    currentUserVersionIndex !== undefined ? currentUserVersionIndex + 1 : 1;
  const totalUserVersions = userMessageVersions ? userMessageVersions.length : 1;

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error(e);
      Alert.alert('复制失败', '无法复制到剪贴板，请稍后重试');
    }
  };

  return (
    <View
      style={[
        styles.messageContainer,
        isUser && styles.messageContainerUser,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.assistantBubble,
          isError && styles.errorBubble,
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
            ]}
            numberOfLines={0}
          >
            {content}
          </Text>
        )}
      </View>

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

          {/* 用户气泡下方的编辑操作区 */}
          <View style={styles.userActionRow}>
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
                      ((!editValue || !editValue.trim()) || isSending) && styles.inlineSendButtonDisabled,
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
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  messageContainerUser: {
    alignSelf: 'flex-end',
  },
  bubble: {
    minWidth: 60,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#7C3AED',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 4,
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
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 4,
    paddingRight: 4,
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
});

