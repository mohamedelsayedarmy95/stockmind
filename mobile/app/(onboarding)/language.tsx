import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useSettingsStore, AppLanguage } from '@/store/settings.store';
import { haptics } from '@/lib/haptics';

/** First-launch language picker — shown before anything else. */
export default function LanguagePicker() {
  const t = useTheme();
  const chooseLanguage = useSettingsStore((s) => s.chooseLanguage);

  const pick = (lang: AppLanguage) => {
    void haptics.success();
    chooseLanguage(lang);
    // AuthGate reacts to languageChosen and routes to the mode picker.
  };

  const Option = ({ lang, label, sub }: { lang: AppLanguage; label: string; sub: string }) => (
    <Pressable
      onPress={() => pick(lang)}
      style={{
        backgroundColor: t.card,
        borderWidth: 1,
        borderColor: t.cardBorder,
        borderRadius: 20,
        paddingVertical: 22,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <View>
        <Text style={{ color: t.textPrimary, fontSize: 20, fontWeight: '800' }}>{label}</Text>
        <Text style={{ color: t.textMuted, fontSize: 13, marginTop: 4 }}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={t.textMuted} />
    </Pressable>
  );

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 28 }}>
          <Animated.View entering={FadeInDown.springify().damping(16)} style={{ gap: 16 }}>
            <LinearGradient
              colors={BRAND_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="language" size={32} color="#FFFFFF" />
            </LinearGradient>
            <View>
              <Text style={{ color: t.textPrimary, fontSize: 28, fontWeight: '800' }}>
                Choose your language
              </Text>
              <Text style={{ color: t.textSecondary, fontSize: 15, marginTop: 6 }}>
                اختر لغتك
              </Text>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(120).springify().damping(16)} style={{ gap: 14 }}>
            <Option lang="ar" label="العربية" sub="اللغة العربية" />
            <Option lang="en" label="English" sub="English language" />
          </Animated.View>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  );
}
