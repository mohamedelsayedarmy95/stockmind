import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useTheme } from '@/theme/useTheme';
import { haptics } from '@/lib/haptics';

interface QuickActionProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Large circular quick-action with icon, spring press, and label underneath. */
export function QuickAction({ icon, label, onPress }: QuickActionProps) {
  const t = useTheme();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <AnimatedPressable
        onPressIn={() => (scale.value = withSpring(0.9, { damping: 14 }))}
        onPressOut={() => (scale.value = withSpring(1, { damping: 10 }))}
        onPress={() => {
          void haptics.tap();
          onPress();
        }}
        style={animatedStyle}
      >
        <LinearGradient
          colors={BRAND_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 68,
            height: 68,
            borderRadius: 34,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={28} color="#FFFFFF" />
        </LinearGradient>
      </AnimatedPressable>
      <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}
