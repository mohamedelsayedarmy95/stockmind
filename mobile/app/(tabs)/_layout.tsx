import React from 'react';
import { View, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { GuestBanner } from '@/components/GuestBanner';

export default function TabsLayout() {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <View style={{ flex: 1 }}>
      <GuestBanner />
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: BRAND_GRADIENT[0],
        tabBarInactiveTintColor: t.textMuted,
        tabBarStyle: {
          position: 'absolute',
          borderTopWidth: 0,
          backgroundColor: t.mode === 'dark' ? 'transparent' : t.background,
          elevation: 0,
          height: 84,
          paddingTop: 8,
        },
        tabBarBackground:
          t.mode === 'dark' && Platform.OS !== 'web'
            ? () => (
                <BlurView
                  intensity={60}
                  tint="dark"
                  style={{ flex: 1, borderTopWidth: 1, borderTopColor: t.cardBorder }}
                />
              )
            : undefined,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: tr('dashboard.greeting'),
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: tr('scan.title'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="scan" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: tr('analytics.title'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="stats-chart" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: tr('settings.title'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
    </View>
  );
}
