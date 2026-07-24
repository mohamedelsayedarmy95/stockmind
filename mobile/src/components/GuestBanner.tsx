import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';

export function GuestBanner() {
  const isGuest = useAuthStore((s) => s.isGuest);
  const clear = useAuthStore((s) => s.clear);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  if (!isGuest) return null;

  return (
    <View
      style={{
        backgroundColor: '#1E3A5F',
        paddingTop: insets.top + 8,
        paddingBottom: 10,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Text style={{ color: '#93C5FD', fontSize: 13, flex: 1 }}>
        You're browsing as a guest — data won't be saved.
      </Text>
      <TouchableOpacity
        onPress={() => { clear(); router.replace('/(auth)/login'); }}
        style={{
          backgroundColor: '#2E7DFF',
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 6,
          marginLeft: 10,
        }}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>
          Sign In
        </Text>
      </TouchableOpacity>
    </View>
  );
}
