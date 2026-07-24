import React from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { KpiCard } from '@/components/KpiCard';
import { GradientIconCircle } from '@/components/GradientIconCircle';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useWarehouses } from '@/query/useWarehouses';
import { useStores } from '@/query/useStores';
import { Warehouse } from '@/data/repositories';

function WarehouseRow({ item, onPress }: { item: Warehouse; onPress: () => void }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const { data: stores } = useStores(item.id);

  return (
    <Pressable onPress={onPress}>
      <GlassCard style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <GradientIconCircle icon="business" />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.textPrimary, fontWeight: '700', fontSize: 16 }} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>
            {tr('warehouse.sectionCount', { count: stores?.length ?? 0 })}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={t.textMuted} />
      </GlassCard>
    </Pressable>
  );
}

export default function WarehousesScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const { data, isLoading } = useWarehouses();

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 4, gap: 14 }}>
          <Text style={{ color: t.textPrimary, fontSize: 26, fontWeight: '800', flex: 1 }}>
            {tr('warehouses.title')}
          </Text>
          <Pressable
            onPress={() => router.push('/warehouse/new')}
            accessibilityLabel={tr('warehouse.addTitle')}
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
            <Ionicons name="add" size={22} color={t.textPrimary} />
          </Pressable>
        </View>

        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <WarehouseRow item={item} onPress={() => router.push(`/warehouse/${item.id}`)} />
          )}
          ListHeaderComponent={
            data && data.length > 0 ? (
              <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 }}>
                <KpiCard
                  label={tr('warehouses.total')}
                  value={String(data.length)}
                  accent={[BRAND_GRADIENT[0], BRAND_GRADIENT[0]]}
                />
              </View>
            ) : null
          }
          contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: 100, gap: 10, flexGrow: 1 }}
          ListEmptyComponent={
            !isLoading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                <GradientIconCircle icon="business-outline" size={72} iconSize={32} />
                <Text style={{ color: t.textPrimary, fontWeight: '700', fontSize: 16 }}>
                  {tr('warehouses.emptyTitle')}
                </Text>
                <Text style={{ color: t.textMuted, textAlign: 'center', paddingHorizontal: 30 }}>
                  {tr('warehouses.empty')}
                </Text>
              </View>
            ) : null
          }
        />
      </SafeAreaView>
    </ScreenBackground>
  );
}
