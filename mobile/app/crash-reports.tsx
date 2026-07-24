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
import { useCrashLog } from '@/query/useCrashLog';
import { CrashEntry } from '@/lib/crash-reporting';

function CrashRow({ item }: { item: CrashEntry }) {
  const t = useTheme();
  return (
    <GlassCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: item.stack ? 8 : 0 }}>
        <Ionicons
          name={item.fatal ? 'skull-outline' : 'warning-outline'}
          size={18}
          color={item.fatal ? '#EF4444' : '#F59E0B'}
        />
        <Text style={{ color: t.textPrimary, fontWeight: '700', flex: 1 }} numberOfLines={2}>
          {item.message}
        </Text>
      </View>
      <Text style={{ color: t.textMuted, fontSize: 11 }}>{new Date(item.createdAt).toLocaleString()}</Text>
      {item.stack ? (
        <Text style={{ color: t.textMuted, fontSize: 10, marginTop: 6 }} numberOfLines={4}>
          {item.stack}
        </Text>
      ) : null}
    </GlassCard>
  );
}

export default function CrashReportsScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const { data, isLoading } = useCrashLog();

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
            {tr('crashLog.title')}
          </Text>
        </View>

        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <CrashRow item={item} />}
          contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 10, flexGrow: 1 }}
          ListEmptyComponent={
            !isLoading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                <GradientIconCircle icon="shield-checkmark-outline" size={72} iconSize={32} />
                <Text style={{ color: t.textPrimary, fontWeight: '700', fontSize: 16 }}>
                  {tr('crashLog.emptyTitle')}
                </Text>
                <Text style={{ color: t.textMuted, textAlign: 'center', paddingHorizontal: 30 }}>
                  {tr('crashLog.empty')}
                </Text>
              </View>
            ) : null
          }
        />
      </SafeAreaView>
    </ScreenBackground>
  );
}
