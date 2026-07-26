import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { PremiumButton } from './PremiumButton';
import { ScreenBackground } from './ScreenBackground';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT, STATUS } from '@/theme/colors';
import { remainingLockMs } from '@/lib/biometric-guard';
import { formatCountdown } from '@/domain/lockout-policy';

/** Cold-start lock: the user must pass biometrics before the app is revealed. */
export function BiometricLockScreen({ onUnlock }: { onUnlock: () => void }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [remaining, setRemaining] = useState(() => remainingLockMs());

  // Tick only while a lockout is actually being served.
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => setRemaining(remainingLockMs()), 1000);
    return () => clearInterval(timer);
  }, [remaining]);

  const locked = remaining > 0;

  return (
    <ScreenBackground>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 }}>
        <Ionicons
          name={locked ? 'lock-closed' : 'finger-print'}
          size={64}
          color={locked ? STATUS.warning : BRAND_GRADIENT[0]}
        />
        <Text style={{ color: t.textPrimary, fontSize: 24, fontWeight: '800', textAlign: 'center' }}>
          {locked ? tr('session.lockedTitle') : tr('session.unlockTitle')}
        </Text>
        <Text style={{ color: t.textSecondary, textAlign: 'center' }}>
          {locked ? tr('session.lockedBody') : tr('session.unlockBody')}
        </Text>

        {locked ? (
          <Text
            style={{
              color: STATUS.warning,
              fontSize: 34,
              fontWeight: '800',
              fontVariant: ['tabular-nums'],
            }}
          >
            {formatCountdown(remaining)}
          </Text>
        ) : null}

        <PremiumButton
          label={tr('session.unlock')}
          onPress={onUnlock}
          disabled={locked}
          style={{ alignSelf: 'stretch' }}
        />
      </View>
    </ScreenBackground>
  );
}
