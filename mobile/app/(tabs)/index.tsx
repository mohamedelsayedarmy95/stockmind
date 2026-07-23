import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { KpiCard } from '@/components/KpiCard';
import { QuickAction } from '@/components/QuickAction';
import { AskMeFab } from '@/components/AskMeFab';
import { AskMeSheet } from '@/components/AskMeSheet';
import { GlassCard } from '@/components/GlassCard';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useAuthStore } from '@/store/auth.store';
import { useProducts } from '@/query/useProducts';
import { useEnsureDefaultWarehouse } from '@/query/useWarehouses';

export default function DashboardScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const company = useAuthStore((s) => s.company);
  const { data: products } = useProducts();
  useEnsureDefaultWarehouse();
  const [askOpen, setAskOpen] = useState(false);

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 140, gap: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: t.textMuted, fontSize: 14 }}>
                {tr('dashboard.greeting')}
              </Text>
              <Text style={{ color: t.textPrimary, fontSize: 24, fontWeight: '800' }}>
                {user?.name ?? company?.name ?? 'StockMind'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable
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
                <Ionicons name="notifications-outline" size={22} color={t.textPrimary} />
              </Pressable>
            </View>
          </View>

          {/* KPI row */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <KpiCard
              label={tr('dashboard.kpiTotalStock')}
              value={String(products?.length ?? '—')}
              accent={[BRAND_GRADIENT[0], BRAND_GRADIENT[0]]}
              index={0}
            />
            <KpiCard
              label={tr('dashboard.kpiStockValue')}
              value="—"
              accent={[BRAND_GRADIENT[1], BRAND_GRADIENT[1]]}
              index={1}
            />
          </View>
          <KpiCard label={tr('dashboard.kpiPendingOrders')} value="0" index={2} />

          {/* Quick actions */}
          <GlassCard>
            <Text
              style={{ color: t.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 18 }}
            >
              {tr('dashboard.quickActions')}
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              <QuickAction icon="scan" label={tr('dashboard.scan')} onPress={() => router.push('/(tabs)/scan')} />
              <QuickAction
                icon="arrow-down-circle"
                label={tr('dashboard.receive')}
                onPress={() => {
                  const first = products?.[0];
                  if (first) {
                    router.push({
                      pathname: '/movement/[productId]',
                      params: { productId: first.id, mode: 'inbound' },
                    });
                  }
                }}
              />
              <QuickAction
                icon="arrow-up-circle"
                label={tr('dashboard.dispatch')}
                onPress={() => {
                  const first = products?.[0];
                  if (first) {
                    router.push({
                      pathname: '/movement/[productId]',
                      params: { productId: first.id, mode: 'outbound' },
                    });
                  }
                }}
              />
            </View>
          </GlassCard>
        </ScrollView>

        <AskMeFab onPress={() => setAskOpen(true)} />
        <AskMeSheet visible={askOpen} onClose={() => setAskOpen(false)} />
      </SafeAreaView>
    </ScreenBackground>
  );
}
