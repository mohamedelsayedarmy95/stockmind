import React, { useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { PremiumButton } from '@/components/PremiumButton';
import { useTheme } from '@/theme/useTheme';
import { BRAND_GRADIENT } from '@/theme/colors';
import { useLogin } from '@/query/useAuth';
import { haptics } from '@/lib/haptics';

export default function LoginScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = () => {
    login.mutate(
      { email: email.trim(), password },
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
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 28 }}>
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
                {tr('auth.welcome')}
              </Text>
              <Text style={{ color: t.textSecondary, fontSize: 15, marginTop: 6 }}>
                {tr('auth.subtitle')}
              </Text>
            </View>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.delay(120).springify().damping(16)}
            style={{ gap: 14 }}
          >
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

            {login.isError ? (
              <Text style={{ color: '#EF4444', fontSize: 13 }}>
                {tr('auth.invalidCredentials')}
              </Text>
            ) : null}

            <PremiumButton
              label={tr('auth.signIn')}
              onPress={submit}
              loading={login.isPending}
              disabled={!email || !password}
              style={{ marginTop: 8 }}
            />
          </Animated.View>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  );
}
