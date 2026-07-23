import React from 'react';
import { View, Text, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSessionLock } from '@/lib/session-lock';
import { requireBiometricUnlock } from '@/lib/biometric-guard';
import { PremiumButton } from './PremiumButton';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';

/**
 * Full-screen gate shown when the interceptor detects an expired session. The
 * user must re-authenticate (biometric, falling back to device passcode) before
 * the app is usable again. A wipe (3 biometric failures) drops them to login.
 */
export function SessionExpiredOverlay() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const locked = useSessionLock((s) => s.locked);
  const unlock = useSessionLock((s) => s.unlock);

  const reauth = async () => {
    const result = await requireBiometricUnlock();
    // 'success' or 'unavailable' (no biometrics enrolled) both dismiss the gate;
    // 'wiped' clears the session and the AuthGate routes to login.
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
        <Ionicons name="lock-closed" size={56} color={BRAND_GRADIENT[0]} />
        <Text style={{ color: t.textPrimary, fontSize: 22, fontWeight: '800' }}>
          {tr('session.expiredTitle')}
        </Text>
        <Text style={{ color: t.textSecondary, textAlign: 'center' }}>
          {tr('session.expiredBody')}
        </Text>
        <PremiumButton
          label={tr('session.reauthenticate')}
          onPress={reauth}
          style={{ alignSelf: 'stretch' }}
        />
      </View>
    </Modal>
  );
}
