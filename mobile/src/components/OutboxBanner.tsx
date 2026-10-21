import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { STATUS } from '@/theme/colors';
import { useCurrentScopeKey } from '@/sync/account-scope';
import { openIntents, useOutboxStore } from '@/sync/outbox-store';

/** "N actions waiting to send" for the signed-in account; red when some need the user's review. Hidden when none. */
export function OutboxBanner() {
  const { t: tr } = useTranslation();
  const router = useRouter();
  const scope = useCurrentScopeKey();
  const intents = useOutboxStore((s) => s.intents);
  const open = openIntents(intents, scope);
  if (open.length === 0) return null;

  const review = open.filter((i) => i.state === 'REJECTED' || i.state === 'NEEDS_REVIEW').length;
  const color = review > 0 ? STATUS.error : STATUS.warning;
  return (
    <Pressable
      testID="outbox-banner"
      onPress={() => router.push('/outbox')}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: color,
        backgroundColor: color + '1A',
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <Ionicons name={review > 0 ? 'alert-circle' : 'time-outline'} size={18} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={{ color, fontWeight: '800' }}>
          {review > 0
            ? tr('online.outbox.bannerReview', { count: review })
            : tr('online.outbox.banner', { count: open.length })}
        </Text>
      </View>
      <Text style={{ color, fontWeight: '700', fontSize: 13 }}>{tr('online.outbox.review')}</Text>
    </Pressable>
  );
}
