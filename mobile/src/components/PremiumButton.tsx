import React from 'react';
import { Pressable, Text, ViewStyle, ActivityIndicator, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { BRAND_GRADIENT } from '@/theme/colors';
import { haptics } from '@/lib/haptics';

interface PremiumButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'gradient' | 'ghost';
  style?: ViewStyle;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Primary CTA with spring press feedback (Arc-style) and light haptic on tap.
 */
export function PremiumButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'gradient',
  style,
}: PremiumButtonProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const isDisabled = disabled || loading;

  const handlePressIn = () => {
    scale.value = withSpring(0.96, { damping: 15, stiffness: 320 });
  };
  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 12, stiffness: 240 });
  };
  const handlePress = () => {
    if (isDisabled) return;
    void haptics.tap();
    onPress();
  };

  const content = loading ? (
    <ActivityIndicator color="#FFFFFF" />
  ) : (
    <Text className="text-center text-base font-semibold text-white">{label}</Text>
  );

  return (
    <AnimatedPressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      disabled={isDisabled}
      style={[animatedStyle, { opacity: isDisabled ? 0.55 : 1 }, style]}
    >
      {variant === 'gradient' ? (
        <LinearGradient
          colors={BRAND_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 22, paddingVertical: 18, paddingHorizontal: 24 }}
        >
          {content}
        </LinearGradient>
      ) : (
        <View
          style={{
            borderRadius: 22,
            paddingVertical: 18,
            paddingHorizontal: 24,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.15)',
          }}
        >
          {content}
        </View>
      )}
    </AnimatedPressable>
  );
}
