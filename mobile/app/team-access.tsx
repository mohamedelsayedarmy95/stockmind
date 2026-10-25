import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { PremiumButton } from '@/components/PremiumButton';
import { useTheme } from '@/theme/useTheme';
import { STATUS } from '@/theme/colors';
import { MemberAccess, useMemberAccess, useSetMemberAccess } from '@/query/useTeam';
import { Warehouse } from '@/data/repositories';
import { useWarehouses } from '@/query/useWarehouses';
import {
  AccessProfileInfo, accessErrorKey, Choice, diffAssignments, offeredChoices, profileEffectKeys, toAssignments,
} from '@/domain/capabilities';
import { errorCodeOf, httpStatusOf } from '@/domain/auth-flow';
import { haptics } from '@/lib/haptics';

/**
 * A Staff member's warehouse access (Admin / owner). One row per warehouse: no access, or a profile. Before saving, the screen
 * says in plain words what each chosen profile allows and how many assignments change. Only profiles the server will actually
 * enforce can be chosen; a stale screen (someone else changed this member meanwhile) is refused by the server and reloaded.
 */
export default function TeamAccessScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const { memberId, name } = useLocalSearchParams<{ memberId: string; name?: string }>();
  const { data, isLoading, isError, refetch } = useMemberAccess(memberId);
  const access: MemberAccess | undefined = data;
  const { data: warehouseData } = useWarehouses();
  const warehouses: Warehouse[] = warehouseData ?? [];
  const save = useSetMemberAccess();
  const [desired, setDesired] = useState<Record<string, Choice>>({});
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // A fresh server state replaces any local draft (after a save, or after a conflict).
  useEffect(() => setDesired({}), [access?.version]);

  const profiles: AccessProfileInfo[] = access?.profiles ?? [];
  const changes = useMemo(() => (access ? diffAssignments(access.assignments, desired) : []), [access, desired]);
  const choiceOf = (warehouseId: string): Choice =>
    desired[warehouseId] ?? access?.assignments.find((a) => a.warehouseId === warehouseId)?.profile ?? 'none';

  const onSave = () => {
    if (!access) return;
    setNotice(null);
    save.mutate(
      { memberId: access.memberId, assignments: toAssignments(access.assignments, desired), version: access.version },
      {
        onSuccess: () => {
          void haptics.success();
          setNotice({ kind: 'ok', text: tr('access.saved') });
        },
        onError: (err) => {
          void haptics.error();
          setNotice({ kind: 'error', text: tr(accessErrorKey(httpStatusOf(err), errorCodeOf(err))) });
        },
      },
    );
  };

  const title = name ?? access?.name ?? '';
  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, gap: 14 }}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={tr('access.back')}
            style={{
              width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
              backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder,
            }}
          >
            <Ionicons name="chevron-back" size={22} color={t.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.textPrimary, fontSize: 22, fontWeight: '800' }}>{tr('access.title')}</Text>
            <Text style={{ color: t.textMuted, fontSize: 12 }} numberOfLines={1}>{title}</Text>
          </View>
        </View>

        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={t.textMuted} />
        ) : isError || !access ? (
          <View style={{ padding: 24, gap: 12, alignItems: 'center' }}>
            <Text style={{ color: t.textMuted, textAlign: 'center' }}>{tr('access.loadError')}</Text>
            <Pressable onPress={() => void refetch()}>
              <Text style={{ color: t.textPrimary, fontWeight: '700' }}>{tr('team.retry')}</Text>
            </Pressable>
          </View>
        ) : !access.applicable ? (
          <Text testID="access-not-applicable" style={{ color: t.textMuted, textAlign: 'center', padding: 30 }}>
            {tr(access.status === 'removed' ? 'access.error.inactive' : 'access.allWarehouses')}
          </Text>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 12 }}>
            {notice ? (
              <Text testID="access-notice" style={{ color: notice.kind === 'ok' ? STATUS.success : STATUS.error, fontSize: 13 }}>
                {notice.text}
              </Text>
            ) : null}

            <GlassCard style={{ gap: 8 }}>
              <Text style={{ color: t.textSecondary, fontWeight: '700' }}>{tr('access.whatItMeans')}</Text>
              {profiles.map((p) => (
                <View key={p.key} style={{ gap: 2 }}>
                  <Text style={{ color: t.textPrimary, fontWeight: '700' }}>
                    {tr(p.labelKey)}
                    {p.available ? '' : `  · ${tr('access.notActive')}`}
                  </Text>
                  {profileEffectKeys(p.capabilities).map((k) => (
                    <Text key={k} style={{ color: t.textMuted, fontSize: 12 }}>• {tr(k)}</Text>
                  ))}
                </View>
              ))}
              <Text style={{ color: t.textMuted, fontSize: 12 }}>{tr('access.noMoney')}</Text>
            </GlassCard>

            {warehouses.map((w) => (
              <GlassCard key={w.id} testID={`access-row-${w.id}`} style={{ gap: 10 }}>
                <Text style={{ color: t.textPrimary, fontWeight: '700', fontSize: 16 }} numberOfLines={1}>{w.name}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {offeredChoices(profiles).map((c) => {
                    const selected = choiceOf(w.id) === c.key;
                    return (
                      <Pressable
                        key={c.key}
                        testID={`access-choice-${w.id}-${c.key}`}
                        disabled={!c.available}
                        onPress={() => { void haptics.select(); setDesired((d) => ({ ...d, [w.id]: c.key })); }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected, disabled: !c.available }}
                        style={{
                          paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1,
                          borderColor: selected ? STATUS.success : t.cardBorder,
                          backgroundColor: selected ? t.card : 'transparent', opacity: c.available ? 1 : 0.4,
                        }}
                      >
                        <Text style={{ color: t.textPrimary, fontSize: 13, fontWeight: selected ? '700' : '500' }}>{tr(c.labelKey)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </GlassCard>
            ))}

            <Text testID="access-summary" style={{ color: t.textMuted, fontSize: 12 }}>
              {changes.length ? tr('access.pending', { count: changes.length }) : tr('access.noChanges')}
            </Text>
            <PremiumButton label={tr('common.save')} onPress={onSave} loading={save.isPending} disabled={changes.length === 0} />
          </ScrollView>
        )}
      </SafeAreaView>
    </ScreenBackground>
  );
}
