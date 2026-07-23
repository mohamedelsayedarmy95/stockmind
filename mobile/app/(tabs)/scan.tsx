import React, { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { PremiumButton } from '@/components/PremiumButton';
import { GlassCard } from '@/components/GlassCard';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useProducts, useProductByBarcode } from '@/query/useProducts';
import { haptics } from '@/lib/haptics';

export default function ScanScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const { data: products } = useProducts();
  const [scanned, setScanned] = useState<string | null>(null);
  const [active, setActive] = useState(true);

  // Re-arm the scanner whenever the tab regains focus.
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      setScanned(null);
      return () => setActive(false);
    }, []),
  );

  const matched = useProductByBarcode(products, scanned);

  const onScan = (result: BarcodeScanningResult) => {
    if (scanned) return;
    setScanned(result.data);
    void haptics.heavy();
  };

  if (!permission) return <ScreenBackground><View /></ScreenBackground>;

  if (!permission.granted) {
    return (
      <ScreenBackground>
        <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: 28, gap: 16 }}>
          <Ionicons name="camera-outline" size={48} color={t.textSecondary} />
          <Text style={{ color: t.textPrimary, fontSize: 20, fontWeight: '700' }}>
            {tr('scan.title')}
          </Text>
          <Text style={{ color: t.textSecondary }}>{tr('scan.permissionDenied')}</Text>
          <PremiumButton label={tr('scan.requestPermission')} onPress={requestPermission} />
        </SafeAreaView>
      </ScreenBackground>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {active ? (
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'qr', 'upc_a'] }}
          onBarcodeScanned={scanned ? undefined : onScan}
        />
      ) : null}

      {/* Neon reticle overlay */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        pointerEvents="none"
      >
        <View
          style={{
            width: 260,
            height: 180,
            borderRadius: 24,
            borderWidth: 2,
            borderColor: BRAND_GRADIENT[0],
            shadowColor: BRAND_GRADIENT[0],
            shadowOpacity: 0.9,
            shadowRadius: 16,
          }}
        />
        <Text style={{ color: '#FFFFFF', marginTop: 20, fontWeight: '600' }}>
          {tr('scan.hint')}
        </Text>
      </View>

      {/* Result sheet */}
      {scanned ? (
        <Animated.View
          entering={SlideInDown.springify().damping(18)}
          style={{ position: 'absolute', bottom: 24, left: 16, right: 16 }}
        >
          <GlassCard>
            {matched ? (
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Ionicons name="cube" size={28} color={BRAND_GRADIENT[0]} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.textPrimary, fontSize: 18, fontWeight: '700' }}>
                      {matched.name}
                    </Text>
                    <Text style={{ color: t.textMuted }}>{matched.sku}</Text>
                  </View>
                </View>
                <PremiumButton
                  label={tr('scan.execute')}
                  onPress={() =>
                    router.push({
                      pathname: '/movement/[productId]',
                      params: { productId: matched.id, mode: 'outbound' },
                    })
                  }
                />
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                <Text style={{ color: t.textPrimary, fontWeight: '600' }}>
                  {tr('scan.notFound')}
                </Text>
                <Pressable onPress={() => setScanned(null)}>
                  <Text style={{ color: BRAND_GRADIENT[0], fontWeight: '600' }}>
                    {tr('common.retry')}
                  </Text>
                </Pressable>
              </View>
            )}
          </GlassCard>
        </Animated.View>
      ) : null}
    </View>
  );
}
