/**
 * 应用入口文件
 * 
 * 功能：
 * - 配置 React Navigation 导航栈
 * - 提供全局 Context（ChatProvider, SidebarProvider）
 * - 配置 Material Design 主题（PaperProvider）
 * - 注册所有屏幕路由
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider } from 'react-native-paper';

import { ChatProvider } from './src/context/ChatContext';
import { SidebarProvider } from './src/context/SidebarContext';
import { ChatbotScreen } from './src/screens/ChatbotScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { ImageGalleryScreen } from './src/screens/ImageGalleryScreen';
import { Sidebar } from './src/components/Sidebar';

const Stack = createNativeStackNavigator();

/**
 * 应用导航器组件
 * 定义所有屏幕路由，隐藏默认导航栏（使用自定义 UI）
 */
function AppNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false, // 隐藏默认导航栏，使用自定义 UI
      }}
    >
      {/* 主聊天界面 */}
      <Stack.Screen name="Chatbot" component={ChatbotScreen} />
      {/* 个人中心/设置页面 */}
      <Stack.Screen name="Profile" component={ProfileScreen} />
      {/* 图片管理页面 */}
      <Stack.Screen name="ImageGallery" component={ImageGalleryScreen} />
    </Stack.Navigator>
  );
}

/**
 * 应用根组件
 * 按从外到内的顺序提供全局 Context 和导航容器
 */
/**
 * 应用根组件
 * 按从外到内的顺序提供全局 Context 和导航容器
 */
export default function App() {
  return (
    // Material Design 主题提供者
    <PaperProvider>
      {/* 侧边栏状态管理 */}
      <SidebarProvider>
        {/* 聊天数据管理（会话列表、消息等） */}
        <ChatProvider>
          {/* React Navigation 导航容器 */}
          <NavigationContainer>
            {/* 主导航栈 */}
            <AppNavigator />
            {/* 全局侧边栏组件（抽屉式） */}
            <Sidebar />
          </NavigationContainer>
        </ChatProvider>
      </SidebarProvider>
    </PaperProvider>
  );
}



