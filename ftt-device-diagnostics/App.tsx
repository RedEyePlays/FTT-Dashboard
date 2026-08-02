import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ResultsProvider } from './src/context/ResultsContext';
import type { RootStackParamList } from './src/navigation/types';
import { HomeScreen } from './src/screens/HomeScreen';
import { ReportDetailScreen } from './src/screens/ReportDetailScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { SummaryScreen } from './src/screens/SummaryScreen';
import { TestRunnerScreen } from './src/screens/TestRunnerScreen';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <ResultsProvider>
        <StatusBar style="light" />
        <NavigationContainer theme={navTheme}>
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: colors.surface },
              headerTitleStyle: { color: colors.text },
              headerTintColor: colors.primary,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Test" component={TestRunnerScreen} options={{ title: 'Test' }} />
            <Stack.Screen name="Summary" component={SummaryScreen} options={{ title: 'Report' }} />
            <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Saved Reports' }} />
            <Stack.Screen
              name="ReportDetail"
              component={ReportDetailScreen}
              options={{ title: 'Report' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </ResultsProvider>
    </SafeAreaProvider>
  );
}
