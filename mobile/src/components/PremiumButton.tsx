import React from 'react';
import { Pressable, Text, ViewStyle, ActivityIndicator, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useTheme } from '@/theme/useTheme';
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
  const t = useTheme();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const isDisabled = disabled || loading;

  // Gradient sits on a colored surface, so white always reads. The ghost variant
  // sits directly on the card, so its text/border must follow the theme —
  // white-on-cream is invisible in light mode.
  const contentColor = variant === 'gradient' ? '#FFFFFF' : t.textPrimary;
  const ghostBorderColor = t.cardBorder;

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
    <ActivityIndicator color={contentColor} />
  ) : (
    <Text
      style={{ textAlign: 'center', fontSize: 16, fontWeight: '600', color: contentColor }}
    >
      {label}
    </Text>
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
            borderColor: ghostBorderColor,
          }}
        >
          {content}
        </View>
      )}
    </AnimatedPressable>
  );
}
