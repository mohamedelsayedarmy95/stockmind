import React from 'react';
import { View, Text, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { SkiaLineChart } from '@/components/SkiaLineChart';
import { useTheme } from '@/theme/useTheme';
import { STATUS } from '@/theme/colors';

// Demo series until analytics endpoints land on the backend.
const TREND = [12, 18, 15, 22, 30, 26, 34, 40, 38, 46];
const HEATMAP = [
  { name: 'Main', density: 0.9 },
  { name: 'Cold', density: 0.55 },
  { name: 'North', density: 0.3 },
  { name: 'South', density: 0.15 },
];

function densityColor(d: number): string {
  if (d > 0.7) return STATUS.error;
  if (d > 0.4) return STATUS.warning;
  return '#38BDF8';
}

export default function AnalyticsScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const { width } = useWindowDimensions();
  const chartWidth = width - 40 - 40; // screen padding + card padding

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

          <GlassCard>
            <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 16 }}>
              {tr('analytics.stockTrend')}
            </Text>
            <SkiaLineChart data={TREND} width={chartWidth} height={180} />
          </GlassCard>

          <GlassCard>
            <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 16 }}>
              {tr('analytics.warehouseHeatmap')}
            </Text>
            <View style={{ gap: 12 }}>
              {HEATMAP.map((w) => (
                <View key={w.name} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: t.textPrimary }}>{w.name}</Text>
                    <Text style={{ color: t.textMuted }}>{Math.round(w.density * 100)}%</Text>
                  </View>
                  <View
                    style={{
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: t.card,
                      overflow: 'hidden',
                    }}
                  >
                    <View
                      style={{
                        width: `${w.density * 100}%`,
                        height: '100%',
                        borderRadius: 5,
                        backgroundColor: densityColor(w.density),
                      }}
                    />
                  </View>
                </View>
              ))}
            </View>
          </GlassCard>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}
