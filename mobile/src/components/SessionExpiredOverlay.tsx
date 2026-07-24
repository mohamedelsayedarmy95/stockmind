import React from 'react';
import { View, Text, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionLock } from '@/lib/session-lock';
import { requireBiometricUnlock } from '@/lib/biometric-guard';
import { useAuthStore } from '@/store/auth.store';
import { PremiumButton } from './PremiumButton';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';

/**
 * Full-screen gate shown when the interceptor detects an expired session. The
 * user must re-authenticate (biometric, falling back to device passcode) before
 * the app is usable again. A wipe (3 biometric failures) drops them to login.
 *
 * For guest users (no tokens), the gate is bypassed — just unlock and route
 * to login so they can sign in properly.
 */
export function SessionExpiredOverlay() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const locked = useSessionLock((s) => s.locked);
  const unlock = useSessionLock((s) => s.unlock);
  const isGuest = useAuthStore((s) => s.isGuest);
  const accessToken = useAuthStore((s) => s.accessToken);
  const clear = useAuthStore((s) => s.clear);

  const isGuestLock = isGuest || !accessToken;

  const handlePress = async () => {
    if (isGuestLock) {
      clear();
      unlock();
      router.replace('/(auth)/login');
      return;
    }
    const result = await requireBiometricUnlock();
    if (result === 'success' || result === 'unavailable' || result === 'wiped') {
      unlock();
    }
  };

  return (
    <Modal visible={locked} transparent animationType="fade">
      <View
        style={{
          flex: 1,
          backgroundColor: t.background,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          gap: 20,
        }}
      >
        <Ionicons
          name={isGuestLock ? 'person-circle-outline' : 'lock-closed'}
          size={56}
          color={BRAND_GRADIENT[0]}
        />
        <Text style={{ color: t.textPrimary, fontSize: 22, fontWeight: '800' }}>
          {isGuestLock ? 'Sign in to continue' : tr('session.expiredTitle')}
        </Text>
        <Text style={{ color: t.textSecondary, textAlign: 'center' }}>
          {isGuestLock
            ? 'Create an account or sign in to access this feature.'
            : tr('session.expiredBody')}
        </Text>
        <PremiumButton
          label={isGuestLock ? 'Sign In' : tr('session.reauthenticate')}
          onPress={handlePress}
          style={{ alignSelf: 'stretch' }}
        />
      </View>
    </Modal>
  );
}
