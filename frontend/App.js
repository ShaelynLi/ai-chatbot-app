import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider } from 'react-native-paper';

import { ChatProvider } from './src/context/ChatContext';
import { SidebarProvider } from './src/context/SidebarContext';
import { ChatbotScreen } from './src/screens/ChatbotScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { Sidebar } from './src/components/Sidebar';

const Stack = createNativeStackNavigator();

function AppNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="Chatbot" component={ChatbotScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <PaperProvider>
      <SidebarProvider>
        <ChatProvider>
          <NavigationContainer>
            <AppNavigator />
            <Sidebar />
          </NavigationContainer>
        </ChatProvider>
      </SidebarProvider>
    </PaperProvider>
  );
}



