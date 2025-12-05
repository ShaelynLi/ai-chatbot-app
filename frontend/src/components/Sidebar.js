/**
 * 侧边栏组件（抽屉式）
 * 
 * 功能：
 * - 从左侧滑入/滑出的抽屉式侧边栏
 * - 显示会话列表（复用 SessionListScreen）
 * - 支持点击遮罩层关闭
 * - 使用动画实现平滑的打开/关闭效果
 * - 响应屏幕尺寸变化，自动调整宽度
 * 
 * 使用方式：
 * - 通过 SidebarContext 控制显示/隐藏
 * - 在 App.js 中作为全局组件渲染
 */

import React from 'react';
import {
  Animated,
  Dimensions,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SessionListScreen } from '../screens/SessionListScreen';
import { useSidebar } from '../context/SidebarContext';

export function Sidebar() {
  const navigation = useNavigation();
  const { visible, closeSidebar } = useSidebar();
  const [sidebarWidth, setSidebarWidth] = React.useState(() => Dimensions.get('window').width * 0.8);
  
  // 初始化动画值：侧边栏在屏幕左侧外（隐藏状态）
  const slideAnim = React.useRef(new Animated.Value(-Dimensions.get('window').width * 0.8)).current;
  const overlayOpacity = React.useRef(new Animated.Value(0)).current;
  
  // 使用 ref 跟踪动画状态，避免重复动画
  const isAnimating = React.useRef(false);
  const prevVisible = React.useRef(visible);
  
  // 使用状态跟踪是否应该渲染（用于控制 zIndex 和 pointerEvents）
  // 这样可以确保关闭动画完成前组件始终可见
  const [shouldRender, setShouldRender] = React.useState(visible);

  // Update width when window dimensions change
  React.useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      const newWidth = window.width * 0.8;
      setSidebarWidth(newWidth);
      // 如果侧边栏是关闭状态，更新动画值到新的隐藏位置
      if (!visible) {
        slideAnim.setValue(-newWidth);
      }
    });

    return () => subscription?.remove();
  }, [visible, slideAnim]);

  // Handle visibility changes with proper animation
  React.useEffect(() => {
    // 如果状态没有变化，不执行动画
    if (prevVisible.current === visible) {
      return;
    }
    
    // 如果正在动画中，先停止当前动画
    if (isAnimating.current) {
      slideAnim.stopAnimation();
      overlayOpacity.stopAnimation();
    }
    
    prevVisible.current = visible;
    isAnimating.current = true;

    if (visible) {
      // 打开侧边栏：先确保组件可见，然后从左侧滑入
      setShouldRender(true);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        isAnimating.current = false;
      });
    } else {
      // 关闭侧边栏：滑回左侧，动画完成后再隐藏组件
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -sidebarWidth,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        isAnimating.current = false;
        // 动画完成后再隐藏组件，确保动画过程中组件始终可见
        setShouldRender(false);
      });
    }
  }, [visible, sidebarWidth, slideAnim, overlayOpacity]);

  // 如果组件不应该渲染，直接返回 null
  if (!shouldRender && !visible) {
    return null;
  }

  return (
    <View 
      style={[
        styles.container,
        { zIndex: shouldRender ? 1000 : -1 }
      ]} 
      pointerEvents={shouldRender ? 'box-none' : 'none'}
    >
      <Animated.View
        style={[
          styles.sidebar,
          {
            width: sidebarWidth,
            transform: [{ translateX: slideAnim }],
            zIndex: 1001,
          },
        ]}
        onLayout={(e) => {
          // Ensure width is correct on layout
          const { width: layoutWidth } = e.nativeEvent.layout;
          if (layoutWidth > 0 && Math.abs(layoutWidth - sidebarWidth) > 1) {
            setSidebarWidth(layoutWidth);
          }
        }}
      >
        <SessionListScreen 
          navigation={navigation} 
          onClose={closeSidebar}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.overlay,
          {
            opacity: overlayOpacity,
          },
        ]}
        pointerEvents={shouldRender && visible ? 'auto' : 'none'}
      >
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={closeSidebar}
          disabled={!shouldRender || !visible}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  sidebar: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  overlayTouchable: {
    flex: 1,
  },
});

