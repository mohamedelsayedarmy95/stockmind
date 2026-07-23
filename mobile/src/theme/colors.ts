/**
 * Central design tokens. NativeWind handles the class-based colors;
 * these constants are for imperative use (Skia, gradients, StatusBar,
 * shadows, and anywhere className strings can't reach).
 */

export const BRAND_GRADIENT = ['#00D2FF', '#7B2FBE'] as const;
export const BRAND_GRADIENT_SOFT = ['rgba(0,210,255,0.18)', 'rgba(123,47,190,0.18)'] as const;

export const STATUS = {
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
} as const;

export interface ThemeTokens {
  mode: 'dark' | 'light';
  background: string;
  card: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  glassBlur: number;
  shadowColor: string;
}

export const DARK: ThemeTokens = {
  mode: 'dark',
  background: '#0A0E17',
  card: 'rgba(255,255,255,0.05)',
  cardBorder: 'rgba(255,255,255,0.08)',
  textPrimary: '#F8FAFC',
  textSecondary: 'rgba(248,250,252,0.72)',
  textMuted: 'rgba(248,250,252,0.45)',
  glassBlur: 40,
  shadowColor: '#000000',
};

export const LIGHT: ThemeTokens = {
  mode: 'light',
  background: '#F8FAFC',
  card: '#FFFFFF',
  cardBorder: 'rgba(15,23,42,0.06)',
  textPrimary: '#0F172A',
  textSecondary: 'rgba(15,23,42,0.68)',
  textMuted: 'rgba(15,23,42,0.42)',
  glassBlur: 0,
  shadowColor: 'rgba(15,23,42,0.12)',
};
