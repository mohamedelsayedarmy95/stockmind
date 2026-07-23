import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassCard } from './GlassCard';
import { useTheme } from '@/theme/useTheme';

interface KpiCardProps {
  label: string;
  value: string;
  accent?: [string, string];
  index?: number;
}

/**
 * KPI tile — glass surface with a soft radial glow behind the value.
 * Spring-enters with a stagger based on `index`.
 */
export function KpiCard({ label, value, accent, index = 0 }: KpiCardProps) {
  const t = useTheme();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(24);

  useEffect(() => {
    opacity.value = withDelay(index * 90, withSpring(1, { damping: 16 }));
    translateY.value = withDelay(index * 90, withSpring(0, { damping: 16 }));
  }, [index, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[{ flex: 1 }, animatedStyle]}>
      <GlassCard style={{ overflow: 'hidden' }}>
        {accent ? (
          <LinearGradient
            colors={[accent[0] + '33', 'transparent']}
            style={{
              position: 'absolute',
              top: -30,
              right: -30,
              width: 110,
              height: 110,
              borderRadius: 55,
            }}
          />
        ) : null}
        <View>
          <Text style={{ color: t.textMuted, fontSize: 12 }} numberOfLines={1}>
            {label}
          </Text>
          <Text
            style={{ color: t.textPrimary, fontSize: 24, fontWeight: '800', marginTop: 8 }}
            numberOfLines={1}
          >
            {value}
          </Text>
        </View>
      </GlassCard>
    </Animated.View>
  );
}
