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
import { useAcceptInvitation } from '@/query/useAuth';
import { haptics } from '@/lib/haptics';
import { AuthFlowError, httpStatusOf, invitationFailure, InvitationField, validateInvitation } from '@/domain/auth-flow';

const FAILURE_KEY = {
  'invalid-or-expired': 'online.inviteInvalid',
  'email-registered': 'online.inviteEmailTaken',
  'no-seat': 'online.inviteNoSeat',
  network: 'online.network',
  error: 'common.error',
} as const;

const FIELD_KEY: Record<InvitationField, string> = {
  token: 'online.fieldToken',
  name: 'online.fieldName',
  password: 'online.fieldPassword',
};

/**
 * Joins a team with the single-use invitation an admin created (POST /auth/accept-invitation). The email, role and,
 * for Staff, the granted warehouses come from the invitation itself; the member only picks a name and a password.
 */
export default function AcceptInvitationScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const accept = useAcceptInvitation();

  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const invalid = validateInvitation({ token, name, password });

  const submit = () => {
    setTouched(true);
    setErrorKey(null);
    if (invalid.length > 0) return;
    accept.mutate(
      { token, name, password },
      {
        // AuthGate routes into the app once the session is stored.
        onSuccess: () => void haptics.success(),
        onError: (err) => {
          void haptics.error();
          setErrorKey(err instanceof AuthFlowError ? 'common.error' : FAILURE_KEY[invitationFailure(httpStatusOf(err))]);
        },
      },
    );
  };

  const fieldStyle = (field: InvitationField) => ({
    color: t.textPrimary,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: touched && invalid.includes(field) ? '#EF4444' : t.cardBorder,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
  });

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 24, paddingVertical: 24 }}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View entering={FadeInDown.springify().damping(16)} style={{ gap: 16 }}>
              <LinearGradient
                colors={BRAND_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="people" size={32} color="#FFFFFF" />
              </LinearGradient>
              <View>
                <Text style={{ color: t.textPrimary, fontSize: 30, fontWeight: '800' }}>{tr('online.joinTeam')}</Text>
                <Text style={{ color: t.textSecondary, fontSize: 15, marginTop: 6 }}>{tr('online.inviteSubtitle')}</Text>
              </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(120).springify().damping(16)} style={{ gap: 14 }}>
              <TextInput
                testID="invite-token-input"
                value={token}
                onChangeText={setToken}
                placeholder={tr('online.inviteToken')}
                placeholderTextColor={t.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={fieldStyle('token')}
              />
              <TextInput
                testID="invite-name-input"
                value={name}
                onChangeText={setName}
                placeholder={tr('auth.name')}
                placeholderTextColor={t.textMuted}
                style={fieldStyle('name')}
              />
              <TextInput
                testID="invite-password-input"
                value={password}
                onChangeText={setPassword}
                placeholder={tr('auth.password')}
                placeholderTextColor={t.textMuted}
                secureTextEntry
                style={fieldStyle('password')}
              />
              <Text style={{ color: t.textMuted, fontSize: 12 }}>{tr('online.invitePasswordHint')}</Text>

              {touched
                ? invalid.map((field) => (
                    <Text key={field} style={{ color: '#EF4444', fontSize: 13 }}>
                      {tr(FIELD_KEY[field])}
                    </Text>
                  ))
                : null}
              {errorKey ? (
                <Text testID="invite-error" style={{ color: '#EF4444', fontSize: 13 }}>
                  {tr(errorKey)}
                </Text>
              ) : null}

              <PremiumButton
                label={tr('online.acceptInvite')}
                onPress={submit}
                loading={accept.isPending}
                style={{ marginTop: 8 }}
              />
            </Animated.View>

            <TouchableOpacity onPress={() => router.back()} style={{ paddingVertical: 12, alignItems: 'center' }}>
              <Text style={{ color: t.textMuted, fontSize: 14 }}>
                {tr('auth.alreadyHaveAccount')}{' '}
                <Text style={{ color: '#2E7DFF', fontWeight: '600' }}>{tr('auth.signIn')}</Text>
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBackground>
  );
}
