import React, { useEffect } from 'react';
import { useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';

const COLORS = ['#00D2FF', '#7B2FBE', '#10B981', '#F59E0B', '#EF4444'];

function Piece({ index, trigger }: { index: number; trigger: number }) {
  const { width, height } = useWindowDimensions();
  const progress = useSharedValue(0);
  const startX = (index / 24) * width;
  const drift = (Math.random() - 0.5) * 160;
  const rotation = Math.random() * 720;
  const color = COLORS[index % COLORS.length];
  const size = 8 + Math.random() * 6;

  useEffect(() => {
    if (trigger === 0) return;
    progress.value = 0;
    progress.value = withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) });
  }, [trigger, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [
      { translateX: startX + drift * progress.value },
      { translateY: progress.value * height * 0.9 },
      { rotate: `${rotation * progress.value}deg` },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: -20,
          left: 0,
          width: size,
          height: size * 1.6,
          borderRadius: 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

/** Lightweight confetti burst — increment `trigger` to fire. */
export function Confetti({ trigger }: { trigger: number }) {
  if (trigger === 0) return null;
  return (
    <>
      {Array.from({ length: 24 }).map((_, i) => (
        <Piece key={`${trigger}-${i}`} index={i} trigger={trigger} />
      ))}
    </>
  );
}
