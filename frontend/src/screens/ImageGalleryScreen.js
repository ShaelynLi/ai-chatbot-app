/**
 * 图片管理屏幕
 * 
 * 功能：
 * - 显示当前会话的所有图片（网格布局）
 * - 支持图片预览（点击查看大图，支持缩放）
 * - 支持再次发送图片（将图片重新作为新消息发送给 AI）
 * - 支持删除图片（删除数据库记录和本地文件）
 * - 支持多图预览（左右滑动切换）
 * 
 * 使用场景：
 * - 从聊天界面点击图片管理入口进入
 * - 查看会话中所有已上传的图片
 * - 重新分析某张图片或删除不需要的图片
 * 
 * 数据流：
 * - 从数据库加载图片列表（按创建时间倒序）
 * - 删除操作通过 chatService 统一处理（数据库 + 文件系统）
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  Alert,
  Modal,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { chatDb } from '../db/database';
import { readImageAsBase64, base64ToDataUrl } from '../services/fileStorage';
import { sendMessageWithImage } from '../services/api';
import { useChat } from '../context/ChatContext';
import { chatService } from '../services/chatService';

export function ImageGalleryScreen({ route, navigation }) {
  const { sessionId } = route.params || {};
  const { refreshSessions } = useChat();
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [sendingImage, setSendingImage] = useState(null);
  const [resendModalVisible, setResendModalVisible] = useState(false);
  const [resendImage, setResendImage] = useState(null);
  const [resendText, setResendText] = useState('');

  useEffect(() => {
    loadImages();
  }, [sessionId]);

  const loadImages = async () => {
    if (!sessionId) {
      setLoading(false);
      return;
    }

    try {
      const imageList = await chatDb.listImages(sessionId);
      setImages(imageList);
    } catch (error) {
      console.error('Error loading images:', error);
      Alert.alert('加载失败', '无法加载图片列表');
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = (image) => {
    setSelectedImage(image);
    setPreviewVisible(true);
  };

  const handleResend = (image) => {
    if (sendingImage) return;
    setResendImage(image);
    setResendText('');
    setResendModalVisible(true);
  };

  const confirmResend = async () => {
    if (!resendImage) return;

    setSendingImage(resendImage.id);
    setResendModalVisible(false);

    try {
      // 读取图片为 base64
      const base64 = await readImageAsBase64(resendImage.uri);
      const imageDataUrl = base64ToDataUrl(base64);

      // 发送到后端
      await sendMessageWithImage({
        message: resendText.trim() || '',
        imageBase64: imageDataUrl,
        sessionId,
      });

      Alert.alert('发送成功', '图片已重新发送给 AI');
      
      // 返回聊天页面
      navigation.navigate('Chatbot', { sessionId });
    } catch (error) {
      console.error('Error resending image:', error);
      Alert.alert('发送失败', error.message || '请稍后重试');
    } finally {
      setSendingImage(null);
      setResendImage(null);
      setResendText('');
    }
  };

  const handleDelete = (image) => {
    Alert.alert(
      '删除图片',
      '确定要删除这张图片吗？此操作无法撤销。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              // 使用服务层统一处理单张图片的数据库记录和本地文件删除
              await chatService.deleteImageWithFile(image);

              // 刷新列表
              await loadImages();
            } catch (error) {
              console.error('Error deleting image:', error);
              Alert.alert('删除失败', error.message || '请稍后重试');
            }
          },
        },
      ]
    );
  };

  const renderImageItem = ({ item }) => (
    <View style={styles.imageCard}>
      <TouchableOpacity
        style={styles.imageContainer}
        onPress={() => handlePreview(item)}
        activeOpacity={0.8}
      >
        <Image source={{ uri: item.uri }} style={styles.imageThumbnail} resizeMode="cover" />
        <View style={styles.imageOverlay}>
          <Ionicons name="expand" size={24} color="#FFFFFF" />
        </View>
      </TouchableOpacity>

      <View style={styles.imageActions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.resendButton]}
          onPress={() => handleResend(item)}
          disabled={sendingImage === item.id}
        >
          {sendingImage === item.id ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="refresh" size={18} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>再次发送</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.deleteButton]}
          onPress={() => handleDelete(item)}
        >
          <Ionicons name="trash-outline" size={18} color="#FFFFFF" />
          <Text style={styles.actionButtonText}>删除</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={() => navigation?.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>图片管理</Text>
          <View style={styles.headerIconButton} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#7C3AED" />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => navigation?.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>图片管理</Text>
        <View style={styles.headerIconButton} />
      </View>

      {images.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="images-outline" size={64} color="#D1D5DB" />
          <Text style={styles.emptyText}>还没有图片</Text>
          <Text style={styles.emptySubtext}>在聊天中选择图片发送后，图片会显示在这里</Text>
        </View>
      ) : (
        <FlatList
          data={images}
          renderItem={renderImageItem}
          keyExtractor={(item) => item.id.toString()}
          numColumns={2}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.row}
        />
      )}

      {/* 图片预览 Modal */}
      <Modal
        visible={previewVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <TouchableOpacity
          style={styles.previewOverlay}
          activeOpacity={1}
          onPress={() => setPreviewVisible(false)}
        >
          <View style={styles.previewContent}>
            <TouchableOpacity
              style={styles.previewCloseButton}
              onPress={() => setPreviewVisible(false)}
            >
              <Ionicons name="close" size={28} color="#FFFFFF" />
            </TouchableOpacity>
            {selectedImage && (
              <Image
                source={{ uri: selectedImage.uri }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 再次发送 Modal */}
      <Modal
        visible={resendModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setResendModalVisible(false)}
      >
        <View style={styles.resendModalOverlay}>
          <View style={styles.resendModalContent}>
            <View style={styles.resendModalHeader}>
              <Text style={styles.resendModalTitle}>再次发送图片</Text>
              <TouchableOpacity
                onPress={() => {
                  setResendModalVisible(false);
                  setResendImage(null);
                  setResendText('');
                }}
              >
                <Ionicons name="close" size={24} color="#111827" />
              </TouchableOpacity>
            </View>
            <Text style={styles.resendModalHint}>
              请输入一个问题（可选），或直接发送以重新分析图片
            </Text>
            <TextInput
              style={styles.resendModalInput}
              placeholder="输入问题..."
              placeholderTextColor="#9CA3AF"
              value={resendText}
              onChangeText={setResendText}
              multiline
              autoFocus
            />
            <View style={styles.resendModalButtons}>
              <TouchableOpacity
                style={[styles.resendModalButton, styles.resendModalButtonCancel]}
                onPress={() => {
                  setResendModalVisible(false);
                  setResendImage(null);
                  setResendText('');
                }}
              >
                <Text style={styles.resendModalButtonCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.resendModalButton, styles.resendModalButtonSend]}
                onPress={confirmResend}
                disabled={sendingImage !== null}
              >
                <Text style={styles.resendModalButtonSendText}>发送</Text>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#9CA3AF',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 8,
    textAlign: 'center',
  },
  listContent: {
    padding: 16,
  },
  row: {
    justifyContent: 'space-between',
  },
  imageCard: {
    width: '48%',
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  imageContainer: {
    width: '100%',
    height: 200,
    position: 'relative',
  },
  imageThumbnail: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageActions: {
    flexDirection: 'row',
    padding: 8,
    gap: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 4,
  },
  resendButton: {
    backgroundColor: '#7C3AED',
  },
  deleteButton: {
    backgroundColor: '#EF4444',
  },
  actionButtonText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewContent: {
    width: '90%',
    height: '80%',
    position: 'relative',
  },
  previewCloseButton: {
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
  previewImage: {
    width: '100%',
    height: '100%',
  },
  resendModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  resendModalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  resendModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  resendModalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  resendModalHint: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
  },
  resendModalInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#111827',
    minHeight: 100,
    maxHeight: 200,
    textAlignVertical: 'top',
    marginBottom: 20,
  },
  resendModalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  resendModalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resendModalButtonCancel: {
    backgroundColor: '#F3F4F6',
  },
  resendModalButtonSend: {
    backgroundColor: '#7C3AED',
  },
  resendModalButtonCancelText: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '600',
  },
  resendModalButtonSendText: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});

