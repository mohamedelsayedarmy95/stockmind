import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { PremiumButton } from '@/components/PremiumButton';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useRegister } from '@/query/useAuth';
import { haptics } from '@/lib/haptics';

export default function RegisterScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const register = useRegister();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');

  const canSubmit = name.trim().length > 0 && email.trim().length > 0 && password.length >= 12 && companyName.trim().length > 0;

  const submit = () => {
    register.mutate(
      {
        name: name.trim(),
        email: email.trim(),
        password,
        companyName: companyName.trim(),
      },
      {
        onSuccess: () => void haptics.success(),
        onError: () => void haptics.error(),
      },
    );
  };

  const fieldStyle = {
    color: t.textPrimary,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 32, gap: 28 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View entering={FadeInDown.springify().damping(16)} style={{ gap: 16 }}>
              <LinearGradient
                colors={BRAND_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="cube" size={32} color="#FFFFFF" />
              </LinearGradient>
              <View>
                <Text style={{ color: t.textPrimary, fontSize: 30, fontWeight: '800' }}>
                  {tr('auth.registerTitle')}
                </Text>
                <Text style={{ color: t.textSecondary, fontSize: 15, marginTop: 6 }}>
                  {tr('auth.registerSubtitle')}
                </Text>
              </View>
            </Animated.View>

            <Animated.View
              entering={FadeInDown.delay(120).springify().damping(16)}
              style={{ gap: 14 }}
            >
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={tr('auth.name')}
                placeholderTextColor={t.textMuted}
                autoCapitalize="words"
                style={fieldStyle}
              />
              <TextInput
                value={companyName}
                onChangeText={setCompanyName}
                placeholder={tr('auth.companyName')}
                placeholderTextColor={t.textMuted}
                autoCapitalize="words"
                style={fieldStyle}
              />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder={tr('auth.email')}
                placeholderTextColor={t.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                style={fieldStyle}
              />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={tr('auth.password')}
                placeholderTextColor={t.textMuted}
                secureTextEntry
                style={fieldStyle}
              />

              {register.isError ? (
                <Text style={{ color: '#EF4444', fontSize: 13 }}>
                  {tr('auth.registerError')}
                </Text>
              ) : null}

              <PremiumButton
                label={tr('auth.register')}
                onPress={submit}
                loading={register.isPending}
                disabled={!canSubmit}
                style={{ marginTop: 8 }}
              />
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(300).springify().damping(16)}>
              <TouchableOpacity
                onPress={() => router.replace('/(auth)/login')}
                style={{ paddingVertical: 20, alignItems: 'center' }}
              >
                <Text style={{ color: t.textMuted, fontSize: 14 }}>
                  {tr('auth.alreadyHaveAccount')}{' '}
                  <Text style={{ color: '#2E7DFF', fontWeight: '600' }}>
                    {tr('auth.signIn')}
                  </Text>
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBackground>
  );
}
