import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { PremiumButton } from '@/components/PremiumButton';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useAuthStore } from '@/store/auth.store';
import { createLocalUser } from '@/data/local/local-auth';
import { haptics } from '@/lib/haptics';

/** Offline entry — create a local profile or continue as guest. No network. */
export default function OfflineStart() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const setLocalSession = useAuthStore((s) => s.setLocalSession);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const enter = async (asGuest: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      void haptics.success();
      const user = await createLocalUser(asGuest ? '' : name, { isGuest: asGuest });
      setLocalSession(user);
      // AuthGate routes to the tabs once isLocal flips.
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 26 }}>
          <Animated.View entering={FadeInDown.springify().damping(16)} style={{ gap: 16 }}>
            <LinearGradient
              colors={BRAND_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="cube" size={32} color="#FFFFFF" />
            </LinearGradient>
            <View>
              <Text style={{ color: t.textPrimary, fontSize: 28, fontWeight: '800' }}>
                {tr('onboarding.startTitle')}
              </Text>
              <Text style={{ color: t.textSecondary, fontSize: 15, marginTop: 6 }}>
                {tr('onboarding.startSubtitle')}
              </Text>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(120).springify().damping(16)} style={{ gap: 14 }}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={tr('onboarding.yourName')}
              placeholderTextColor={t.textMuted}
              autoCapitalize="words"
              style={{
                color: t.textPrimary,
                backgroundColor: t.card,
                borderWidth: 1,
                borderColor: t.cardBorder,
                borderRadius: 18,
                paddingHorizontal: 16,
                paddingVertical: 16,
                fontSize: 16,
              }}
            />

            <PremiumButton
              label={tr('onboarding.startOffline')}
              onPress={() => void enter(false)}
              loading={busy}
              disabled={name.trim().length === 0}
              style={{ marginTop: 8 }}
            />

            <TouchableOpacity onPress={() => void enter(true)} style={{ paddingVertical: 14, alignItems: 'center' }}>
              <Text style={{ color: t.textMuted, fontSize: 14 }}>
                {tr('auth.continueAsGuest')}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  );
}
