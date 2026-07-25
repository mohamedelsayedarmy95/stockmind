import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { ScreenBackground } from '@/components/ScreenBackground';
import { PremiumButton } from '@/components/PremiumButton';
import { useTheme } from '@/theme/useTheme';
import { useCreateProduct } from '@/query/useProducts';
import { haptics } from '@/lib/haptics';

/** Add a product to the local (offline) catalog. */
export default function NewProductScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const createProduct = useCreateProduct();

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [unitWeight, setUnitWeight] = useState('');

  const canSubmit = name.trim().length > 0 && sku.trim().length > 0;

  /** Blank stays blank; anything unparseable is treated as "not recorded". */
  const parseOptionalNumber = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const submit = () => {
    createProduct.mutate(
      {
        name: name.trim(),
        sku: sku.trim(),
        barcode: barcode.trim() || null,
        costPrice: parseOptionalNumber(costPrice),
        unitWeightKg: parseOptionalNumber(unitWeight),
      },
      {
        onSuccess: () => {
          void haptics.success();
          router.back();
        },
        onError: () => void haptics.error(),
      },
    );
  };

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

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="chevron-back" size={26} color={t.textPrimary} />
            </Pressable>
            <Text style={{ color: t.textPrimary, fontSize: 24, fontWeight: '800' }}>
              {tr('product.addTitle')}
            </Text>
          </View>

          <View style={{ gap: 14 }}>
            <TextInput value={name} onChangeText={setName} placeholder={tr('product.name')} placeholderTextColor={t.textMuted} autoCapitalize="words" style={field} />
            <TextInput value={sku} onChangeText={setSku} placeholder={tr('product.sku')} placeholderTextColor={t.textMuted} autoCapitalize="characters" style={field} />
            <TextInput value={barcode} onChangeText={setBarcode} placeholder={tr('product.barcode')} placeholderTextColor={t.textMuted} keyboardType="numbers-and-punctuation" style={field} />
            <TextInput value={costPrice} onChangeText={setCostPrice} placeholder={tr('product.costPrice')} placeholderTextColor={t.textMuted} keyboardType="decimal-pad" style={field} />
            <TextInput value={unitWeight} onChangeText={setUnitWeight} placeholder={tr('product.unitWeight')} placeholderTextColor={t.textMuted} keyboardType="decimal-pad" style={field} />

            <PremiumButton
              label={tr('product.save')}
              onPress={submit}
              loading={createProduct.isPending}
              disabled={!canSubmit}
              style={{ marginTop: 8 }}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}
