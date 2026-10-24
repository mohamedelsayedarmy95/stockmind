import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { PremiumButton } from '@/components/PremiumButton';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT, STATUS } from '@/theme/colors';
import { useProducts } from '@/query/useProducts';
import { useWarehouses } from '@/query/useWarehouses';
import { Product } from '@/api/types';
import { Warehouse } from '@/data/repositories';
import { canDiscard } from '@/domain/outbox';
import { canRetryReplacement, REVIEW_TTL_MS, replacementAvailability } from '@/domain/replacement';
import { useCurrentScopeKey } from '@/sync/account-scope';
import { removeIntent, useOutboxStore } from '@/sync/outbox-store';
import { useWarehouseSyncStore } from '@/sync/warehouse-sync';
import { checkOriginal, confirmReplacement, sendReplacement, useReviewStore } from '@/sync/outbox-replacement';
import { haptics } from '@/lib/haptics';

const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : '—');

/**
 * Review of an operation the server's history lost, and the only place it can be replaced.
 * The screen asks the server first (read-only), shows the device's old receipt apart from the server's authoritative
 * stock, says plainly whether replacement is available, blocked or needs the manager, and sends nothing without the
 * person's explicit confirmation. The SERVER makes the final, atomic decision; this screen never decides by itself.
 */
export default function OutboxReviewScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const scope = useCurrentScopeKey();
  const intent = useOutboxStore((s) => s.intents.find((i) => i.id === id));
  const review = useReviewStore((s) => (id ? s.entries[id] : undefined));
  const { data: products } = useProducts();
  const { data: warehouses } = useWarehouses();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const tapped = useRef(false);

  const mine = intent && intent.scope === scope ? intent : null;
  const lost = mine?.state === 'NEEDS_REVIEW' && mine.lastError?.reason === 'history-changed';

  // Ask the server when the screen opens (and whenever the person asks again). Nothing is concluded from silence.
  useEffect(() => {
    if (id && lost) void checkOriginal(id);
  }, [id, lost]);
  // A check ages: the confirm button must not stay enabled on an old answer.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  const productName = useMemo(
    () => (products ?? []).find((p: Product) => p.id === mine?.payload.productId)?.name ?? short(mine?.payload.productId),
    [products, mine?.payload.productId],
  );
  const warehouseName = useMemo(
    () => (warehouses ?? []).find((w: Warehouse) => w.id === mine?.payload.warehouseId)?.name ?? short(mine?.payload.warehouseId),
    [warehouses, mine?.payload.warehouseId],
  );
  const syncEntry = useWarehouseSyncStore((s) => (mine ? s.entries[mine.payload.warehouseId] : undefined));
  const serverStock = mine ? syncEntry?.sync.balances[mine.payload.productId]?.baseQuantity : undefined;

  const confirm = useCallback(() => {
    if (!mine || tapped.current) return;
    const sign = mine.kind === 'outbound' ? '−' : '+';
    Alert.alert(
      tr('online.outbox.reviewFlow.confirmTitle'),
      tr('online.outbox.reviewFlow.confirmBody', {
        kind: tr(`online.outbox.reviewFlow.kind.${mine.kind}`),
        sign,
        qty: String(Number(mine.payload.quantity)),
        product: productName,
        warehouse: warehouseName,
      }),
      [
        { text: tr('common.cancel'), style: 'cancel' },
        {
          text: tr('online.outbox.reviewFlow.confirmYes'),
          style: 'destructive',
          onPress: async () => {
            // One tap, one decision: a second tap while this runs is ignored (and the key is kept on disk anyway).
            if (tapped.current) return;
            tapped.current = true;
            setBusy(true);
            try {
              void haptics.heavy();
              await confirmReplacement(mine.id);
            } finally {
              tapped.current = false;
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [mine, productName, warehouseName, tr]);

  const retry = useCallback(async () => {
    if (!mine || tapped.current) return;
    tapped.current = true;
    setBusy(true);
    try {
      void haptics.select();
      await sendReplacement(mine.id);
    } finally {
      tapped.current = false;
      setBusy(false);
    }
  }, [mine]);

  const dismiss = () => {
    if (!mine) return;
    void haptics.warning();
    removeIntent(mine.id);
    router.back();
  };

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, gap: 12 }}>
      <Pressable
        onPress={() => router.back()}
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder }}
      >
        <Ionicons name="chevron-back" size={22} color={t.textPrimary} />
      </Pressable>
      <Text style={{ color: t.textPrimary, fontSize: 20, fontWeight: '800', flex: 1 }}>{tr('online.outbox.reviewFlow.title')}</Text>
    </View>
  );

  if (!mine) {
    return (
      <ScreenBackground>
        <SafeAreaView style={{ flex: 1 }}>
          {header}
          <Text testID="review-missing" style={{ color: t.textMuted, paddingHorizontal: 20 }}>{tr('online.outbox.empty')}</Text>
        </SafeAreaView>
      </ScreenBackground>
    );
  }

  const sign = mine.kind === 'outbound' ? '−' : '+';
  const qty = String(Number(mine.payload.quantity));
  const snapshot = review?.snapshot ?? null;
  const availability = replacementAvailability(mine, review?.phase === 'ready' ? snapshot : null, now);
  const attempt = mine.replacement;
  const risk = mine.replacedRisk;
  const row = (label: string, value: string, testID?: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: t.textMuted, fontSize: 13 }}>{label}</Text>
      <Text testID={testID} style={{ color: t.textPrimary, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
  const receipt = mine.result;

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        {header}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 14 }}>
          <Text style={{ color: t.textSecondary }}>{tr('online.outbox.reviewFlow.whatHappened')}</Text>

          <GlassCard style={{ gap: 6 }}>
            <Text style={{ color: t.textPrimary, fontWeight: '800' }}>{tr('online.outbox.reviewFlow.receiptTitle')}</Text>
            <Text style={{ color: t.textMuted, fontSize: 12 }}>{tr('online.outbox.reviewFlow.receiptNote')}</Text>
            {row(tr('online.outbox.reviewFlow.kind.' + mine.kind), `${sign}${qty}`, 'receipt-quantity')}
            {row(tr('online.outbox.reviewFlow.product'), productName)}
            {row(tr('online.outbox.reviewFlow.warehouse'), warehouseName)}
            {receipt ? row(tr('online.outbox.reviewFlow.confirmedAt'), new Date(receipt.at).toLocaleString()) : null}
            {receipt ? row(tr('online.outbox.reviewFlow.movement'), short(receipt.movementId)) : null}
            {receipt?.revision ? row(tr('online.outbox.reviewFlow.revision'), receipt.revision) : null}
            {receipt?.generation ? row(tr('online.outbox.reviewFlow.generation'), short(receipt.generation)) : null}
          </GlassCard>

          <GlassCard style={{ gap: 6 }}>
            <Text style={{ color: t.textPrimary, fontWeight: '800' }}>{tr('online.outbox.reviewFlow.stockTitle')}</Text>
            <Text testID="server-stock" style={{ color: t.textPrimary, fontSize: 22, fontWeight: '800' }}>
              {serverStock !== undefined ? String(Number(serverStock)) : '—'}
            </Text>
            <Text style={{ color: t.textMuted, fontSize: 12 }}>
              {serverStock !== undefined ? tr('online.outbox.reviewFlow.stockNote') : tr('online.outbox.reviewFlow.stockNone')}
            </Text>
          </GlassCard>

          {lost || review ? (
            <GlassCard style={{ gap: 8 }}>
              <Text style={{ color: t.textPrimary, fontWeight: '800' }}>{tr('online.outbox.reviewFlow.serverCheck')}</Text>
              {review?.phase === 'checking' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator color={BRAND_GRADIENT[1]} />
                  <Text testID="review-checking" style={{ color: t.textSecondary }}>{tr('online.outbox.reviewFlow.checking')}</Text>
                </View>
              ) : null}
              {review?.phase === 'failed' && review.failure ? (
                <Text testID="review-failure" style={{ color: STATUS.warning, fontWeight: '600' }}>
                  {tr(`online.outbox.reviewFlow.failure.${review.failure}`)}
                </Text>
              ) : null}
              {snapshot && review?.phase === 'ready' ? (
                <>
                  <Text testID={`review-status-${snapshot.reason === 'superseded' ? 'superseded' : snapshot.status}`} style={{ color: t.textPrimary, fontWeight: '700' }}>
                    {tr(`online.outbox.reviewFlow.status.${snapshot.reason === 'superseded' ? 'superseded' : snapshot.status}`)}
                  </Text>
                  <Text style={{ color: t.textMuted, fontSize: 12 }}>
                    {tr('online.outbox.reviewFlow.checkedAt', {
                      time: new Date(snapshot.checkedAt).toLocaleTimeString(),
                      generation: short(snapshot.generation),
                    })}
                  </Text>
                </>
              ) : null}
              <Pressable
                testID="review-check-again"
                disabled={review?.phase === 'checking' || busy}
                onPress={() => id && void checkOriginal(id)}
                style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: BRAND_GRADIENT[1], opacity: review?.phase === 'checking' || busy ? 0.5 : 1 }}
              >
                <Text style={{ color: BRAND_GRADIENT[1], fontWeight: '700', fontSize: 13 }}>{tr('online.outbox.reviewFlow.checkAgain')}</Text>
              </Pressable>
            </GlassCard>
          ) : null}

          {mine.state === 'CONFIRMED' ? (
            <Text testID="review-original-back" style={{ color: STATUS.success, fontWeight: '700' }}>
              {tr('online.outbox.reviewFlow.why.original-present')}
            </Text>
          ) : null}

          {mine.replacementBlock ? (
            <Text testID="review-blocked" style={{ color: STATUS.warning, fontWeight: '600' }}>
              {tr(`online.outbox.reviewFlow.blocked.${mine.replacementBlock.code}`)}
            </Text>
          ) : null}

          {mine.state === 'REPLACED' ? (
            <GlassCard style={{ gap: 6 }}>
              <Text testID="review-replaced" style={{ color: risk ? STATUS.error : STATUS.success, fontWeight: '800' }}>
                {tr('online.outbox.reviewFlow.doneTitle')}
              </Text>
              <Text style={{ color: t.textSecondary }}>{tr('online.outbox.reviewFlow.doneBody')}</Text>
              {mine.replacement?.result ? (
                <Text testID="replaced-provenance" style={{ color: t.textMuted, fontSize: 12 }}>
                  {tr('online.outbox.replaced.provenance', {
                    original: short(mine.id),
                    replacement: short(mine.replacement.result.movementId),
                  })}
                </Text>
              ) : null}
              {risk ? <Text testID={`review-risk-${risk}`} style={{ color: STATUS.error, fontWeight: '700' }}>{tr(`online.outbox.reviewFlow.risk.${risk}`)}</Text> : null}
            </GlassCard>
          ) : null}

          {attempt && mine.state !== 'REPLACED' ? (
            <GlassCard style={{ gap: 8 }}>
              <Text testID={`replacement-${attempt.state}`} style={{ color: t.textPrimary, fontWeight: '800' }}>
                {tr(`online.outbox.replacement.state.${attempt.state}`)}
              </Text>
              <Text style={{ color: t.textSecondary }}>
                {tr(attempt.state === 'SENDING' ? 'online.outbox.reviewFlow.sendingNote' : attempt.state === 'UNKNOWN' ? 'online.outbox.reviewFlow.unknownNote' : 'online.outbox.reviewFlow.readyNote')}
              </Text>
              {canRetryReplacement(mine) ? (
                <>
                  <PremiumButton testID="review-retry" label={tr('online.outbox.reviewFlow.retrySame')} onPress={retry} loading={busy} />
                  <Text style={{ color: t.textMuted, fontSize: 12 }}>{tr('online.outbox.reviewFlow.retryNote')}</Text>
                </>
              ) : null}
            </GlassCard>
          ) : null}

          {lost && !attempt ? (
            <GlassCard style={{ gap: 10 }}>
              <Text style={{ color: t.textPrimary, fontWeight: '800' }}>{tr('online.outbox.reviewFlow.decideTitle')}</Text>
              {availability.available ? (
                <>
                  <Text testID="review-warning" style={{ color: STATUS.warning, fontWeight: '600' }}>
                    {tr('online.outbox.reviewFlow.replaceWarning', { sign, qty })}
                  </Text>
                  <PremiumButton testID="review-replace" label={tr('online.outbox.reviewFlow.replaceButton')} onPress={confirm} loading={busy} disabled={busy} />
                  <Text style={{ color: t.textMuted, fontSize: 12 }}>
                    {tr('online.outbox.reviewFlow.checkedAt', {
                      time: snapshot ? new Date(snapshot.checkedAt).toLocaleTimeString() : '—',
                      generation: short(snapshot?.generation),
                    })}
                    {' · '}
                    {Math.round(REVIEW_TTL_MS / 60000)} min
                  </Text>
                </>
              ) : (
                <Text testID={`review-why-${availability.reason}`} style={{ color: t.textSecondary }}>
                  {tr(`online.outbox.reviewFlow.why.${availability.reason}`)}
                </Text>
              )}
            </GlassCard>
          ) : null}

          {canDiscard(mine) && (lost || mine.state === 'REPLACED') && !attempt ? (
            <View style={{ gap: 4 }}>
              <Pressable
                testID="review-dismiss"
                onPress={dismiss}
                style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: STATUS.error }}
              >
                <Text style={{ color: STATUS.error, fontWeight: '700', fontSize: 13 }}>{tr('online.outbox.reviewFlow.acknowledge')}</Text>
              </Pressable>
              <Text style={{ color: t.textMuted, fontSize: 12 }}>{tr('online.outbox.reviewFlow.acknowledgeNote')}</Text>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}
