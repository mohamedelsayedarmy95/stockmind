import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND_GRADIENT } from '@/theme/colors';

export const TILE_SIZE = 96;

interface WarehouseMapTileProps {
  name: string;
  totalQuantity: number;
  x: number;
  y: number;
  bounds: { width: number; height: number };
  onPress: () => void;
  onMoved: (x: number, y: number) => void;
}

/** A single draggable, tappable section tile on the warehouse map canvas. */
export function WarehouseMapTile({
  name,
  totalQuantity,
  x,
  y,
  bounds,
  onPress,
  onMoved,
}: WarehouseMapTileProps) {
  const translateX = useSharedValue(x);
  const translateY = useSharedValue(y);
  const startX = useSharedValue(x);
  const startY = useSharedValue(y);
  const scale = useSharedValue(1);

  useEffect(() => {
    translateX.value = x;
    translateY.value = y;
    startX.value = x;
    startY.value = y;
    // Only re-sync when the persisted position actually changes (e.g. after a
    // refetch), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  const clamp = (v: number, max: number) => {
    'worklet';
    return Math.max(0, Math.min(max, v));
  };

  const pan = Gesture.Pan()
    .onBegin(() => {
      scale.value = withSpring(1.08);
    })
    .onChange((e) => {
      translateX.value = startX.value + e.translationX;
      translateY.value = startY.value + e.translationY;
    })
    .onEnd((e) => {
      const dist = Math.hypot(e.translationX, e.translationY);
      scale.value = withSpring(1);
      if (dist < 6) {
        translateX.value = withSpring(startX.value);
        translateY.value = withSpring(startY.value);
        runOnJS(onPress)();
        return;
      }
      const clampedX = clamp(translateX.value, bounds.width - TILE_SIZE);
      const clampedY = clamp(translateY.value, bounds.height - TILE_SIZE);
      translateX.value = withSpring(clampedX);
      translateY.value = withSpring(clampedY);
      startX.value = clampedX;
      startY.value = clampedY;
      runOnJS(onMoved)(clampedX, clampedY);
    });

  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // Gamified fill level: visual weight grows with how much stock sits here,
  // capped so a handful of units doesn't look identical to an empty section.
  const fillRatio = Math.min(1, totalQuantity / 100);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          {
            width: TILE_SIZE,
            height: TILE_SIZE,
            borderRadius: 20,
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 6 },
            elevation: 5,
          },
          style,
        ]}
      >
        <LinearGradient
          colors={BRAND_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, padding: 10, justifyContent: 'space-between' }}
        >
          <Text
            numberOfLines={2}
            style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 13 }}
          >
            {name}
          </Text>
          <Animated.View
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: 'rgba(255,255,255,0.25)',
              overflow: 'hidden',
            }}
          >
            <Animated.View
              style={{
                height: '100%',
                width: `${Math.max(6, fillRatio * 100)}%`,
                backgroundColor: '#FFFFFF',
                borderRadius: 3,
              }}
            />
          </Animated.View>
          <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 12 }}>
            {totalQuantity}
          </Text>
        </LinearGradient>
      </Animated.View>
    </GestureDetector>
  );
}
