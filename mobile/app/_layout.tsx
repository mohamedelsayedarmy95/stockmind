import '../global.css';
import '@/i18n';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from '@/query/queryClient';
import { useAuthStore } from '@/store/auth.store';
import { useIsDark } from '@/theme/useTheme';
import { bootstrapApp } from '@/lib/bootstrap';
import { biometricsAvailable, requireBiometricUnlock } from '@/lib/biometric-guard';
import { BiometricLockScreen } from '@/components/BiometricLockScreen';
import { SessionExpiredOverlay } from '@/components/SessionExpiredOverlay';

/** Redirects between the auth flow and the app based on session state. */
function AuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const accessToken = useAuthStore((s) => s.accessToken);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  useEffect(() => {
    if (!isHydrated) return;
    const inAuthGroup = segments[0] === '(auth)';

    if (!accessToken && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (accessToken && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [accessToken, isHydrated, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)/login" />
      <Stack.Screen
        name="movement/[productId]"
        options={{ presentation: 'card', animation: 'slide_from_right' }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const isDark = useIsDark();
  const [ready, setReady] = useState(false);
  const [needsUnlock, setNeedsUnlock] = useState(false);

  const attemptUnlock = useCallback(async () => {
    const result = await requireBiometricUnlock();
    // On success / no-biometrics / post-wipe we reveal the app (AuthGate will
    // route a wiped session back to login).
    if (result !== 'retry') setNeedsUnlock(false);
  }, []);

  useEffect(() => {
    (async () => {
      await bootstrapApp();

      // Demand a biometric unlock on cold start only when a session exists.
      const hasSession = Boolean(useAuthStore.getState().accessToken);
      if (hasSession && (await biometricsAvailable())) {
        setNeedsUnlock(true);
        setReady(true);
        await attemptUnlock();
      } else {
        setReady(true);
      }
    })();
  }, [attemptUnlock]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          {!ready ? (
            <View style={{ flex: 1, backgroundColor: isDark ? '#0A0E17' : '#F8FAFC' }} />
          ) : needsUnlock ? (
            <BiometricLockScreen onUnlock={attemptUnlock} />
          ) : (
            <>
              <AuthGate />
              <SessionExpiredOverlay />
            </>
          )}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
