import React from 'react';
import { View, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useTheme } from '@/theme/useTheme';
import { haptics } from '@/lib/haptics';

interface QuantitySliderProps {
  value: number;
  max: number;
  onChange: (value: number) => void;
  width?: number;
}

const TRACK_HEIGHT = 64;
const KNOB = 56;

/**
 * Gradient-filled quantity slider. Fires a selection haptic on every
 * integer step change as the knob is dragged.
 */
export function QuantitySlider({ value, max, onChange, width = 300 }: QuantitySliderProps) {
  const t = useTheme();
  const usable = width - KNOB;
  const lastStep = useSharedValue(value);

  const clampToStep = (x: number): number => {
    'worklet';
    const ratio = Math.max(0, Math.min(1, x / usable));
    return Math.round(ratio * max);
  };

  const emit = (step: number) => {
    onChange(step);
    void haptics.select();
  };

  const pan = Gesture.Pan().onChange((e) => {
    const currentX = (value / Math.max(max, 1)) * usable + e.changeX;
    const step = clampToStep(currentX);
    if (step !== lastStep.value) {
      lastStep.value = step;
      runOnJS(emit)(step);
    }
  });

  const fillStyle = useAnimatedStyle(() => ({
    width: KNOB / 2 + (value / Math.max(max, 1)) * usable,
  }));

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (value / Math.max(max, 1)) * usable }],
  }));

  return (
    <View style={{ width, gap: 12 }}>
      <View
        style={{
          height: TRACK_HEIGHT,
          borderRadius: TRACK_HEIGHT / 2,
          backgroundColor: t.card,
          borderWidth: 1,
          borderColor: t.cardBorder,
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <Animated.View style={[{ position: 'absolute', left: 0, height: '100%' }, fillStyle]}>
          <LinearGradient
            colors={BRAND_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ flex: 1 }}
          />
        </Animated.View>

        <GestureDetector gesture={pan}>
          <Animated.View
            style={[
              {
                width: KNOB,
                height: KNOB,
                borderRadius: KNOB / 2,
                backgroundColor: '#FFFFFF',
                marginHorizontal: 4,
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: '#000',
                shadowOpacity: 0.25,
                shadowRadius: 8,
                elevation: 4,
              },
              knobStyle,
            ]}
          >
            <Text style={{ fontWeight: '800', color: '#0F172A' }}>{value}</Text>
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}
