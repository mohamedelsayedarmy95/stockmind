import React, { useState, useEffect } from 'react';
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
import { useLogin, useTwoFactorLogin } from '@/query/useAuth';
import { useGoogleSignIn } from '@/query/useGoogleAuth';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';
import { haptics } from '@/lib/haptics';
import { BASE_URL } from '@/api/client';
import { ONLINE_MODE_DEV_PREVIEW, IS_QA_BUILD, apiHostLabel } from '@/lib/dev-flags';
import { useAccessNotice } from '@/store/access-notice.store';
import {
  AuthFlowError,
  LoginOutcome,
  errorCodeOf,
  httpStatusOf,
  loginFailure,
  normalizeOtpInput,
  twoFactorFailure,
} from '@/domain/auth-flow';

/** A pending 2FA challenge: the temp token and when it was issued (the server honours it for 2 minutes). */
interface Challenge {
  tempToken: string;
  issuedAt: number;
}

const LOGIN_ERROR_KEY = {
  'invalid-credentials': 'auth.invalidCredentials',
  locked: 'online.locked',
  network: 'online.network',
  'access-revoked': 'team.accessRevokedLogin',
  error: 'common.error',
} as const;

export default function LoginScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const login = useLogin();
  const twoFactor = useTwoFactorLogin();
  const googleSignIn = useGoogleSignIn();
  const setGuest = useAuthStore((s) => s.setGuest);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const accessRevoked = useAccessNotice((s) => s.revoked);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [otp, setOtp] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // Reset stale mutation error state each time this screen mounts
  useEffect(() => {
    login.reset();
    googleSignIn.reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A session is stored by the hook itself; a challenge switches this screen to the code step. */
  const onOutcome = (outcome: LoginOutcome | null) => {
    if (outcome?.kind === 'second-factor') {
      setChallenge({ tempToken: outcome.tempToken, issuedAt: Date.now() });
      setOtp('');
      setErrorKey(null);
      void haptics.select();
    } else if (outcome) {
      void haptics.success();
    }
  };

  const submit = () => {
    setErrorKey(null);
    login.mutate(
      { email: email.trim(), password },
      {
        onSuccess: onOutcome,
        onError: (err) => {
          void haptics.error();
          setErrorKey(
            err instanceof AuthFlowError ? 'common.error' : LOGIN_ERROR_KEY[loginFailure(httpStatusOf(err), errorCodeOf(err))],
          );
        },
      },
    );
  };

  const otpCode = normalizeOtpInput(otp);

  const verify = () => {
    if (!challenge || !otpCode) return;
    setErrorKey(null);
    twoFactor.mutate(
      { tempToken: challenge.tempToken, otpCode },
      {
        onSuccess: () => void haptics.success(),
        onError: (err) => {
          void haptics.error();
          if (err instanceof AuthFlowError) return setErrorKey('common.error');
          const failure = twoFactorFailure(httpStatusOf(err), Date.now() - challenge.issuedAt);
          if (failure === 'expired') {
            // The temp token is dead: back to the password step, which issues a new one.
            setChallenge(null);
            setPassword('');
            setErrorKey('online.otpExpired');
          } else {
            setErrorKey(
              failure === 'invalid-code'
                ? 'online.otpInvalid'
                : failure === 'locked'
                  ? 'online.locked'
                  : failure === 'network'
                    ? 'online.network'
                    : 'common.error',
            );
          }
        },
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

  const errorText = errorKey ? (
    <Text testID="login-error" style={{ color: '#EF4444', fontSize: 13 }}>
      {tr(errorKey)}
    </Text>
  ) : accessRevoked ? (
    // Series 09: signed out because the server revoked this member's access. Calm, factual, and says the queue is kept.
    <Text testID="access-revoked-notice" style={{ color: t.textSecondary, fontSize: 13 }}>
      {tr('team.accessNotice')}
    </Text>
  ) : null;

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
              <Ionicons name={challenge ? 'shield-checkmark' : 'cube'} size={32} color="#FFFFFF" />
            </LinearGradient>
            <View>
              <Text style={{ color: t.textPrimary, fontSize: 30, fontWeight: '800' }}>
                {challenge ? tr('online.otpTitle') : tr('auth.welcome')}
              </Text>
              <Text style={{ color: t.textSecondary, fontSize: 15, marginTop: 6 }}>
                {challenge ? tr('online.otpSubtitle') : tr('auth.subtitle')}
              </Text>
              {ONLINE_MODE_DEV_PREVIEW ? (
                <Text testID="api-host" style={{ color: t.textMuted, fontSize: 12, marginTop: 8 }}>
                  {tr(IS_QA_BUILD ? 'onboarding.qaPreview' : 'onboarding.devPreview')} · {tr('online.apiHost', { host: apiHostLabel(BASE_URL) })}
                </Text>
              ) : null}
            </View>
          </Animated.View>

          {challenge ? (
            <Animated.View entering={FadeInDown.springify().damping(16)} style={{ gap: 14 }}>
              <TextInput
                testID="otp-input"
                value={otp}
                onChangeText={setOtp}
                placeholder={tr('online.otpPlaceholder')}
                placeholderTextColor={t.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={14}
                style={[fieldStyle, { letterSpacing: 4, textAlign: 'center', fontSize: 22, fontWeight: '700' }]}
              />
              {errorText}
              <PremiumButton
                label={tr('online.verify')}
                onPress={verify}
                loading={twoFactor.isPending}
                disabled={!otpCode}
                style={{ marginTop: 8 }}
              />
              <TouchableOpacity
                onPress={() => {
                  setChallenge(null);
                  setErrorKey(null);
                }}
                style={{ paddingVertical: 12, alignItems: 'center' }}
              >
                <Text style={{ color: t.textMuted, fontSize: 14 }}>{tr('online.backToPassword')}</Text>
              </TouchableOpacity>
            </Animated.View>
          ) : (
            <>
              <Animated.View
                entering={FadeInDown.delay(120).springify().damping(16)}
                style={{ gap: 14 }}
              >
                <TextInput
                  testID="email-input"
                  value={email}
                  onChangeText={setEmail}
                  placeholder={tr('auth.email')}
                  placeholderTextColor={t.textMuted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={fieldStyle}
                />
                <TextInput
                  testID="password-input"
                  value={password}
                  onChangeText={setPassword}
                  placeholder={tr('auth.password')}
                  placeholderTextColor={t.textMuted}
                  secureTextEntry
                  style={fieldStyle}
                />

                {errorText}

                <PremiumButton
                  label={tr('auth.signIn')}
                  onPress={submit}
                  loading={login.isPending}
                  disabled={!email || !password}
                  style={{ marginTop: 8 }}
                />

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: t.cardBorder }} />
                  <Text style={{ color: t.textMuted, fontSize: 13 }}>{tr('common.or') ?? 'or'}</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: t.cardBorder }} />
                </View>

                <TouchableOpacity
                  onPress={() => {
                    googleSignIn.mutate(undefined, {
                      onSuccess: onOutcome,
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
                    {tr('auth.continueWithGoogle') ?? 'Continue with Google'}
                  </Text>
                </TouchableOpacity>

                {googleSignIn.isError ? (
                  <Text style={{ color: '#EF4444', fontSize: 13 }}>
                    {tr('auth.googleError') ?? 'Google sign-in failed. Please try again.'}
                  </Text>
                ) : null}
              </Animated.View>

              <Animated.View entering={FadeInDown.delay(300).springify().damping(16)} style={{ gap: 4 }}>
                {ONLINE_MODE_DEV_PREVIEW ? (
                  <TouchableOpacity
                    testID="accept-invitation-link"
                    onPress={() => router.push('/(auth)/accept-invitation')}
                    style={{ paddingVertical: 12, alignItems: 'center' }}
                  >
                    <Text style={{ color: t.textMuted, fontSize: 14 }}>
                      {tr('online.haveInvitation')}{' '}
                      <Text style={{ color: '#2E7DFF', fontWeight: '600' }}>{tr('online.joinTeam')}</Text>
                    </Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  onPress={() => router.push('/(auth)/register')}
                  style={{ paddingVertical: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: t.textMuted, fontSize: 14 }}>
                    {tr('auth.noAccount')}{' '}
                    <Text style={{ color: '#2E7DFF', fontWeight: '600' }}>
                      {tr('auth.register')}
                    </Text>
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { void haptics.success(); setGuest(); }}
                  style={{ paddingVertical: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: t.textMuted, fontSize: 14 }}>
                    {tr('auth.continueAsGuest') ?? 'Continue as Guest'}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            </>
          )}
        </View>
      </SafeAreaView>
    </ScreenBackground>
  );
}
