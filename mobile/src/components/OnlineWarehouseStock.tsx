import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@/components/GlassCard';
import { SyncStatusPill } from '@/components/SyncStatusPill';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT, STATUS } from '@/theme/colors';
import { useProducts } from '@/query/useProducts';
import { useAuthStore } from '@/store/auth.store';
import { dismissRejection, useWarehouseSync } from '@/sync/warehouse-sync';
import { ServerBalance } from '@/domain/stock-sync';
import { Product } from '@/api/types';

/** Server decimals ("93.000000") shown without trailing zeros. */
const qty = (value: string) => String(Number(value));

/**
 * Online stock of one warehouse, straight from the reconciled sync state: the balances are the server's, replaced on
 * every poll, never summed on the device.
 */
export function OnlineWarehouseStock({ warehouseId }: { warehouseId: string }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);
  const { data: products } = useProducts();
  const { entry, status, refresh } = useWarehouseSync(warehouseId, true);

  const names = useMemo(
    () => new Map<string, string>((products ?? []).map((p: Product) => [p.id, p.name] as const)),
    [products],
  );
  const balances: ServerBalance[] = entry ? Object.values(entry.sync.balances) : [];
  balances.sort((a, b) => (names.get(a.productId) ?? a.productId).localeCompare(names.get(b.productId) ?? b.productId));
  const recent = entry ? [...entry.sync.recent].reverse().slice(0, 6) : [];

  const openMovement = (productId: string, mode: 'inbound' | 'outbound') =>
    router.push({ pathname: '/movement/[productId]', params: { productId, mode, warehouseId } });

  const action = (label: string, color: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: color }}
    >
      <Text style={{ color, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 14 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} />}
    >
      {entry && status ? (
        <SyncStatusPill status={status} entry={entry} onDismiss={() => dismissRejection(warehouseId)} />
      ) : null}

      <Text style={{ color: t.textSecondary, fontWeight: '700' }}>{tr('online.stockTitle')}</Text>
      {balances.length === 0 ? (
        <Text style={{ color: t.textMuted }}>
          {entry?.sync.revision === null ? tr('common.loading') : tr('online.stockEmpty')}
        </Text>
      ) : (
        balances.map((b) => (
          <GlassCard key={b.productId} style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ color: t.textPrimary, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                {names.get(b.productId) ?? b.productId.slice(0, 8)}
              </Text>
              <Text testID={`balance-${b.productId}`} style={{ color: t.textPrimary, fontSize: 20, fontWeight: '800' }}>
                {qty(b.baseQuantity)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
              {action(tr('online.receive'), BRAND_GRADIENT[1], () => openMovement(b.productId, 'inbound'))}
              {action(tr('online.dispatch'), STATUS.warning, () => openMovement(b.productId, 'outbound'))}
            </View>
          </GlassCard>
        ))
      )}

      {recent.length > 0 ? (
        <GlassCard style={{ gap: 8 }}>
          <Text style={{ color: t.textSecondary, fontWeight: '700' }}>{tr('online.recentTitle')}</Text>
          {recent.map((m) => (
            <View key={m.id} style={{ gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: t.textPrimary, fontSize: 13, flex: 1 }} numberOfLines={1}>
                  {tr(`online.movementType.${m.movementType}`, { defaultValue: m.movementType })} ·{' '}
                  {names.get(m.productId) ?? m.productId.slice(0, 8)}
                </Text>
                <Text
                  style={{
                    color: Number(m.quantityChange) < 0 ? STATUS.warning : STATUS.success,
                    fontWeight: '700',
                    fontSize: 13,
                  }}
                >
                  {Number(m.quantityChange) > 0 ? '+' : ''}
                  {qty(m.quantityChange)}
                </Text>
              </View>
              <Text style={{ color: t.textMuted, fontSize: 12 }}>
                {m.userId === userId ? tr('online.byYou') : tr('online.byTeammate')} ·{' '}
                {new Date(m.createdAt).toLocaleTimeString()}
              </Text>
            </View>
          ))}
        </GlassCard>
      ) : null}
    </ScrollView>
  );
}
