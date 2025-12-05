/**
 * 侧边栏上下文（SidebarContext）
 * 
 * 功能：
 * - 管理侧边栏的显示/隐藏状态
 * - 提供打开/关闭侧边栏的方法
 * 
 * 使用方式：
 * - 在组件中使用 useSidebar() Hook 获取上下文
 * - 确保组件被 SidebarProvider 包裹
 */

import React, { createContext, useContext, useState } from 'react';

const SidebarContext = createContext();

/**
 * 侧边栏上下文提供者组件
 * @param {Object} props
 * @param {React.ReactNode} props.children - 子组件
 */
export function SidebarProvider({ children }) {
  const [visible, setVisible] = useState(false);

  /** 打开侧边栏 */
  const openSidebar = () => setVisible(true);
  
  /** 关闭侧边栏 */
  const closeSidebar = () => setVisible(false);

  return (
    <SidebarContext.Provider value={{ visible, openSidebar, closeSidebar }}>
      {children}
    </SidebarContext.Provider>
  );
}

/**
 * 使用侧边栏上下文的 Hook
 * 必须在 SidebarProvider 内部使用
 * @returns {Object} 上下文对象，包含 visible, openSidebar, closeSidebar
 * @throws {Error} 如果不在 SidebarProvider 内部使用，抛出错误
 */
export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return context;
}

