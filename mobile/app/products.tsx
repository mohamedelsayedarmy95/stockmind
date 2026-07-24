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
import { useProducts } from '@/query/useProducts';
import { Product } from '@/api/types';

function ProductRow({ item, onPress }: { item: Product; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress}>
      <GlassCard style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <GradientIconCircle icon="cube" />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.textPrimary, fontWeight: '700', fontSize: 16 }} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
            {item.sku}
          </Text>
        </View>
        {item.costPrice != null ? (
          <Text style={{ color: t.textSecondary, fontWeight: '700', fontSize: 13 }}>
            {item.costPrice.toFixed(2)}
          </Text>
        ) : null}
        <Ionicons name="chevron-forward" size={20} color={t.textMuted} />
      </GlassCard>
    </Pressable>
  );
}

export default function ProductsScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const { data, isLoading } = useProducts();

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
          <Text style={{ color: t.textPrimary, fontSize: 22, fontWeight: '800', flex: 1 }}>
            {tr('products.title')}
          </Text>
          <Pressable
            onPress={() => router.push('/product/new')}
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
            <ProductRow item={item} onPress={() => router.push(`/product/${item.id}`)} />
          )}
          ListHeaderComponent={
            data && data.length > 0 ? (
              <View style={{ paddingBottom: 14 }}>
                <KpiCard
                  label={tr('products.total')}
                  value={String(data.length)}
                  accent={[BRAND_GRADIENT[0], BRAND_GRADIENT[0]]}
                />
              </View>
            ) : null
          }
          contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 10, flexGrow: 1 }}
          ListEmptyComponent={
            !isLoading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                <GradientIconCircle icon="cube-outline" size={72} iconSize={32} />
                <Text style={{ color: t.textPrimary, fontWeight: '700', fontSize: 16 }}>
                  {tr('products.emptyTitle')}
                </Text>
                <Text style={{ color: t.textMuted, textAlign: 'center', paddingHorizontal: 30 }}>
                  {tr('products.empty')}
                </Text>
              </View>
            ) : null
          }
        />
      </SafeAreaView>
    </ScreenBackground>
  );
}
