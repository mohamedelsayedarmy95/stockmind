import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { PremiumButton } from '@/components/PremiumButton';
import { useTheme } from '@/theme/useTheme';
import { useCreateWarehouse } from '@/query/useWarehouses';
import { haptics } from '@/lib/haptics';

/** Add a warehouse to the local (offline) inventory. */
export default function NewWarehouseScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const createWarehouse = useCreateWarehouse();
  const [name, setName] = useState('');

  const submit = () => {
    createWarehouse.mutate(
      { name: name.trim() },
      {
        onSuccess: () => {
          void haptics.success();
          router.back();
        },
        onError: () => void haptics.error(),
      },
    );
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="chevron-back" size={26} color={t.textPrimary} />
            </Pressable>
            <Text style={{ color: t.textPrimary, fontSize: 24, fontWeight: '800' }}>
              {tr('warehouse.addTitle')}
            </Text>
          </View>

          <View style={{ gap: 14 }}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={tr('warehouse.name')}
              placeholderTextColor={t.textMuted}
              autoCapitalize="words"
              style={{
                color: t.textPrimary,
                backgroundColor: t.card,
                borderWidth: 1,
                borderColor: t.cardBorder,
                borderRadius: 18,
                paddingHorizontal: 16,
                paddingVertical: 16,
                fontSize: 16,
              }}
            />
            <PremiumButton
              label={tr('warehouse.save')}
              onPress={submit}
              loading={createWarehouse.isPending}
              disabled={name.trim().length === 0}
              style={{ marginTop: 8 }}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}
