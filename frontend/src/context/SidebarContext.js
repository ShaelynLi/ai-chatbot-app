import React, { createContext, useContext, useState } from 'react';

const SidebarContext = createContext();

export function SidebarProvider({ children }) {
  const [visible, setVisible] = useState(false);

  const openSidebar = () => setVisible(true);
  const closeSidebar = () => setVisible(false);

  return (
    <SidebarContext.Provider value={{ visible, openSidebar, closeSidebar }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return context;
}

