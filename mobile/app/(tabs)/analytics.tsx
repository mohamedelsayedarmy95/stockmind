import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { KpiCard } from '@/components/KpiCard';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useProducts } from '@/query/useProducts';
import { useWarehouses } from '@/query/useWarehouses';

/**
 * Analytics are derived strictly from the account's real data. Rich historical
 * trend / per-warehouse density charts require a backend aggregation endpoint
 * (GET /analytics/overview) that does not exist yet — until it lands we show
 * honest real counts and an empty state, never fabricated demo series.
 */
export default function AnalyticsScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const { data: products, isLoading: productsLoading } = useProducts();
  const { data: warehouses, isLoading: warehousesLoading } = useWarehouses();

  const loading = productsLoading || warehousesLoading;
  const productCount = products?.length ?? 0;
  const warehouseCount = warehouses?.length ?? 0;
  const hasData = productCount > 0;

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 120, gap: 20 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={{ color: t.textPrimary, fontSize: 26, fontWeight: '800' }}>
            {tr('analytics.title')}
          </Text>

          {loading ? (
            <Text style={{ color: t.textMuted }}>{tr('common.loading')}</Text>
          ) : hasData ? (
            <>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <KpiCard
                  label={tr('analytics.totalProducts')}
                  value={String(productCount)}
                  accent={[BRAND_GRADIENT[0], BRAND_GRADIENT[0]]}
                  index={0}
                />
                <KpiCard
                  label={tr('analytics.warehouses')}
                  value={String(warehouseCount)}
                  accent={[BRAND_GRADIENT[1], BRAND_GRADIENT[1]]}
                  index={1}
                />
              </View>

              <GlassCard>
                <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 8 }}>
                  {tr('analytics.trendsTitle')}
                </Text>
                <Text style={{ color: t.textMuted, fontSize: 13, lineHeight: 20 }}>
                  {tr('analytics.trendsPending')}
                </Text>
              </GlassCard>
            </>
          ) : (
            <GlassCard>
              <View style={{ alignItems: 'center', paddingVertical: 28, gap: 12 }}>
                <View
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 32,
                    backgroundColor: t.card,
                    borderWidth: 1,
                    borderColor: t.cardBorder,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="bar-chart-outline" size={30} color={t.textMuted} />
                </View>
                <Text
                  style={{
                    color: t.textPrimary,
                    fontSize: 17,
                    fontWeight: '700',
                    textAlign: 'center',
                  }}
                >
                  {tr('analytics.emptyTitle')}
                </Text>
                <Text
                  style={{
                    color: t.textMuted,
                    fontSize: 14,
                    textAlign: 'center',
                    lineHeight: 21,
                    paddingHorizontal: 12,
                  }}
                >
                  {tr('analytics.emptyHint')}
                </Text>
              </View>
            </GlassCard>
          )}
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}
