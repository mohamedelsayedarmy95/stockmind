import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useSettingsStore, OperationMode } from '@/store/settings.store';
import { haptics } from '@/lib/haptics';

/** Operation-mode picker. Offline is production-ready; Online is deferred. */
export default function ModePicker() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const setOperationMode = useSettingsStore((s) => s.setOperationMode);

  const pick = (mode: OperationMode) => {
    void haptics.success();
    setOperationMode(mode);
  };

  const Card = ({
    mode,
    icon,
    title,
    sub,
    badge,
    disabled,
  }: {
    mode: OperationMode;
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    sub: string;
    badge: string;
    disabled?: boolean;
  }) => (
    <Pressable
      onPress={() => !disabled && pick(mode)}
      style={{
        backgroundColor: t.card,
        borderWidth: 1,
        borderColor: disabled ? t.cardBorder : BRAND_GRADIENT[1],
        borderRadius: 20,
        padding: 20,
        gap: 12,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: BRAND_GRADIENT[0],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={24} color="#FFFFFF" />
        </View>
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 10,
            backgroundColor: t.background,
            borderWidth: 1,
            borderColor: t.cardBorder,
          }}
        >
          <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: '700' }}>{badge}</Text>
        </View>
      </View>
      <Text style={{ color: t.textPrimary, fontSize: 18, fontWeight: '800' }}>{title}</Text>
      <Text style={{ color: t.textMuted, fontSize: 13, lineHeight: 20 }}>{sub}</Text>
    </Pressable>
  );

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 26 }}>
          <Animated.View entering={FadeInDown.springify().damping(16)}>
            <Text style={{ color: t.textPrimary, fontSize: 28, fontWeight: '800' }}>
              {tr('onboarding.modeTitle')}
            </Text>
            <Text style={{ color: t.textSecondary, fontSize: 15, marginTop: 6 }}>
              {tr('onboarding.modeSubtitle')}
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(120).springify().damping(16)} style={{ gap: 16 }}>
            <Card
              mode="offline"
              icon="phone-portrait"
              title={tr('onboarding.offlineTitle')}
              sub={tr('onboarding.offlineDesc')}
              badge={tr('onboarding.recommended')}
            />
            <Card
              mode="online"
              icon="cloud-outline"
              title={tr('onboarding.onlineTitle')}
              sub={tr('onboarding.onlineDesc')}
              badge={tr('onboarding.comingSoon')}
              disabled
            />
          </Animated.View>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  );
}
