import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { PremiumButton } from '@/components/PremiumButton';
import { QuantitySlider } from '@/components/QuantitySlider';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useProducts, useUpdateProduct, useDeleteProduct } from '@/query/useProducts';
import { useWarehouses } from '@/query/useWarehouses';
import { useBalance, useStockTransfer, useStoreBreakdown } from '@/query/useStock';
import { useStores } from '@/query/useStores';
import { useAuthStore } from '@/store/auth.store';
import { haptics } from '@/lib/haptics';
import { Product } from '@/api/types';
import { Warehouse, Store, StoreBalance } from '@/data/repositories';
import { useNotes, useCreateNote } from '@/query/useNotes';
import { useReminders, useCreateReminder, useCompleteReminder } from '@/query/useReminders';
import { Note, Reminder } from '@/data/local/notes-reminders';

const REMINDER_PRESETS = [
  { key: '1h', hours: 1 },
  { key: 'tomorrow', hours: 24 },
  { key: '3d', hours: 24 * 3 },
  { key: '1w', hours: 24 * 7 },
] as const;

function presetDate(key: (typeof REMINDER_PRESETS)[number]['key']): Date {
  if (key === 'tomorrow') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  const preset = REMINDER_PRESETS.find((p) => p.key === key) ?? REMINDER_PRESETS[0];
  return new Date(Date.now() + preset.hours * 60 * 60 * 1000);
}

export default function ProductDetailScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const { productId } = useLocalSearchParams<{ productId: string }>();

  const { data: products } = useProducts();
  const product = products?.find((p: Product) => p.id === productId);
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const defaultWarehouseId = useAuthStore((s) => s.defaultWarehouseId);
  const { data: warehouses } = useWarehouses();
  const warehouseOptions = warehouses ?? [];
  const otherWarehouses = warehouseOptions.filter((w: Warehouse) => w.id !== defaultWarehouseId);
  const { data: balance } = useBalance(productId, defaultWarehouseId ?? undefined);
  const { data: breakdown } = useStoreBreakdown(productId, defaultWarehouseId ?? undefined);
  const { data: sourceStores } = useStores(defaultWarehouseId ?? undefined);
  const transfer = useStockTransfer();

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [targetWarehouseId, setTargetWarehouseId] = useState<string | undefined>();
  const [transferQty, setTransferQty] = useState(1);
  const [fromStoreId, setFromStoreId] = useState<string | undefined>();
  const [toStoreId, setToStoreId] = useState<string | undefined>();

  const { data: targetStores } = useStores(targetWarehouseId);

  const { data: notes } = useNotes(productId);
  const createNote = useCreateNote();
  const [noteBody, setNoteBody] = useState('');

  const { data: reminders } = useReminders(productId);
  const createReminder = useCreateReminder();
  const completeReminder = useCompleteReminder(productId);
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderPreset, setReminderPreset] = useState<(typeof REMINDER_PRESETS)[number]['key']>('1h');

  useEffect(() => {
    if (!product) return;
    setName(product.name);
    setSku(product.sku);
    setBarcode(product.barcode ?? '');
    setCostPrice(product.costPrice != null ? String(product.costPrice) : '');
  }, [product]);

  useEffect(() => {
    if (targetWarehouseId) return;
    // Default to a different warehouse when one exists; otherwise fall back
    // to the current warehouse so intra-warehouse section transfers still work.
    if (otherWarehouses.length > 0) {
      setTargetWarehouseId(otherWarehouses[0].id);
    } else if (defaultWarehouseId) {
      setTargetWarehouseId(defaultWarehouseId);
    }
  }, [otherWarehouses, defaultWarehouseId, targetWarehouseId]);

  const isNoOpTransfer =
    targetWarehouseId === defaultWarehouseId && (fromStoreId ?? null) === (toStoreId ?? null);
  const canShowTransfer = otherWarehouses.length > 0 || (sourceStores?.length ?? 0) >= 2;

  const available = balance ? Math.floor(Number(balance.baseQuantity)) : 0;

  const field = {
    color: t.textPrimary,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
  } as const;

  const saveChanges = () => {
    if (!product) return;
    const trimmedCostPrice = costPrice.trim();
    const parsedCostPrice = trimmedCostPrice ? Number(trimmedCostPrice) : null;
    updateProduct.mutate(
      {
        id: product.id,
        input: {
          name: name.trim(),
          sku: sku.trim(),
          barcode: barcode.trim() || null,
          costPrice: parsedCostPrice != null && Number.isFinite(parsedCostPrice) ? parsedCostPrice : null,
        },
      },
      {
        onSuccess: () => void haptics.success(),
        onError: () => void haptics.error(),
      },
    );
  };

  const confirmDelete = () => {
    if (!product) return;
    Alert.alert(tr('product.deleteTitle'), tr('product.deleteConfirm'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('common.confirm'),
        style: 'destructive',
        onPress: () => {
          deleteProduct.mutate(product.id, {
            onSuccess: () => {
              void haptics.warning();
              router.back();
            },
            onError: () => void haptics.error(),
          });
        },
      },
    ]);
  };

  const submitTransfer = () => {
    if (!product || !defaultWarehouseId || !targetWarehouseId) return;
    transfer.mutate(
      {
        productId: product.id,
        fromWarehouseId: defaultWarehouseId,
        toWarehouseId: targetWarehouseId,
        quantity: String(transferQty),
        fromStoreId,
        toStoreId,
      },
      {
        onSuccess: () => {
          void haptics.success();
          setTransferQty(1);
          setFromStoreId(undefined);
          setToStoreId(undefined);
        },
        onError: () => void haptics.error(),
      },
    );
  };

  const submitNote = () => {
    if (!product || !noteBody.trim()) return;
    createNote.mutate(
      { productId: product.id, body: noteBody.trim() },
      {
        onSuccess: () => {
          void haptics.success();
          setNoteBody('');
        },
        onError: () => void haptics.error(),
      },
    );
  };

  const submitReminder = () => {
    if (!product || !reminderTitle.trim()) return;
    createReminder.mutate(
      { productId: product.id, title: reminderTitle.trim(), remindAt: presetDate(reminderPreset) },
      {
        onSuccess: () => {
          void haptics.success();
          setReminderTitle('');
        },
        onError: () => void haptics.error(),
      },
    );
  };

  if (!product) {
    return (
      <ScreenBackground>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: t.textMuted }}>{tr('common.loading')}</Text>
        </SafeAreaView>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="chevron-back" size={26} color={t.textPrimary} />
            </Pressable>
            <Text style={{ color: t.textPrimary, fontSize: 22, fontWeight: '800', flex: 1 }} numberOfLines={1}>
              {product.name}
            </Text>
            <Pressable onPress={confirmDelete} hitSlop={12}>
              <Ionicons name="trash-outline" size={22} color="#EF4444" />
            </Pressable>
          </View>

          <View style={{ gap: 14 }}>
            <TextInput value={name} onChangeText={setName} placeholder={tr('product.name')} placeholderTextColor={t.textMuted} autoCapitalize="words" style={field} />
            <TextInput value={sku} onChangeText={setSku} placeholder={tr('product.sku')} placeholderTextColor={t.textMuted} autoCapitalize="characters" style={field} />
            <TextInput value={barcode} onChangeText={setBarcode} placeholder={tr('product.barcode')} placeholderTextColor={t.textMuted} keyboardType="numbers-and-punctuation" style={field} />
            <TextInput value={costPrice} onChangeText={setCostPrice} placeholder={tr('product.costPrice')} placeholderTextColor={t.textMuted} keyboardType="decimal-pad" style={field} />

            <PremiumButton
              label={tr('common.save')}
              onPress={saveChanges}
              loading={updateProduct.isPending}
              disabled={name.trim().length === 0 || sku.trim().length === 0}
            />
          </View>

          {breakdown && breakdown.length > 0 ? (
            <GlassCard>
              <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 12 }}>
                {tr('product.sectionBreakdown')}
              </Text>
              <View style={{ gap: 8 }}>
                {breakdown.map((b: StoreBalance) => (
                  <View
                    key={b.storeId}
                    style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                  >
                    <Text style={{ color: t.textMuted }}>{b.storeName}</Text>
                    <Text style={{ color: t.textPrimary, fontWeight: '700' }}>{b.quantity}</Text>
                  </View>
                ))}
              </View>
            </GlassCard>
          ) : null}

          <GlassCard>
            <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 6 }}>
              {tr('product.transferTitle')}
            </Text>
            <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 16 }}>
              {tr('common.currentBalance')}: {available}
            </Text>

            {!canShowTransfer ? (
              <Text style={{ color: t.textMuted, fontSize: 13 }}>{tr('product.noOtherWarehouse')}</Text>
            ) : (
              <View style={{ gap: 16 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {warehouseOptions.map((w: Warehouse) => {
                    const selected = w.id === targetWarehouseId;
                    return (
                      <Pressable
                        key={w.id}
                        onPress={() => {
                          void haptics.select();
                          setTargetWarehouseId(w.id);
                          setToStoreId(undefined);
                        }}
                        style={{
                          paddingVertical: 8,
                          paddingHorizontal: 14,
                          borderRadius: 14,
                          backgroundColor: selected ? t.textPrimary : t.card,
                          borderWidth: 1,
                          borderColor: selected ? t.textPrimary : t.cardBorder,
                        }}
                      >
                        <Text style={{ color: selected ? t.background : t.textSecondary, fontWeight: '600' }}>
                          {w.name}
                          {w.id === defaultWarehouseId ? ` (${tr('product.currentWarehouse')})` : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {sourceStores && sourceStores.length > 0 ? (
                  <View style={{ gap: 8 }}>
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>{tr('product.fromSection')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {sourceStores.map((s: Store) => {
                        const selected = s.id === fromStoreId;
                        return (
                          <Pressable
                            key={s.id}
                            onPress={() => {
                              void haptics.select();
                              setFromStoreId(selected ? undefined : s.id);
                            }}
                            style={{
                              paddingVertical: 6,
                              paddingHorizontal: 12,
                              borderRadius: 12,
                              backgroundColor: selected ? BRAND_GRADIENT[0] : t.card,
                              borderWidth: 1,
                              borderColor: selected ? BRAND_GRADIENT[0] : t.cardBorder,
                            }}
                          >
                            <Text style={{ color: selected ? '#FFFFFF' : t.textSecondary, fontSize: 13, fontWeight: '600' }}>
                              {s.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {targetStores && targetStores.length > 0 ? (
                  <View style={{ gap: 8 }}>
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>{tr('product.toSection')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {targetStores.map((s: Store) => {
                        const selected = s.id === toStoreId;
                        return (
                          <Pressable
                            key={s.id}
                            onPress={() => {
                              void haptics.select();
                              setToStoreId(selected ? undefined : s.id);
                            }}
                            style={{
                              paddingVertical: 6,
                              paddingHorizontal: 12,
                              borderRadius: 12,
                              backgroundColor: selected ? BRAND_GRADIENT[0] : t.card,
                              borderWidth: 1,
                              borderColor: selected ? BRAND_GRADIENT[0] : t.cardBorder,
                            }}
                          >
                            <Text style={{ color: selected ? '#FFFFFF' : t.textSecondary, fontSize: 13, fontWeight: '600' }}>
                              {s.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                <View style={{ alignItems: 'center', gap: 12 }}>
                  <QuantitySlider
                    value={transferQty}
                    max={Math.max(available, 1)}
                    onChange={setTransferQty}
                    width={260}
                  />
                </View>

                {isNoOpTransfer ? (
                  <Text style={{ color: t.textMuted, fontSize: 12, textAlign: 'center' }}>
                    {tr('product.pickDifferentLocation')}
                  </Text>
                ) : null}
                <PremiumButton
                  label={tr('product.transferConfirm')}
                  variant="ghost"
                  onPress={submitTransfer}
                  loading={transfer.isPending}
                  disabled={!targetWarehouseId || transferQty < 1 || available < 1 || isNoOpTransfer}
                />
              </View>
            )}
          </GlassCard>

          <GlassCard>
            <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 12 }}>
              {tr('reminder.title')}
            </Text>
            <View style={{ gap: 10 }}>
              <TextInput
                value={reminderTitle}
                onChangeText={setReminderTitle}
                placeholder={tr('reminder.titlePlaceholder')}
                placeholderTextColor={t.textMuted}
                style={field}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {REMINDER_PRESETS.map((preset) => {
                  const selected = preset.key === reminderPreset;
                  return (
                    <Pressable
                      key={preset.key}
                      onPress={() => {
                        void haptics.select();
                        setReminderPreset(preset.key);
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
                        {tr(`reminder.preset.${preset.key}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <PremiumButton
                label={tr('reminder.save')}
                variant="ghost"
                onPress={submitReminder}
                loading={createReminder.isPending}
                disabled={reminderTitle.trim().length === 0}
              />
            </View>

            {reminders && reminders.length > 0 ? (
              <View style={{ gap: 10, marginTop: 16 }}>
                {reminders.map((r: Reminder) => (
                  <View
                    key={r.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      opacity: r.isDone ? 0.5 : 1,
                    }}
                  >
                    <Pressable
                      onPress={() => {
                        if (r.isDone) return;
                        void haptics.select();
                        completeReminder.mutate(r.id);
                      }}
                      hitSlop={8}
                    >
                      <Ionicons
                        name={r.isDone ? 'checkmark-circle' : 'ellipse-outline'}
                        size={22}
                        color={r.isDone ? '#10B981' : t.textMuted}
                      />
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color: t.textPrimary,
                          fontWeight: '600',
                          textDecorationLine: r.isDone ? 'line-through' : 'none',
                        }}
                      >
                        {r.title}
                      </Text>
                      <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        {new Date(r.remindAt).toLocaleString()}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </GlassCard>

          <GlassCard>
            <Text style={{ color: t.textSecondary, fontWeight: '600', marginBottom: 12 }}>
              {tr('note.title')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextInput
                value={noteBody}
                onChangeText={setNoteBody}
                placeholder={tr('note.placeholder')}
                placeholderTextColor={t.textMuted}
                style={[field, { flex: 1 }]}
                multiline
              />
              <PremiumButton
                label={tr('common.save')}
                onPress={submitNote}
                loading={createNote.isPending}
                disabled={noteBody.trim().length === 0}
                style={{ paddingHorizontal: 18 }}
              />
            </View>

            {notes && notes.length > 0 ? (
              <View style={{ gap: 10, marginTop: 16 }}>
                {notes.map((n: Note) => (
                  <View key={n.id} style={{ borderTopWidth: 1, borderTopColor: t.cardBorder, paddingTop: 10 }}>
                    <Text style={{ color: t.textPrimary }}>{n.body}</Text>
                    <Text style={{ color: t.textMuted, fontSize: 11, marginTop: 4 }}>
                      {new Date(n.createdAt).toLocaleString()}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </GlassCard>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}
