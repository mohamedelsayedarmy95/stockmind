import React from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { GradientIconCircle } from '@/components/GradientIconCircle';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT, STATUS } from '@/theme/colors';
import { useActivity } from '@/query/useActivity';
import { ActivityEntry } from '@/api/types';

const ACTION_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  create: { icon: 'add-circle', color: STATUS.success },
  update: { icon: 'create', color: BRAND_GRADIENT[0] },
  delete: { icon: 'trash', color: STATUS.error },
  inbound: { icon: 'arrow-down-circle', color: STATUS.success },
  outbound: { icon: 'arrow-up-circle', color: STATUS.warning },
  transfer: { icon: 'swap-horizontal', color: BRAND_GRADIENT[1] },
};
const DEFAULT_META = { icon: 'ellipse' as const, color: '#94A3B8' };

function ActivityRow({ item }: { item: ActivityEntry }) {
  const t = useTheme();
  const meta = ACTION_META[item.action] ?? DEFAULT_META;
  const date = new Date(item.createdAt);

  return (
    <GlassCard style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 21,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: meta.color + '1F',
        }}
      >
        <Ionicons name={meta.icon} size={22} color={meta.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.textPrimary, fontWeight: '700' }}>
          {item.detail ?? `${item.action} ${item.entity}`}
        </Text>
        <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>
          {date.toLocaleString()}
        </Text>
      </View>
    </GlassCard>
  );
}

export default function ActivityScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const { data, isLoading } = useActivity();

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, gap: 14 }}>
          <Pressable
            onPress={() => router.back()}
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
            <Ionicons name="chevron-back" size={22} color={t.textPrimary} />
          </Pressable>
          <Text style={{ color: t.textPrimary, fontSize: 22, fontWeight: '800' }}>
            {tr('activity.title')}
          </Text>
        </View>

        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ActivityRow item={item} />}
          contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 10, flexGrow: 1 }}
          ListEmptyComponent={
            !isLoading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                <GradientIconCircle icon="time-outline" size={72} iconSize={32} />
                <Text style={{ color: t.textPrimary, fontWeight: '700', fontSize: 16 }}>
                  {tr('activity.emptyTitle')}
                </Text>
                <Text style={{ color: t.textMuted, textAlign: 'center', paddingHorizontal: 30 }}>
                  {tr('activity.empty')}
                </Text>
              </View>
            ) : null
          }
        />
      </SafeAreaView>
    </ScreenBackground>
  );
}
