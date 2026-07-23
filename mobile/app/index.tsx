import { Redirect } from 'expo-router';

/** Entry point — the AuthGate in _layout handles the real redirect once hydrated. */
export default function Index() {
  return <Redirect href="/(tabs)" />;
}
