import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Animated, { SlideInDown, SlideOutDown, FadeIn, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/useTheme';
import { useAskAssistant } from '@/query/useAi';
import { haptics } from '@/lib/haptics';
import { BRAND_GRADIENT } from '@/theme/colors';

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Bottom-sheet chat for the Hugging Face assistant. */
export function AskMeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const ask = useAskAssistant();

  const send = () => {
    const prompt = input.trim();
    if (!prompt || ask.isPending) return;
    void haptics.tap();
    setTurns((prev) => [...prev, { role: 'user', text: prompt }]);
    setInput('');
    ask.mutate(prompt, {
      onSuccess: (answer) => {
        void haptics.success();
        setTurns((prev) => [...prev, { role: 'assistant', text: answer }]);
      },
      onError: () => {
        void haptics.error();
        setTurns((prev) => [...prev, { role: 'assistant', text: tr('common.error') }]);
      },
    });
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        entering={FadeIn}
        exiting={FadeOut}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.springify().damping(18)}
        exiting={SlideOutDown}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '72%',
          backgroundColor: t.background,
          borderTopLeftRadius: 32,
          borderTopRightRadius: 32,
          borderWidth: 1,
          borderColor: t.cardBorder,
          paddingTop: 12,
        }}
      >
        <View style={{ alignItems: 'center', paddingBottom: 8 }}>
          <View
            style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: t.textMuted }}
          />
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 20,
            paddingBottom: 8,
          }}
        >
          <Ionicons name="sparkles" size={20} color={BRAND_GRADIENT[0]} />
          <Text style={{ color: t.textPrimary, fontSize: 18, fontWeight: '700' }}>
            {tr('assistant.title')}
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1, paddingHorizontal: 20 }}
          contentContainerStyle={{ paddingVertical: 12, gap: 12 }}
        >
          {turns.map((turn, i) => (
            <View
              key={i}
              style={{
                alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                backgroundColor:
                  turn.role === 'user' ? BRAND_GRADIENT[1] : t.card,
                borderWidth: turn.role === 'user' ? 0 : 1,
                borderColor: t.cardBorder,
                borderRadius: 20,
                paddingVertical: 12,
                paddingHorizontal: 16,
              }}
            >
              <Text style={{ color: turn.role === 'user' ? '#FFFFFF' : t.textPrimary }}>
                {turn.text}
              </Text>
            </View>
          ))}
          {ask.isPending ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator color={t.textMuted} />
              <Text style={{ color: t.textMuted }}>{tr('assistant.thinking')}</Text>
            </View>
          ) : null}
        </ScrollView>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 20,
            paddingVertical: 14,
            borderTopWidth: 1,
            borderTopColor: t.cardBorder,
          }}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={tr('assistant.placeholder')}
            placeholderTextColor={t.textMuted}
            onSubmitEditing={send}
            style={{
              flex: 1,
              color: t.textPrimary,
              backgroundColor: t.card,
              borderWidth: 1,
              borderColor: t.cardBorder,
              borderRadius: 20,
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
          />
          <Pressable
            onPress={send}
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              backgroundColor: BRAND_GRADIENT[0],
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="arrow-up" size={22} color="#FFFFFF" />
          </Pressable>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}
