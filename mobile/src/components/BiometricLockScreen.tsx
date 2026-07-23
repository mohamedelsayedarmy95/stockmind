import React from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { PremiumButton } from './PremiumButton';
import { ScreenBackground } from './ScreenBackground';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';

/** Cold-start lock: the user must pass biometrics before the app is revealed. */
export function BiometricLockScreen({ onUnlock }: { onUnlock: () => void }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <ScreenBackground>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 }}>
        <Ionicons name="finger-print" size={64} color={BRAND_GRADIENT[0]} />
        <Text style={{ color: t.textPrimary, fontSize: 24, fontWeight: '800' }}>
          {tr('session.unlockTitle')}
        </Text>
        <Text style={{ color: t.textSecondary, textAlign: 'center' }}>
          {tr('session.unlockBody')}
        </Text>
        <PremiumButton label={tr('session.unlock')} onPress={onUnlock} style={{ alignSelf: 'stretch' }} />
      </View>
    </ScreenBackground>
  );
}
