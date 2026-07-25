import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { PremiumButton } from '@/components/PremiumButton';
import { GradientIconCircle } from '@/components/GradientIconCircle';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useSettingsStore } from '@/store/settings.store';
import { haptics } from '@/lib/haptics';

const STEPS = [
  { key: 'warehouses', icon: 'business' },
  { key: 'products', icon: 'cube' },
  { key: 'batches', icon: 'time' },
  { key: 'offline', icon: 'airplane' },
] as const;

/**
 * Guided tour. Shown once on first launch (routed to by the onboarding gate)
 * and reopenable any time from Settings — the constitution asks for both.
 */
export default function HelpScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const markHelpSeen = useSettingsStore((s) => s.markHelpSeen);
  const [index, setIndex] = useState(0);

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  const finish = () => {
    void haptics.success();
    markHelpSeen();
    router.back();
  };

  const next = () => {
    void haptics.select();
    if (isLast) finish();
    else setIndex((i) => i + 1);
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, gap: 14 }}>
          <Pressable
            onPress={() => router.back()}
            accessibilityLabel={tr('help.skip')}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: t.card,
              borderWidth: 1,
              borderColor: t.cardBorder,
            }}
          >
            <Ionicons name="close" size={22} color={t.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.textPrimary, fontSize: 20, fontWeight: '800' }}>
              {tr('help.title')}
            </Text>
            <Text style={{ color: t.textMuted, fontSize: 12 }}>{tr('help.subtitle')}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30, gap: 20 }}>
          <GlassCard style={{ alignItems: 'center', gap: 16, paddingVertical: 32 }}>
            <GradientIconCircle icon={step.icon} size={84} iconSize={38} />
            <Text
              style={{
                color: t.textPrimary,
                fontSize: 19,
                fontWeight: '800',
                textAlign: 'center',
              }}
            >
              {tr(`help.steps.${step.key}Title`)}
            </Text>
            <Text
              style={{
                color: t.textMuted,
                fontSize: 14.5,
                lineHeight: 22,
                textAlign: 'center',
              }}
            >
              {tr(`help.steps.${step.key}Body`)}
            </Text>
          </GlassCard>

          {/* Progress dots double as direct jumps between steps. */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
            {STEPS.map((s, i) => (
              <Pressable
                key={s.key}
                onPress={() => {
                  void haptics.select();
                  setIndex(i);
                }}
                hitSlop={8}
                accessibilityLabel={tr(`help.steps.${s.key}Title`)}
                style={{
                  width: i === index ? 22 : 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: i === index ? BRAND_GRADIENT[0] : t.cardBorder,
                }}
              />
            ))}
          </View>

          <PremiumButton label={isLast ? tr('help.done') : tr('help.next')} onPress={next} />
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}
