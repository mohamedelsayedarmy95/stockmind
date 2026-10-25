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
import { pendingEffects } from '@/domain/outbox';
import { warehouseListState } from '@/domain/balance-truth';
import { Product } from '@/api/types';
import { OutboxBanner } from '@/components/OutboxBanner';
import { useCurrentScopeKey } from '@/sync/account-scope';
import { useOutboxStore } from '@/sync/outbox-store';

/** Server decimals ("93.000000") shown without trailing zeros. */
const qty = (value: string) => String(Number(value));

const LIST_STATE_KEY: Partial<Record<ReturnType<typeof warehouseListState>, string>> = {
  loading: 'common.loading',
  unreachable: 'online.stockUnreachable',
  empty: 'online.stockEmpty',
  'empty-last-known': 'online.stockEmptyLastKnown',
};

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
  const scope = useCurrentScopeKey();
  const intents = useOutboxStore((s) => s.intents);
  // This account's not-yet-confirmed intents, per product: shown beside the server figure, never added into it.
  const effects = scope ? pendingEffects(intents, scope, warehouseId, entry?.sync.revision ?? null) : {};
  const signedQty = (q: number) => `${q > 0 ? '+' : ''}${q}`;
  const balances: ServerBalance[] = entry ? Object.values(entry.sync.balances) : [];
  const listState = warehouseListState(entry ? { ...entry.sync, lastError: entry.lastError, lastSuccessAt: entry.lastSuccessAt } : null);
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
      {entry && entry.sync.resets > 0 ? (
        <Text testID="sync-reset-notice" style={{ color: t.textMuted, fontSize: 12 }}>
          {tr('online.outbox.resetNotice')}
        </Text>
      ) : null}
      <OutboxBanner />

      {status?.reason === 'no-access' ? null : (
        <Text style={{ color: t.textSecondary, fontWeight: '700' }}>{tr('online.stockTitle')}</Text>
      )}
      {status?.reason === 'no-access' ? null : balances.length === 0 ? (
        // Series 13 / R-37: "loading" only while nothing failed, "unknown" when the first sync failed, "empty" only after the
        // server said so (and, when that was a while ago, said with the qualifier).
        <Text testID={`online-stock-${listState}`} style={{ color: listState === 'unreachable' ? STATUS.warning : t.textMuted }}>
          {tr(LIST_STATE_KEY[listState] ?? 'common.loading')}
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
            {effects[b.productId]?.pending ? (
              <Text testID={`pending-${b.productId}`} style={{ color: STATUS.warning, fontSize: 12, fontWeight: '700' }}>
                {tr('online.outbox.pendingLine', { qty: signedQty(effects[b.productId].pending) })}
              </Text>
            ) : null}
            {effects[b.productId]?.awaitingSync ? (
              <Text style={{ color: t.textMuted, fontSize: 12 }}>
                {tr('online.outbox.awaitingLine', { qty: signedQty(effects[b.productId].awaitingSync) })}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
              {action(tr('online.receive'), BRAND_GRADIENT[1], () => openMovement(b.productId, 'inbound'))}
              {action(tr('online.dispatch'), STATUS.warning, () => openMovement(b.productId, 'outbound'))}
            </View>
          </GlassCard>
        ))
      )}

      {recent.length > 0 && status?.reason !== 'no-access' ? (
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
