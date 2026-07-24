import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
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
import { useGoogleSignIn } from '@/query/useGoogleAuth';
import { useAuthStore } from '@/store/auth.store';
import { haptics } from '@/lib/haptics';

export default function LoginScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const login = useLogin();
  const googleSignIn = useGoogleSignIn();
  const setGuest = useAuthStore((s) => s.setGuest);
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

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: t.cardBorder }} />
              <Text style={{ color: t.textMuted, fontSize: 13 }}>or</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: t.cardBorder }} />
            </View>

            <TouchableOpacity
              onPress={() => {
                googleSignIn.mutate(undefined, {
                  onSuccess: () => void haptics.success(),
                  onError: () => void haptics.error(),
                });
              }}
              disabled={googleSignIn.isPending}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                backgroundColor: t.card,
                borderWidth: 1,
                borderColor: t.cardBorder,
                borderRadius: 18,
                paddingVertical: 16,
                opacity: googleSignIn.isPending ? 0.6 : 1,
              }}
            >
              {googleSignIn.isPending ? (
                <ActivityIndicator size="small" color={t.textSecondary} />
              ) : (
                <Ionicons name="logo-google" size={20} color="#4285F4" />
              )}
              <Text style={{ color: t.textPrimary, fontSize: 15, fontWeight: '600' }}>
                Continue with Google
              </Text>
            </TouchableOpacity>

            {googleSignIn.isError ? (
              <Text style={{ color: '#EF4444', fontSize: 13 }}>
                Google sign-in failed. Please try again.
              </Text>
            ) : null}
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(300).springify().damping(16)}>
            <TouchableOpacity
              onPress={() => { void haptics.success(); setGuest(); }}
              style={{ paddingVertical: 20, alignItems: 'center' }}
            >
              <Text style={{ color: t.textMuted, fontSize: 14 }}>
                Continue as Guest
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  );
}
