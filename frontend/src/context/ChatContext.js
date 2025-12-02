import React, { createContext, useContext, useEffect, useState } from 'react';
import { chatDb } from '../db/database';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    chatDb.init().then(chatDb.listSessions).then(setSessions).catch(console.error);
  }, []);

  const refreshSessions = async () => {
    const list = await chatDb.listSessions();
    setSessions(list);
  };

  const value = {
    sessions,
    refreshSessions,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error('useChat must be used within ChatProvider');
  }
  return ctx;
}


