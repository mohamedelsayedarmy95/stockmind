import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { PremiumButton } from '@/components/PremiumButton';
import { GradientIconCircle } from '@/components/GradientIconCircle';
import { ChipPicker, ChipOption } from '@/components/ChipPicker';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useStores } from '@/query/useStores';
import { useStorageUnits, useCreateStorageUnit, useRemoveStorageUnit } from '@/query/useStorageUnits';
import { Store, StorageUnit, StorageUnitType, STORAGE_UNIT_TYPES } from '@/data/repositories';
import { haptics } from '@/lib/haptics';

const TYPE_ICONS: Record<StorageUnitType, keyof typeof Ionicons.glyphMap> = {
  pallet: 'albums',
  rack: 'grid',
  shelf: 'reorder-four',
  bin: 'file-tray',
  carton: 'cube',
  unit: 'ellipse',
};

export default function StoreDetailScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ storeId: string; warehouseId?: string }>();
  const storeId = params.storeId;
  const warehouseId = params.warehouseId ?? '';

  const { data: stores } = useStores(warehouseId || undefined);
  const store = stores?.find((s: Store) => s.id === storeId);
  const { data: units, isLoading } = useStorageUnits(storeId);
  const createUnit = useCreateStorageUnit(storeId);
  const removeUnit = useRemoveStorageUnit(storeId);

  const [name, setName] = useState('');
  const [unitType, setUnitType] = useState<StorageUnitType>('pallet');
  const [parentId, setParentId] = useState<string | undefined>();

  const parentOptions: ChipOption<string>[] = [
    { key: '', label: tr('storageUnit.root') },
    ...(units ?? []).map((u: StorageUnit) => ({
      key: u.id,
      label: u.name,
      hint: tr(`storageUnit.type.${u.unitType}`),
    })),
  ];

  const field = {
    flex: 1,
    color: t.textPrimary,
    backgroundColor: t.background,
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
  } as const;

  const addUnit = () => {
    if (!name.trim() || !warehouseId) return;
    createUnit.mutate(
      {
        warehouseId,
        storeId,
        parentId: parentId || null,
        name: name.trim(),
        unitType,
      },
      {
        onSuccess: () => {
          void haptics.success();
          setName('');
          setParentId(undefined);
        },
        onError: () => void haptics.error(),
      },
    );
  };

  const confirmRemove = (unit: StorageUnit) => {
    Alert.alert(tr('storageUnit.removeTitle'), tr('storageUnit.removeConfirm'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('common.confirm'),
        style: 'destructive',
        onPress: () => {
          void haptics.warning();
          removeUnit.mutate(unit.id);
        },
      },
    ]);
  };

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
            <GradientIconCircle icon="layers" size={40} />
            <View style={{ flex: 1 }}>
              <Text
                style={{ color: t.textPrimary, fontSize: 18, fontWeight: '800' }}
                numberOfLines={1}
              >
                {store?.name ?? '—'}
              </Text>
              <Text style={{ color: t.textMuted, fontSize: 12 }}>
                {tr('storageUnit.title')} · {units?.length ?? 0}
              </Text>
            </View>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <GlassCard>
            <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 4 }}>
              {tr('storageUnit.addTitle')}
            </Text>
            <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 14 }}>
              {tr('storageUnit.hint')}
            </Text>

            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder={tr('storageUnit.namePlaceholder')}
                  placeholderTextColor={t.textMuted}
                  style={field}
                />
              </View>

              <ChipPicker
                options={STORAGE_UNIT_TYPES.map((ty) => ({
                  key: ty,
                  label: tr(`storageUnit.type.${ty}`),
                }))}
                value={unitType}
                onSelect={(v) => v && setUnitType(v)}
                size="sm"
              />

              <Text style={{ color: t.textMuted, fontSize: 12 }}>
                {tr('storageUnit.parentLabel')}
              </Text>
              <ChipPicker
                options={parentOptions}
                value={parentId ?? ''}
                onSelect={(v) => setParentId(v || undefined)}
                size="sm"
              />

              <PremiumButton
                label={tr('common.save')}
                onPress={addUnit}
                loading={createUnit.isPending}
                disabled={name.trim().length === 0}
              />
            </View>
          </GlassCard>

          {units && units.length > 0 ? (
            <View style={{ gap: 8 }}>
              {units.map((u: StorageUnit) => (
                <Pressable key={u.id} onLongPress={() => confirmRemove(u)}>
                  <GlassCard
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      marginStart: u.depth * 18,
                    }}
                  >
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: BRAND_GRADIENT[0] + '1F',
                      }}
                    >
                      <Ionicons name={TYPE_ICONS[u.unitType]} size={17} color={BRAND_GRADIENT[0]} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.textPrimary, fontWeight: '700' }} numberOfLines={1}>
                        {u.name}
                      </Text>
                      <Text style={{ color: t.textMuted, fontSize: 11 }}>
                        {tr(`storageUnit.type.${u.unitType}`)}
                      </Text>
                    </View>
                    <Text style={{ color: t.textSecondary, fontWeight: '700', fontSize: 13 }}>
                      {u.totalQuantity}
                    </Text>
                  </GlassCard>
                </Pressable>
              ))}
            </View>
          ) : !isLoading ? (
            <View style={{ alignItems: 'center', gap: 14, paddingVertical: 40 }}>
              <GradientIconCircle icon="albums-outline" size={64} iconSize={28} />
              <Text style={{ color: t.textMuted, textAlign: 'center', paddingHorizontal: 20 }}>
                {tr('storageUnit.empty')}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}
