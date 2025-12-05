/**
 * 个人中心/设置屏幕
 * 
 * 功能：
 * - 显示用户信息（占位符，当前无登录功能）
 * - 提供"清除所有数据"功能（删除所有会话和图片）
 * - 满足 GDPR/CCPA 类似的数据删除需求
 * 
 * 注意：
 * - 当前版本无用户登录，用户信息为占位符
 * - 清除数据操作不可恢复，需要二次确认
 */

import React from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useChat } from '../context/ChatContext';

export function ProfileScreen({ navigation }) {
  const { clearAllData } = useChat();

  const handleClearAll = () => {
    Alert.alert(
      '清除所有数据',
      '此操作将删除本机上的所有会话记录和已保存的图片资产，且无法恢复。确定继续吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清除',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllData();
              Alert.alert('已清除', '所有本地会话与图片已删除。');
              navigation?.goBack();
            } catch (error) {
              console.error('Clear all data error:', error);
              Alert.alert('操作失败', error.message || '清除数据时发生错误，请稍后重试。');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* 顶部导航栏 */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => navigation?.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>个人中心</Text>
        <View style={styles.headerRightPlaceholder} />
      </View>

      <View style={styles.container}>
        {/* 用户信息卡片 */}
        <View style={styles.profileCard}>
          <View style={styles.avatarWrapper}>
            <View style={styles.avatarCircle} />
          </View>
          <View style={styles.profileTextWrapper}>
            <Text style={styles.profileName}>用户名</Text>
            <Text style={styles.profileEmail}>未设置邮箱</Text>
          </View>
        </View>

        {/* 设置分组：账号信息 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>账号信息</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="person-circle-outline" size={22} color="#6B7280" />
                <Text style={styles.rowTitle}>个人资料</Text>
              </View>
              <Text style={styles.rowValue}>未配置</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="mail-outline" size={20} color="#6B7280" />
                <Text style={styles.rowTitle}>邮箱</Text>
              </View>
              <Text style={styles.rowValue}>未设置邮箱</Text>
            </View>
          </View>
        </View>

        {/* 设置分组：关于应用 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>关于应用</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="information-circle-outline" size={20} color="#6B7280" />
                <Text style={styles.rowTitle}>应用版本</Text>
              </View>
              <Text style={styles.rowValue}>v1.0.0</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="shield-checkmark-outline" size={20} color="#6B7280" />
                <Text style={styles.rowTitle}>隐私政策</Text>
              </View>
              <Text style={styles.rowValue}>尚未配置</Text>
            </View>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.row} onPress={handleClearAll}>
              <View style={styles.rowLeft}>
                <Ionicons name="trash-outline" size={20} color="#EF4444" />
                <Text style={[styles.rowTitle, styles.dangerText]}>清除所有数据</Text>
              </View>
              <Text style={[styles.rowValue, styles.dangerText]}>不可恢复</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
  headerRightPlaceholder: {
    width: 32,
    height: 32,
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 24,
  },
  avatarWrapper: {
    marginRight: 16,
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  profileTextWrapper: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 14,
    color: '#6B7280',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  card: {
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowTitle: {
    fontSize: 16,
    color: '#111827',
    marginLeft: 8,
  },
  rowValue: {
    fontSize: 14,
    color: '#6B7280',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
    marginHorizontal: -16,
  },
  dangerText: {
    color: '#EF4444',
  },
});


