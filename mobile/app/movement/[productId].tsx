import React, { useState } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { AxiosError } from 'axios';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { PremiumButton } from '@/components/PremiumButton';
import { QuantitySlider } from '@/components/QuantitySlider';
import { Confetti } from '@/components/Confetti';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useProducts } from '@/query/useProducts';
import { Product } from '@/api/types';
import { useBalance, useStockMovement, MovementKind } from '@/query/useStock';
import { useStores } from '@/query/useStores';
import { Store } from '@/data/repositories';
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
  const { data: stores } = useStores(warehouseId ?? undefined);
  const movement = useStockMovement();

  const [qty, setQty] = useState(1);
  const [confetti, setConfetti] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | undefined>();

  const available = balance ? Math.floor(Number(balance.baseQuantity)) : 100;
  const sliderMax = kind === 'outbound' ? Math.max(available, 1) : 500;

  const submit = () => {
    if (!warehouseId || !product) return;
    setErrorMsg(null);
    movement.mutate(
      { kind, productId: product.id, warehouseId, quantity: String(qty), storeId },
      {
        onSuccess: () => {
          void haptics.heavy();
          void haptics.success();
          setConfetti((c) => c + 1);
          setTimeout(() => router.back(), 1500);
        },
        onError: (err) => {
          void haptics.error();
          const status = (err as AxiosError)?.response?.status;
          setErrorMsg(status === 409 ? tr('movement.insufficient') : tr('common.error'));
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
              width: 42,
              height: 42,
              borderRadius: 21,
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

        <View style={{ flex: 1, paddingHorizontal: 20, gap: 24 }}>
          <GlassCard>
            <View style={{ alignItems: 'center', gap: 10 }}>
              <View
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 28,
                  backgroundColor: BRAND_GRADIENT[0] + '22',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="cube" size={44} color={BRAND_GRADIENT[0]} />
              </View>
              <Text style={{ color: t.textPrimary, fontSize: 20, fontWeight: '700' }}>
                {product?.name ?? '—'}
              </Text>
              <Text style={{ color: t.textMuted }}>
                {tr('common.currentBalance')}: {available}
              </Text>
            </View>
          </GlassCard>

          {stores && stores.length > 0 ? (
            <View style={{ gap: 10 }}>
              <Text style={{ color: t.textSecondary, fontWeight: '600' }}>
                {tr('movement.section')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {stores.map((s: Store) => {
                  const selected = s.id === storeId;
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => {
                        void haptics.select();
                        setStoreId(selected ? undefined : s.id);
                      }}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: 14,
                        backgroundColor: selected ? BRAND_GRADIENT[0] : t.card,
                        borderWidth: 1,
                        borderColor: selected ? BRAND_GRADIENT[0] : t.cardBorder,
                      }}
                    >
                      <Text style={{ color: selected ? '#FFFFFF' : t.textSecondary, fontWeight: '600' }}>
                        {s.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={{ alignItems: 'center', gap: 16 }}>
            <Text style={{ color: t.textSecondary, fontWeight: '600' }}>
              {tr('movement.quantity')}
            </Text>
            <QuantitySlider
              value={qty}
              max={sliderMax}
              onChange={setQty}
              width={width - 56}
            />
          </View>

          {errorMsg ? (
            <Text style={{ color: '#EF4444', textAlign: 'center', fontWeight: '600' }}>
              {errorMsg}
            </Text>
          ) : null}
        </View>

        <View style={{ padding: 20 }}>
          <PremiumButton
            label={
              kind === 'inbound' ? tr('movement.confirmInbound') : tr('movement.confirmOutbound')
            }
            onPress={submit}
            loading={movement.isPending}
            disabled={qty < 1 || !warehouseId}
          />
        </View>
      </SafeAreaView>
    </ScreenBackground>
  );
}
