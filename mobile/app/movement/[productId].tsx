import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { PremiumButton } from '@/components/PremiumButton';
import { QuantitySlider } from '@/components/QuantitySlider';
import { ChipPicker, ChipOption } from '@/components/ChipPicker';
import { Confetti } from '@/components/Confetti';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT, STATUS } from '@/theme/colors';
import { useProducts } from '@/query/useProducts';
import { Product } from '@/api/types';
import { useBalance, useStockMovement, useAvailability, MovementKind } from '@/query/useStock';
import { useStores } from '@/query/useStores';
import { useStorageUnits } from '@/query/useStorageUnits';
import { useBatches } from '@/query/useBatches';
import { Store, StorageUnit, Batch, PickStrategy, PICK_STRATEGIES } from '@/data/repositories';
import { quantityFromWeight, weightCountDrift, WEIGHT_DRIFT_TOLERANCE } from '@/domain/inventory-math';
import { useAuthStore } from '@/store/auth.store';
import { haptics } from '@/lib/haptics';

export default function MovementScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ productId: string; mode?: string }>();
  const kind: MovementKind = params.mode === 'inbound' ? 'inbound' : 'outbound';

  const warehouseId = useAuthStore((s) => s.defaultWarehouseId);
  const { data: products } = useProducts();
  const product = products?.find((p: Product) => p.id === params.productId);
  const { data: balance } = useBalance(params.productId, warehouseId ?? undefined);
  const { data: availability } = useAvailability(params.productId, warehouseId ?? undefined);
  const { data: stores } = useStores(warehouseId ?? undefined);
  const movement = useStockMovement();

  const [qty, setQty] = useState(1);
  const [confetti, setConfetti] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | undefined>();
  const [storageUnitId, setStorageUnitId] = useState<string | undefined>();
  const [batchCode, setBatchCode] = useState('');
  const [expiryText, setExpiryText] = useState('');
  const [strategy, setStrategy] = useState<PickStrategy>('fefo');
  const [weightText, setWeightText] = useState('');
  const [serialText, setSerialText] = useState('');

  const { data: units } = useStorageUnits(storeId);
  const { data: batches } = useBatches(params.productId, warehouseId ?? undefined);

  // Outbound may only consume what isn't already promised to someone else.
  const onHand = balance ? Math.floor(Number(balance.baseQuantity)) : 0;
  const issuable = availability ? Math.floor(availability.available) : onHand;
  const sliderMax = kind === 'outbound' ? Math.max(issuable, 1) : 500;

  const weightCount = useMemo(() => {
    const parsed = Number(weightText.trim());
    if (!weightText.trim() || !Number.isFinite(parsed)) return null;
    return quantityFromWeight(parsed, product?.unitWeightKg);
  }, [weightText, product?.unitWeightKg]);

  const weightDrifts = weightCount != null && weightCountDrift(weightCount) > WEIGHT_DRIFT_TOLERANCE;

  const storeOptions: ChipOption<string>[] = (stores ?? []).map((s: Store) => ({
    key: s.id,
    label: s.name,
  }));
  const unitOptions: ChipOption<string>[] = (units ?? []).map((u: StorageUnit) => ({
    key: u.id,
    label: `${'· '.repeat(u.depth)}${u.name}`,
    hint: tr(`storageUnit.type.${u.unitType}`),
  }));
  const lotsWithStock = (batches ?? []).filter((b: Batch) => b.quantity > 0);

  const field = {
    color: t.textPrimary,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
  } as const;

  const applyWeight = () => {
    if (!weightCount) return;
    void haptics.select();
    setQty(Math.max(1, weightCount.rounded));
  };

  const submit = () => {
    if (!warehouseId || !product) return;
    setErrorMsg(null);

    const serials = serialText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    // Expiry is optional; accept YYYY-MM-DD and ignore anything unparseable.
    const parsedExpiry = expiryText.trim() ? Date.parse(expiryText.trim()) : NaN;

    movement.mutate(
      {
        kind,
        productId: product.id,
        warehouseId,
        quantity: String(qty),
        storeId,
        storageUnitId,
        batchCode: kind === 'inbound' && batchCode.trim() ? batchCode.trim() : undefined,
        expiryDate: Number.isFinite(parsedExpiry) ? parsedExpiry : null,
        pickStrategy: kind === 'outbound' ? strategy : undefined,
        serialNumbers: serials.length > 0 ? serials : undefined,
      },
      {
        onSuccess: () => {
          void haptics.heavy();
          void haptics.success();
          setConfetti((c) => c + 1);
          setTimeout(() => router.back(), 1500);
        },
        onError: (err) => {
          void haptics.error();
          const message = err instanceof Error ? err.message : '';
          if (message === 'INSUFFICIENT_STOCK') setErrorMsg(tr('movement.insufficient'));
          else if (message === 'RESERVED_STOCK') setErrorMsg(tr('movement.reservedBlocked'));
          else setErrorMsg(tr('common.error'));
        },
      },
    );
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <Confetti trigger={confetti} />

        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, gap: 12 }}>
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
          <Text style={{ color: t.textPrimary, fontSize: 20, fontWeight: '800' }}>
            {kind === 'inbound' ? tr('movement.inbound') : tr('movement.outbound')}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 18 }}
          keyboardShouldPersistTaps="handled"
        >
          <GlassCard>
            <View style={{ alignItems: 'center', gap: 8 }}>
              <View
                style={{
                  width: 76,
                  height: 76,
                  borderRadius: 24,
                  backgroundColor: BRAND_GRADIENT[0] + '22',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="cube" size={36} color={BRAND_GRADIENT[0]} />
              </View>
              <Text style={{ color: t.textPrimary, fontSize: 18, fontWeight: '700' }}>
                {product?.name ?? '—'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <Text style={{ color: t.textMuted, fontSize: 13 }}>
                  {tr('common.currentBalance')}: {onHand}
                </Text>
                {availability && availability.reserved > 0 ? (
                  <Text style={{ color: STATUS.warning, fontSize: 13, fontWeight: '600' }}>
                    {tr('movement.reserved')}: {Math.floor(availability.reserved)}
                  </Text>
                ) : null}
              </View>
              {kind === 'outbound' && availability && availability.reserved > 0 ? (
                <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '700' }}>
                  {tr('movement.issuable')}: {issuable}
                </Text>
              ) : null}
            </View>
          </GlassCard>

          {storeOptions.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: t.textSecondary, fontWeight: '600' }}>{tr('movement.section')}</Text>
              <ChipPicker
                options={storeOptions}
                value={storeId}
                clearable
                onSelect={(v) => {
                  setStoreId(v);
                  setStorageUnitId(undefined);
                }}
              />
            </View>
          ) : null}

          {storeId && unitOptions.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: t.textSecondary, fontWeight: '600' }}>
                {tr('storageUnit.pickLabel')}
              </Text>
              <ChipPicker
                options={unitOptions}
                value={storageUnitId}
                clearable
                size="sm"
                onSelect={setStorageUnitId}
              />
            </View>
          ) : null}

          {kind === 'inbound' ? (
            <GlassCard>
              <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 4 }}>
                {tr('batch.title')}
              </Text>
              <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 12 }}>
                {tr('batch.hint')}
              </Text>
              <View style={{ gap: 10 }}>
                <TextInput
                  value={batchCode}
                  onChangeText={setBatchCode}
                  placeholder={tr('batch.codePlaceholder')}
                  placeholderTextColor={t.textMuted}
                  autoCapitalize="characters"
                  style={field}
                />
                <TextInput
                  value={expiryText}
                  onChangeText={setExpiryText}
                  placeholder={tr('batch.expiryPlaceholder')}
                  placeholderTextColor={t.textMuted}
                  keyboardType="numbers-and-punctuation"
                  style={field}
                />
              </View>
            </GlassCard>
          ) : (
            <GlassCard>
              <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 4 }}>
                {tr('strategy.title')}
              </Text>
              <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 12 }}>
                {tr(`strategy.desc.${strategy}`)}
              </Text>
              <ChipPicker
                options={PICK_STRATEGIES.map((s) => ({ key: s, label: tr(`strategy.${s}`) }))}
                value={strategy}
                onSelect={(v) => v && setStrategy(v)}
              />
              {lotsWithStock.length > 0 ? (
                <View style={{ marginTop: 14, gap: 6 }}>
                  <Text style={{ color: t.textMuted, fontSize: 12 }}>{tr('batch.available')}</Text>
                  {lotsWithStock.slice(0, 4).map((b: Batch) => (
                    <View
                      key={b.id}
                      style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                    >
                      <Text style={{ color: t.textPrimary, fontSize: 13, fontWeight: '600' }}>
                        {b.batchCode}
                      </Text>
                      <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        {b.expiryDate ? new Date(b.expiryDate).toLocaleDateString() : '—'} ·{' '}
                        {b.quantity}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </GlassCard>
          )}

          {product?.unitWeightKg ? (
            <GlassCard>
              <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 4 }}>
                {tr('weight.title')}
              </Text>
              <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 12 }}>
                {tr('weight.unitIs', { weight: product.unitWeightKg })}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput
                  value={weightText}
                  onChangeText={setWeightText}
                  placeholder={tr('weight.placeholder')}
                  placeholderTextColor={t.textMuted}
                  keyboardType="decimal-pad"
                  style={[field, { flex: 1 }]}
                />
                <PremiumButton
                  label={tr('weight.apply')}
                  onPress={applyWeight}
                  disabled={weightCount == null}
                  style={{ paddingHorizontal: 18 }}
                />
              </View>
              {weightCount ? (
                <Text
                  style={{
                    color: weightDrifts ? STATUS.warning : t.textMuted,
                    fontSize: 12,
                    marginTop: 10,
                  }}
                >
                  {weightDrifts
                    ? tr('weight.drift', { exact: weightCount.exact.toFixed(2), rounded: weightCount.rounded })
                    : tr('weight.computed', { count: weightCount.rounded })}
                </Text>
              ) : null}
            </GlassCard>
          ) : null}

          <View style={{ alignItems: 'center', gap: 14 }}>
            <Text style={{ color: t.textSecondary, fontWeight: '600' }}>
              {tr('movement.quantity')}
            </Text>
            <QuantitySlider value={qty} max={sliderMax} onChange={setQty} width={width - 56} />
          </View>

          <GlassCard>
            <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 4 }}>
              {tr('serial.title')}
            </Text>
            <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 12 }}>
              {tr('serial.hint')}
            </Text>
            <TextInput
              value={serialText}
              onChangeText={setSerialText}
              placeholder={tr('serial.placeholder')}
              placeholderTextColor={t.textMuted}
              multiline
              autoCapitalize="characters"
              style={[field, { minHeight: 72, textAlignVertical: 'top' }]}
            />
          </GlassCard>

          {errorMsg ? (
            <Text style={{ color: STATUS.error, textAlign: 'center', fontWeight: '600' }}>
              {errorMsg}
            </Text>
          ) : null}

          <PremiumButton
            label={kind === 'inbound' ? tr('movement.confirmInbound') : tr('movement.confirmOutbound')}
            onPress={submit}
            loading={movement.isPending}
            disabled={qty < 1 || !warehouseId}
          />
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}
