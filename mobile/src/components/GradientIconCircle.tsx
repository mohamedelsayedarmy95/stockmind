import React from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { BRAND_GRADIENT } from '@/theme/colors';

interface GradientIconCircleProps {
  icon: keyof typeof Ionicons.glyphMap;
  size?: number;
  iconSize?: number;
}

/** Small gradient-filled icon badge — the same premium treatment as QuickAction, sized for list rows. */
export function GradientIconCircle({ icon, size = 44, iconSize }: GradientIconCircleProps) {
  return (
    <LinearGradient
      colors={BRAND_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={iconSize ?? Math.round(size * 0.46)} color="#FFFFFF" />
    </LinearGradient>
  );
}
