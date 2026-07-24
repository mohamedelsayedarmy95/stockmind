import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable, Alert, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { PremiumButton } from '@/components/PremiumButton';
import { GradientIconCircle } from '@/components/GradientIconCircle';
import { WarehouseMapTile, TILE_SIZE } from '@/components/WarehouseMapTile';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useWarehouses } from '@/query/useWarehouses';
import { useStores, useCreateStore, useUpdateStorePosition } from '@/query/useStores';
import { Store, Warehouse } from '@/data/repositories';
import { haptics } from '@/lib/haptics';

const MAP_GAP = 16;
const MAP_HEIGHT = 420;

function StoreRow({ item }: { item: Store }) {
  const t = useTheme();
  return (
    <GlassCard style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <GradientIconCircle icon="layers" size={38} />
      <Text style={{ color: t.textPrimary, fontWeight: '700', flex: 1 }} numberOfLines={1}>
        {item.name}
      </Text>
      <Text style={{ color: t.textMuted, fontWeight: '600', fontSize: 13 }}>{item.totalQuantity}</Text>
    </GlassCard>
  );
}

type ViewMode = 'list' | 'map';

export default function WarehouseDetailScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const { warehouseId } = useLocalSearchParams<{ warehouseId: string }>();
  const { width: screenWidth } = useWindowDimensions();

  const { data: warehouses } = useWarehouses();
  const warehouse = warehouses?.find((w: Warehouse) => w.id === warehouseId);
  const { data: stores, isLoading } = useStores(warehouseId);
  const createStore = useCreateStore();
  const updatePosition = useUpdateStorePosition(warehouseId);

  const [storeName, setStoreName] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('map');

  const addStore = () => {
    if (!warehouseId || !storeName.trim()) return;
    createStore.mutate(
      { warehouseId, name: storeName.trim() },
      {
        onSuccess: () => {
          void haptics.success();
          setStoreName('');
        },
        onError: () => void haptics.error(),
      },
    );
  };

  const canvasWidth = screenWidth - 40;
  const cols = Math.max(1, Math.floor((canvasWidth + MAP_GAP) / (TILE_SIZE + MAP_GAP)));
  const defaultPos = (index: number) => ({
    x: (index % cols) * (TILE_SIZE + MAP_GAP),
    y: Math.floor(index / cols) * (TILE_SIZE + MAP_GAP),
  });

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
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <GradientIconCircle icon="business" size={40} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.textPrimary, fontSize: 18, fontWeight: '800' }} numberOfLines={1}>
                {warehouse?.name ?? '—'}
              </Text>
              <Text style={{ color: t.textMuted, fontSize: 12 }}>
                {tr('warehouse.sectionCount', { count: stores?.length ?? 0 })}
              </Text>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
          <GlassCard>
            <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 12 }}>
              {tr('warehouse.addSection')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextInput
                value={storeName}
                onChangeText={setStoreName}
                placeholder={tr('warehouse.storeNamePlaceholder')}
                placeholderTextColor={t.textMuted}
                style={{
                  flex: 1,
                  color: t.textPrimary,
                  backgroundColor: t.background,
                  borderWidth: 1,
                  borderColor: t.cardBorder,
                  borderRadius: 16,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  fontSize: 15,
                }}
              />
              <PremiumButton
                label={tr('common.save')}
                onPress={addStore}
                loading={createStore.isPending}
                disabled={storeName.trim().length === 0}
                style={{ paddingHorizontal: 20 }}
              />
            </View>
          </GlassCard>
        </View>

        <View style={{ flexDirection: 'row', paddingHorizontal: 20, marginBottom: 14, gap: 8 }}>
          {(['map', 'list'] as ViewMode[]).map((mode) => {
            const selected = mode === viewMode;
            return (
              <Pressable
                key={mode}
                onPress={() => {
                  void haptics.select();
                  setViewMode(mode);
                }}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 14,
                  alignItems: 'center',
                  backgroundColor: selected ? BRAND_GRADIENT[1] : t.card,
                  borderWidth: 1,
                  borderColor: selected ? BRAND_GRADIENT[1] : t.cardBorder,
                }}
              >
                <Text style={{ color: selected ? '#FFFFFF' : t.textSecondary, fontWeight: '700' }}>
                  {tr(mode === 'map' ? 'warehouse.mapView' : 'warehouse.listView')}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {!stores || stores.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
            {!isLoading ? (
              <>
                <GradientIconCircle icon="layers-outline" size={64} iconSize={28} />
                <Text style={{ color: t.textMuted, textAlign: 'center', paddingHorizontal: 20 }}>
                  {tr('warehouse.storesEmpty')}
                </Text>
              </>
            ) : null}
          </View>
        ) : viewMode === 'map' ? (
          <View
            style={{
              marginHorizontal: 20,
              height: MAP_HEIGHT,
              borderRadius: 24,
              backgroundColor: t.card,
              borderWidth: 1,
              borderColor: t.cardBorder,
              overflow: 'hidden',
            }}
          >
            {stores.map((store: Store, index: number) => {
              const fallback = defaultPos(index);
              return (
                <WarehouseMapTile
                  key={store.id}
                  name={store.name}
                  totalQuantity={store.totalQuantity}
                  x={store.posX ?? fallback.x}
                  y={store.posY ?? fallback.y}
                  bounds={{ width: canvasWidth, height: MAP_HEIGHT }}
                  onPress={() => {
                    Alert.alert(store.name, tr('warehouse.mapTileDetail', { count: store.totalQuantity }));
                  }}
                  onMoved={(x, y) => {
                    void haptics.select();
                    updatePosition.mutate({ storeId: store.id, x, y });
                  }}
                />
              );
            })}
          </View>
        ) : (
          <FlatList
            data={stores}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <StoreRow item={item} />}
            contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 10 }}
          />
        )}
      </SafeAreaView>
    </ScreenBackground>
  );
}
