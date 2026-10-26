import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/useTheme';
import { STATUS } from '@/theme/colors';
import { RejectionReason, SyncDisplay } from '@/domain/sync-runner';
import { WarehouseSyncEntry } from '@/sync/warehouse-sync';

const ICON: Record<SyncDisplay, keyof typeof Ionicons.glyphMap> = {
  synced: 'checkmark-circle',
  'catching-up': 'sync',
  offline: 'cloud-offline',
  rejected: 'close-circle',
};

const COLOR: Record<SyncDisplay, string> = {
  synced: STATUS.success,
  'catching-up': '#2E7DFF',
  offline: STATUS.warning,
  rejected: STATUS.error,
};

const REASON_KEY: Record<RejectionReason, string> = {
  'insufficient-stock': 'online.sync.rejectedInsufficient',
  'key-reused': 'online.sync.rejectedKeyReused',
  'no-access': 'online.sync.rejectedNoAccess',
};

const clock = (ms: number) => new Date(ms).toLocaleTimeString();

/** One of exactly four states, each with the evidence behind it (time of the last good poll, server revision). */
export function SyncStatusPill({
  status,
  entry,
  onDismiss,
}: {
  status: { display: SyncDisplay; reason: RejectionReason | null };
  entry: WarehouseSyncEntry;
  onDismiss?: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const color = COLOR[status.display];

  let label: string;
  switch (status.display) {
    case 'synced':
      label = entry.lastSuccessAt ? tr('online.sync.syncedAt', { time: clock(entry.lastSuccessAt) }) : tr('online.sync.synced');
      break;
    case 'catching-up':
      label = entry.sync.status !== 'synced' && entry.lastSuccessAt !== null
        ? tr('online.sync.cachedAt', { time: clock(entry.lastSuccessAt) })
        : tr('online.sync.catchingUp');
      break;
    case 'offline':
      label = entry.lastSuccessAt
        ? tr('online.sync.offlineSince', { time: clock(entry.lastSuccessAt) })
        : tr('online.sync.offlineNever');
      break;
    default:
      label = tr('online.sync.rejected');
  }

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={label}
      testID={`sync-status-${status.display}`}
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: color,
        backgroundColor: color + '1A',
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={ICON[status.display]} size={18} color={color} />
        <Text style={{ color, fontWeight: '800', flex: 1 }}>{label}</Text>
        {entry.sync.revision !== null ? (
          <Text style={{ color: t.textMuted, fontSize: 12 }}>
            {tr('online.sync.revision', { revision: entry.sync.revision })}
          </Text>
        ) : null}
      </View>
      {status.reason ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ color: t.textPrimary, fontSize: 13, flex: 1 }}>{tr(REASON_KEY[status.reason])}</Text>
          {onDismiss && status.reason !== 'no-access' ? (
            <Pressable onPress={onDismiss} hitSlop={8}>
              <Text style={{ color, fontWeight: '700', fontSize: 13 }}>{tr('online.sync.dismiss')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
