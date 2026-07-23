import React from 'react';
import { View, ViewProps, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/theme/useTheme';

interface GlassCardProps extends ViewProps {
  intensity?: number;
  padded?: boolean;
}

/**
 * Glassmorphism surface. In dark mode it uses a real BlurView (frosted glass);
 * in light mode it renders a clean white card with a soft shadow (Apple Music style).
 */
export function GlassCard({
  children,
  style,
  intensity,
  padded = true,
  ...rest
}: GlassCardProps) {
  const t = useTheme();
  const pad = padded ? 20 : 0;

  if (t.mode === 'dark' && Platform.OS !== 'web') {
    return (
      <BlurView
        intensity={intensity ?? t.glassBlur}
        tint="dark"
        style={[
          {
            borderRadius: 28,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: t.cardBorder,
            padding: pad,
            backgroundColor: 'rgba(255,255,255,0.04)',
          },
          style,
        ]}
        {...rest}
      >
        {children}
      </BlurView>
    );
  }

  return (
    <View
      style={[
        {
          borderRadius: 28,
          borderWidth: 1,
          borderColor: t.cardBorder,
          padding: pad,
          backgroundColor: t.card,
          shadowColor: t.shadowColor,
          shadowOpacity: 1,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
          elevation: 6,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
