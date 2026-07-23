import { useColorScheme } from 'react-native';
import { useSettingsStore } from '@/store/settings.store';
import { DARK, LIGHT, ThemeTokens } from './colors';

/** Resolves the active theme tokens from the user's setting + system scheme. */
export function useTheme(): ThemeTokens {
  const mode = useSettingsStore((s) => s.themeMode);
  const system = useColorScheme();

  if (mode === 'system') {
    return system === 'light' ? LIGHT : DARK;
  }
  return mode === 'light' ? LIGHT : DARK;
}

export function useIsDark(): boolean {
  return useTheme().mode === 'dark';
}
