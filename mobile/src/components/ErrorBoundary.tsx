import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PremiumButton } from './PremiumButton';
import { captureException } from '@/lib/crash-reporting';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort catch for render-time crashes in production, where there's no
 * dev LogBox to fall back on — without this a crash is a blank/black screen.
 * Persists to the local crash log and offers a restart instead of a dead app.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    void captureException(error, { fatal: true });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#0A0E17',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          gap: 16,
        }}
      >
        <Ionicons name="alert-circle" size={56} color="#EF4444" />
        <Text style={{ color: '#F8FAFC', fontSize: 18, fontWeight: '800', textAlign: 'center' }}>
          Something went wrong
        </Text>
        <Text style={{ color: 'rgba(248,250,252,0.6)', textAlign: 'center' }}>
          The app hit an unexpected error. It's been reported — try restarting.
        </Text>
        <PremiumButton label="Try again" onPress={() => this.setState({ error: null })} style={{ marginTop: 8 }} />
      </View>
    );
  }
}
