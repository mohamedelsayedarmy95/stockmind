import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { PremiumButton } from '@/components/PremiumButton';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useSettingsStore, AppLanguage, AppThemeMode } from '@/store/settings.store';
import { changeLanguage } from '@/i18n';
import { useAuthStore } from '@/store/auth.store';
import { useLogout, useTerminateAllSessions } from '@/query/useAuth';
import { haptics } from '@/lib/haptics';

function SegmentedRow<T extends string>({
  options,
  value,
  onSelect,
}: {
  options: { key: T; label: string }[];
  value: T;
  onSelect: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {options.map((opt) => {
        const selected = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => {
              void haptics.select();
              onSelect(opt.key);
            }}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 14,
              alignItems: 'center',
              backgroundColor: selected ? BRAND_GRADIENT[1] : t.card,
              borderWidth: 1,
              borderColor: selected ? BRAND_GRADIENT[1] : t.cardBorder,
            }}
          >
            <Text
              style={{
                color: selected ? '#FFFFFF' : t.textSecondary,
                fontWeight: '600',
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function SettingsScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const terminateAll = useTerminateAllSessions();

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 120, gap: 20 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={{ color: t.textPrimary, fontSize: 26, fontWeight: '800' }}>
            {tr('settings.title')}
          </Text>

          <GlassCard>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor: BRAND_GRADIENT[0],
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="person" size={24} color="#FFFFFF" />
              </View>
              <View>
                <Text style={{ color: t.textPrimary, fontSize: 16, fontWeight: '700' }}>
                  {user?.name ?? '—'}
                </Text>
                <Text style={{ color: t.textMuted }}>{user?.email ?? ''}</Text>
              </View>
            </View>
          </GlassCard>

          <GlassCard>
            <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 14 }}>
              {tr('settings.language')}
            </Text>
            <SegmentedRow<AppLanguage>
              options={[
                { key: 'en', label: 'English' },
                { key: 'ar', label: 'العربية' },
              ]}
              value={language}
              onSelect={changeLanguage}
            />
          </GlassCard>

          <GlassCard>
            <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 14 }}>
              {tr('settings.theme')}
            </Text>
            <SegmentedRow<AppThemeMode>
              options={[
                { key: 'dark', label: tr('settings.themeDark') },
                { key: 'light', label: tr('settings.themeLight') },
                { key: 'system', label: tr('settings.themeSystem') },
              ]}
              value={themeMode}
              onSelect={setThemeMode}
            />
          </GlassCard>

          <GlassCard>
            <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 6 }}>
              {tr('settings.security')}
            </Text>
            <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 14 }}>
              {tr('settings.terminateAllHint')}
            </Text>
            <PremiumButton
              label={tr('settings.terminateAll')}
              variant="ghost"
              loading={terminateAll.isPending}
              onPress={() => {
                void haptics.warning();
                terminateAll.mutate();
              }}
            />
          </GlassCard>

          <PremiumButton
            label={tr('settings.signOut')}
            variant="ghost"
            onPress={() => logout.mutate()}
          />
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}
