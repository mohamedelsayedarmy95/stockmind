import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { haptics } from '@/lib/haptics';

export interface ChipOption<T extends string> {
  key: T;
  label: string;
  /** Secondary line — e.g. a lot's expiry or on-hand quantity. */
  hint?: string;
}

interface ChipPickerProps<T extends string> {
  options: ChipOption<T>[];
  value: T | undefined;
  onSelect: (value: T | undefined) => void;
  /** Tapping the selected chip clears it. For optional fields. */
  clearable?: boolean;
  size?: 'sm' | 'md';
}

/**
 * Horizontal wrap of selectable chips — the app's one control for picking a
 * warehouse, section, lot, strategy or unit type.
 */
export function ChipPicker<T extends string>({
  options,
  value,
  onSelect,
  clearable = false,
  size = 'md',
}: ChipPickerProps<T>) {
  const t = useTheme();
  const padV = size === 'sm' ? 6 : 8;
  const padH = size === 'sm' ? 12 : 14;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt) => {
        const selected = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => {
              void haptics.select();
              onSelect(selected && clearable ? undefined : opt.key);
            }}
            style={{
              paddingVertical: padV,
              paddingHorizontal: padH,
              borderRadius: 14,
              backgroundColor: selected ? BRAND_GRADIENT[0] : t.card,
              borderWidth: 1,
              borderColor: selected ? BRAND_GRADIENT[0] : t.cardBorder,
            }}
          >
            <Text
              style={{
                color: selected ? '#FFFFFF' : t.textSecondary,
                fontWeight: '600',
                fontSize: size === 'sm' ? 13 : 14,
              }}
            >
              {opt.label}
            </Text>
            {opt.hint ? (
              <Text
                style={{
                  color: selected ? 'rgba(255,255,255,0.85)' : t.textMuted,
                  fontSize: 11,
                  marginTop: 2,
                }}
              >
                {opt.hint}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
