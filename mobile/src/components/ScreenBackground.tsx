import React from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT_SOFT } from '@/theme/colors';

/** Full-bleed themed background with two soft brand glows in the corners. */
export function ScreenBackground({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      {t.mode === 'dark' ? (
        <>
          <LinearGradient
            colors={[BRAND_GRADIENT_SOFT[0], 'transparent']}
            style={{
              position: 'absolute',
              top: -80,
              left: -60,
              width: 280,
              height: 280,
              borderRadius: 140,
            }}
          />
          <LinearGradient
            colors={[BRAND_GRADIENT_SOFT[1], 'transparent']}
            style={{
              position: 'absolute',
              bottom: -100,
              right: -80,
              width: 300,
              height: 300,
              borderRadius: 150,
            }}
          />
        </>
      ) : null}
      {children}
    </View>
  );
}
