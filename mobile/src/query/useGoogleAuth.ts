import { useMutation } from '@tanstack/react-query';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { api } from '@/api/client';
import { LoginResponse } from '@/api/types';
import { useAuthStore } from '@/store/auth.store';

const WEB_CLIENT_ID =
  '763924631139-nc9o8g9g2pjj9gbt3bin2o56itm8nf05.apps.googleusercontent.com';

GoogleSignin.configure({
  webClientId: WEB_CLIENT_ID,
  // Disable One Tap / Credential Manager auto-prompt so it only appears
  // when the user explicitly taps "Continue with Google".
  offlineAccess: false,
});

export function useGoogleSignIn() {
  const setSession = useAuthStore((s) => s.setSession);

  return useMutation({
    mutationFn: async (): Promise<LoginResponse | null> => {
      try {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const signInResult = await GoogleSignin.signIn();
        const idToken = signInResult.data?.idToken;
        if (!idToken) return null;
        const { data } = await api.post<LoginResponse>('/auth/google', { idToken });
        return data;
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
    onSuccess: (data) => {
      if (!data) return; // user cancelled
      setSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      });
    },
  });
}
