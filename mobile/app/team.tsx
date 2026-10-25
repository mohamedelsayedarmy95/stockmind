import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { GlassCard } from '@/components/GlassCard';
import { useTheme } from '@/theme/useTheme';
import { STATUS } from '@/theme/colors';
import { useAuthStore } from '@/store/auth.store';
import { useMembershipAction, useTeamMembers } from '@/query/useTeam';
import { errorCodeOf, httpStatusOf } from '@/domain/auth-flow';
import {
  activeOwnerCount, availableActions, MemberRole, roleChoices, TeamAction, TeamMember, teamErrorKey, visibleMembers,
} from '@/domain/team-actions';
import { haptics } from '@/lib/haptics';

const STATUS_COLOR = { active: STATUS.success, suspended: STATUS.warning, removed: STATUS.error } as const;

/**
 * Team (Admin only): who has access to the company, and the calm, explicit controls to change it. Suspending or removing a
 * member ends their access on their very next request; the screen says so. Every destructive step asks first, says what
 * will happen, and the server refuses anything the policy does not allow (owner protection, no self-lockout).
 */
export default function TeamScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const me = useAuthStore((s) => s.user);
  const { data, isLoading, isError, refetch, isRefetching } = useTeamMembers();
  const act = useMembershipAction();
  const [showRemoved, setShowRemoved] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const members: TeamMember[] = data ?? [];
  const viewer = useMemo(() => {
    const self = members.find((m) => m.id === me?.id);
    return { id: me?.id ?? '', isOwner: self?.isOwner ?? false };
  }, [members, me?.id]);
  const owners = activeOwnerCount(members);
  const hasRemoved = members.some((m) => m.status === 'removed');

  const run = (member: TeamMember, action: TeamAction, extra: { role?: MemberRole; ack?: boolean } = {}) => {
    setNotice(null);
    act.mutate(
      { id: member.id, action, role: extra.role, acknowledgeCompanyWideAccess: extra.ack },
      {
        onSuccess: () => {
          void haptics.success();
          setNotice({ kind: 'ok', text: tr(`team.done.${action}`, { name: member.name }) });
        },
        onError: (err) => {
          void haptics.error();
          setNotice({ kind: 'error', text: tr(teamErrorKey(httpStatusOf(err), errorCodeOf(err))) });
        },
      },
    );
  };

  const confirm = (member: TeamMember, action: Exclude<TeamAction, 'reactivate' | 'change_role' | 'manage_access'>) =>
    Alert.alert(tr(`team.confirm.${action}.title`, { name: member.name }), tr(`team.confirm.${action}.body`, { name: member.name }), [
      { text: tr('common.cancel'), style: 'cancel' },
      { text: tr(`team.action.${action}`), style: action === 'revoke_sessions' ? 'default' : 'destructive', onPress: () => run(member, action) },
    ]);

  const chooseRole = (member: TeamMember) => {
    const choices = roleChoices(viewer, member);
    if (!choices.length) return;
    Alert.alert(
      tr('team.changeRole.title', { name: member.name }),
      tr('team.changeRole.body', { role: tr(`team.role.${member.role}`) }),
      [
        ...choices.map((c) => ({
          text: tr(`team.role.${c.role}`),
          onPress: () => {
            if (!c.needsAcknowledgement) return run(member, 'change_role', { role: c.role });
            // Company-wide access is never granted by a single tap: say what it means and ask again.
            Alert.alert(tr('team.ack.title'), tr('team.ack.body', { name: member.name, role: tr(`team.role.${c.role}`) }), [
              { text: tr('common.cancel'), style: 'cancel' },
              { text: tr('team.ack.confirm'), onPress: () => run(member, 'change_role', { role: c.role, ack: true }) },
            ]);
          },
        })),
        { text: tr('common.cancel'), style: 'cancel' as const },
      ],
    );
  };

  const onAction = (member: TeamMember, action: TeamAction) => {
    void haptics.select();
    if (action === 'manage_access') return router.push({ pathname: '/team-access', params: { memberId: member.id, name: member.name } });
    if (action === 'change_role') return chooseRole(member);
    if (action === 'reactivate') return run(member, 'reactivate');
    return confirm(member, action);
  };

  const rows = visibleMembers(members, showRemoved);

  const Row = ({ member }: { member: TeamMember }) => {
    const actions = availableActions(viewer, member, owners);
    return (
      <GlassCard testID={`team-member-${member.id}`} style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.textPrimary, fontWeight: '700', fontSize: 16 }} numberOfLines={1}>
              {member.name}
              {member.id === me?.id ? `  · ${tr('team.you')}` : ''}
            </Text>
            <Text style={{ color: t.textMuted, fontSize: 12 }} numberOfLines={1}>{member.email}</Text>
          </View>
          <Text testID={`team-status-${member.id}`} style={{ color: STATUS_COLOR[member.status], fontWeight: '700', fontSize: 12 }}>
            {tr(`team.status.${member.status}`)}
          </Text>
        </View>
        <Text style={{ color: t.textSecondary, fontSize: 13 }}>
          {tr(`team.role.${member.role}`)}
          {member.isOwner ? ` · ${tr('team.owner')}` : ''}
        </Text>
        {member.status !== 'active' ? (
          <Text style={{ color: t.textMuted, fontSize: 12 }}>{tr(`team.status.${member.status}Hint`)}</Text>
        ) : null}
        {actions.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
            {actions.map((a) => (
              <Pressable
                key={a}
                testID={`team-action-${a}-${member.id}`}
                disabled={act.isPending}
                onPress={() => onAction(member, a)}
                style={{
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1,
                  borderColor: a === 'suspend' || a === 'remove' ? STATUS.error : t.cardBorder,
                  backgroundColor: t.card, opacity: act.isPending ? 0.5 : 1,
                }}
              >
                <Text style={{ color: a === 'suspend' || a === 'remove' ? STATUS.error : t.textPrimary, fontWeight: '600', fontSize: 13 }}>
                  {tr(`team.action.${a}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </GlassCard>
    );
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, gap: 14 }}>
          <Pressable
            onPress={() => router.back()}
            style={{
              width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
              backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder,
            }}
          >
            <Ionicons name="chevron-back" size={22} color={t.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.textPrimary, fontSize: 22, fontWeight: '800' }}>{tr('team.title')}</Text>
            <Text style={{ color: t.textMuted, fontSize: 12 }}>{tr('team.subtitle')}</Text>
          </View>
        </View>

        {notice ? (
          <Text
            testID="team-notice"
            style={{ color: notice.kind === 'ok' ? STATUS.success : STATUS.error, paddingHorizontal: 20, paddingBottom: 8, fontSize: 13 }}
          >
            {notice.text}
          </Text>
        ) : null}

        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={t.textMuted} />
        ) : isError ? (
          <View style={{ padding: 24, gap: 12, alignItems: 'center' }}>
            <Text style={{ color: t.textMuted, textAlign: 'center' }}>{tr('team.loadError')}</Text>
            <Pressable onPress={() => void refetch()}>
              <Text style={{ color: t.textPrimary, fontWeight: '700' }}>{tr('team.retry')}</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <Row member={item} />}
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 10, flexGrow: 1 }}
            ListFooterComponent={
              hasRemoved ? (
                <Pressable testID="team-toggle-removed" onPress={() => setShowRemoved((v) => !v)} style={{ paddingVertical: 12 }}>
                  <Text style={{ color: t.textMuted, textAlign: 'center', fontSize: 13 }}>
                    {tr(showRemoved ? 'team.hideRemoved' : 'team.showRemoved')}
                  </Text>
                </Pressable>
              ) : null
            }
          />
        )}
      </SafeAreaView>
    </ScreenBackground>
  );
}
