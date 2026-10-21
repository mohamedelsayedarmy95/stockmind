import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT, STATUS } from '@/theme/colors';
import { useProducts } from '@/query/useProducts';
import { useWarehouses } from '@/query/useWarehouses';
import { Product } from '@/api/types';
import { Warehouse } from '@/data/repositories';
import { canDiscard, IntentState, receiptDisplay, reentryDraft, retryNow, StockIntent } from '@/domain/outbox';
import { useCurrentScopeKey } from '@/sync/account-scope';
import { removeIntent, updateIntent, useOutboxStore } from '@/sync/outbox-store';
import { wakeOutbox } from '@/sync/outbox-drain';
import { haptics } from '@/lib/haptics';

const STATE_COLOR: Record<IntentState, string> = {
  PENDING: STATUS.warning,
  SENDING: '#2E7DFF',
  CONFIRMED: STATUS.success,
  REJECTED: STATUS.error,
  NEEDS_REVIEW: STATUS.error,
};

/**
 * The signed-in account's queued stock intents. Each shows what it is, its state and why; the actions offered are
 * only the safe ones: retry unchanged (same key, same payload) when nothing can have been recorded, and discard when
 * the intent cannot have been recorded or its outcome is already known.
 */
export default function OutboxScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const scope = useCurrentScopeKey();
  const intents = useOutboxStore((s) => s.intents);
  const { data: products } = useProducts();
  const { data: warehouses } = useWarehouses();

  const names = useMemo(
    () => new Map<string, string>([
      ...(products ?? []).map((p: Product) => [p.id, p.name] as const),
      ...(warehouses ?? []).map((w: Warehouse) => [w.id, w.name] as const),
    ]),
    [products, warehouses],
  );
  const mine = intents.filter((i) => i.scope === scope).sort((a, b) => b.seq - a.seq);
  const open = mine.filter((i) => i.state !== 'CONFIRMED');
  const recent = mine.filter((i) => i.state === 'CONFIRMED').slice(0, 10);

  const retry = (intent: StockIntent) => {
    void haptics.select();
    updateIntent(intent.id, (i) => retryNow(i, Date.now()));
    void wakeOutbox();
  };
  const discard = (intent: StockIntent) =>
    Alert.alert(tr('online.outbox.discardTitle'), tr('online.outbox.discardBody'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('online.outbox.discard'),
        style: 'destructive',
        onPress: () => {
          void haptics.warning();
          removeIntent(intent.id);
        },
      },
    ]);

  /** Opens the dispatch/receive screen prefilled; the user confirms a NEW action (new key, noted as a re-entry). */
  const reenter = (intent: StockIntent) => {
    const draft = reentryDraft(intent);
    if (!draft) return;
    void haptics.select();
    router.push({
      pathname: '/movement/[productId]',
      params: {
        productId: draft.payload.productId,
        mode: draft.kind,
        warehouseId: draft.payload.warehouseId,
        qty: draft.payload.quantity,
        reentryOf: intent.id,
      },
    });
  };

  const Row = ({ intent }: { intent: StockIntent }) => {
    const receipt = intent.state === 'CONFIRMED' ? receiptDisplay(intent) : null;
    const color = receipt && receipt !== 'confirmed' ? STATUS.warning : STATE_COLOR[intent.state];
    const sign = intent.kind === 'outbound' ? '−' : '+';
    const reason = intent.lastError?.reason;
    const unknownOutcome = intent.state === 'NEEDS_REVIEW' && reason === 'no-access';
    const historyChanged = intent.state === 'NEEDS_REVIEW' && reason === 'history-changed';
    const stateText =
      receipt === 'rechecking'
        ? tr('online.outbox.receipt.rechecking')
        : receipt === 'unverifiable'
          ? tr('online.outbox.receipt.unverifiable', {
              reason: tr(`online.outbox.unverifiable.${intent.verification?.reason ?? 'unknown'}`, {
                defaultValue: intent.verification?.reason ?? '',
              }),
            })
          : receipt === 'confirmed' && intent.verification?.state === 'verified'
            ? tr('online.outbox.receipt.verified', { time: new Date(intent.verification.at).toLocaleTimeString() })
            : `${tr(`online.outbox.state.${intent.state}`)}${
                reason && intent.state !== 'CONFIRMED' ? ` · ${tr(`online.outbox.reason.${reason}`)}` : ''
              }`;
    return (
      <GlassCard style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: t.textPrimary, fontWeight: '700', flex: 1 }} numberOfLines={1}>
            {tr(intent.kind === 'outbound' ? 'online.dispatch' : 'online.receive')} ·{' '}
            {names.get(intent.payload.productId) ?? intent.payload.productId.slice(0, 8)}
          </Text>
          <Text style={{ color: intent.kind === 'outbound' ? STATUS.warning : STATUS.success, fontWeight: '800' }}>
            {sign}
            {String(Number(intent.payload.quantity))}
          </Text>
        </View>
        <Text style={{ color: t.textMuted, fontSize: 12 }}>
          {names.get(intent.payload.warehouseId) ?? intent.payload.warehouseId.slice(0, 8)} ·{' '}
          {new Date(intent.createdAt).toLocaleString()}
        </Text>
        <Text testID={`intent-state-${intent.state}`} style={{ color, fontWeight: '700', fontSize: 13 }}>
          {stateText}
        </Text>
        {intent.maybeCommitted && intent.state === 'PENDING' ? (
          <Text style={{ color: t.textMuted, fontSize: 12 }}>{tr('online.outbox.maybeRecorded')}</Text>
        ) : null}
        {unknownOutcome ? <Text style={{ color: t.textMuted, fontSize: 12 }}>{tr('online.outbox.unknownOutcome')}</Text> : null}
        {historyChanged && intent.result ? (
          <Text testID="history-changed-provenance" style={{ color: t.textMuted, fontSize: 12 }}>
            {tr('online.outbox.receipt.lastKnown', {
              time: new Date(intent.result.at).toLocaleString(),
              movement: intent.result.movementId.slice(0, 8),
              revision: intent.result.revision ?? '—',
            })}{' '}
            {tr('online.outbox.notResent')}
          </Text>
        ) : null}
        {intent.state !== 'CONFIRMED' ? (
          <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {historyChanged ? (
              <Pressable onPress={() => reenter(intent)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: BRAND_GRADIENT[1] }}>
                <Text style={{ color: BRAND_GRADIENT[1], fontWeight: '700', fontSize: 13 }}>{tr('online.outbox.reenter')}</Text>
              </Pressable>
            ) : null}
            {retryNow(intent, Date.now()) ? (
              <Pressable onPress={() => retry(intent)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: BRAND_GRADIENT[1] }}>
                <Text style={{ color: BRAND_GRADIENT[1], fontWeight: '700', fontSize: 13 }}>{tr('online.outbox.retry')}</Text>
              </Pressable>
            ) : null}
            {canDiscard(intent) ? (
              <Pressable onPress={() => discard(intent)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: STATUS.error }}>
                <Text style={{ color: STATUS.error, fontWeight: '700', fontSize: 13 }}>
                  {tr(historyChanged ? 'online.outbox.acknowledge' : 'online.outbox.discard')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </GlassCard>
    );
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, gap: 12 }}>
          <Pressable
            onPress={() => router.back()}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder }}
          >
            <Ionicons name="chevron-back" size={22} color={t.textPrimary} />
          </Pressable>
          <Text style={{ color: t.textPrimary, fontSize: 20, fontWeight: '800' }}>{tr('online.outbox.title')}</Text>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 12 }}>
          <Text style={{ color: t.textSecondary }}>{tr('online.outbox.subtitle')}</Text>
          {open.length === 0 ? <Text style={{ color: t.textMuted }}>{tr('online.outbox.empty')}</Text> : null}
          {open.map((i) => (
            <Row key={i.id} intent={i} />
          ))}
          {recent.length > 0 ? (
            <Text style={{ color: t.textSecondary, fontWeight: '700', marginTop: 8 }}>{tr('online.outbox.recent')}</Text>
          ) : null}
          {recent.map((i) => (
            <Row key={i.id} intent={i} />
          ))}
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}
