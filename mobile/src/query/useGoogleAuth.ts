import { useMutation } from '@tanstack/react-query';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { api } from '@/api/client';
import { classifyLoginResponse, LoginOutcome } from '@/domain/auth-flow';
import { startOnlineSession } from './useAuth';

const WEB_CLIENT_ID =
  '763924631139-nc9o8g9g2pjj9gbt3bin2o56itm8nf05.apps.googleusercontent.com';

GoogleSignin.configure({
  webClientId: WEB_CLIENT_ID,
  // Disable One Tap / Credential Manager auto-prompt so it only appears
  // when the user explicitly taps "Continue with Google".
  offlineAccess: false,
});

/** Like useLogin: a user with 2FA gets a challenge, not a session (the server gates Google sign-ins the same way). */
export function useGoogleSignIn() {
  return useMutation({
    mutationFn: async (): Promise<LoginOutcome | null> => {
      try {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const signInResult = await GoogleSignin.signIn();
        const idToken = signInResult.data?.idToken;
        if (!idToken) return null;
        const { data } = await api.post<unknown>('/auth/google', { idToken });
        return classifyLoginResponse(data);
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (
          code === statusCodes.SIGN_IN_CANCELLED ||
          code === statusCodes.IN_PROGRESS
        ) {
          return null; // cancellation → not an error, won't set isError
        }
        throw err;
      }
    },
    onSuccess: (outcome) => {
      // null: the user cancelled. A 2FA challenge is handled by the screen.
      if (outcome?.kind === 'session') startOnlineSession(outcome.session);
    },
  });
}
