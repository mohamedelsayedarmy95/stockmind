import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '@/components/ScreenBackground';
import { PremiumButton } from '@/components/PremiumButton';
import { useTheme } from '@/theme/useTheme';
import { useCreateWarehouse } from '@/query/useWarehouses';
import { haptics } from '@/lib/haptics';
import { activeSource } from '@/data/repository-provider';
import { useCan } from '@/query/useCapabilities';
import { useAccessProfiles, useTeamMembers } from '@/query/useTeam';
import { CAP, Choice, offeredChoices, accessErrorKey } from '@/domain/capabilities';
import { errorCodeOf, httpStatusOf } from '@/domain/auth-flow';
import { TeamMember } from '@/domain/team-actions';

/** Add a warehouse to the local (offline) inventory. */
export default function NewWarehouseScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const router = useRouter();
  const createWarehouse = useCreateWarehouse();
  const [name, setName] = useState('');
  // CP-4: online, a new warehouse is visible to owners and managers only. Whoever may manage team access can decide NOW who else
  // gets it (default: nobody); anyone else is told plainly that an administrator has to.
  const online = activeSource() === 'online';
  const can = useCan();
  const mayAssign = online && can(CAP.MANAGE_USERS);
  const { data: memberData } = useTeamMembers(mayAssign);
  const members: TeamMember[] = memberData ?? [];
  const { data: profileData } = useAccessProfiles(mayAssign);
  const [picked, setPicked] = useState<Record<string, Choice>>({});
  const [error, setError] = useState<string | null>(null);
  const staff = members.filter((m) => m.role === 'Staff' && m.status === 'active');

  const submit = () => {
    setError(null);
    const initialAccess = mayAssign
      ? Object.entries(picked).filter(([, p]) => p !== 'none').map(([userId, profile]) => ({ userId, profile }))
      : undefined;
    createWarehouse.mutate(
      { name: name.trim(), ...(initialAccess?.length ? { initialAccess } : {}) },
      {
        onSuccess: () => {
          void haptics.success();
          router.back();
        },
        onError: (err) => {
          void haptics.error();
          setError(tr(accessErrorKey(httpStatusOf(err), errorCodeOf(err))));
        },
      },
    );
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="chevron-back" size={26} color={t.textPrimary} />
            </Pressable>
            <Text style={{ color: t.textPrimary, fontSize: 24, fontWeight: '800' }}>
              {tr('warehouse.addTitle')}
            </Text>
          </View>

          <View style={{ gap: 14 }}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={tr('warehouse.name')}
              placeholderTextColor={t.textMuted}
              autoCapitalize="words"
              style={{
                color: t.textPrimary,
                backgroundColor: t.card,
                borderWidth: 1,
                borderColor: t.cardBorder,
                borderRadius: 18,
                paddingHorizontal: 16,
                paddingVertical: 16,
                fontSize: 16,
              }}
            />
            {online && !mayAssign ? (
              <Text testID="cp4-guidance" style={{ color: t.textMuted, fontSize: 13 }}>{tr('access.cp4.guidance')}</Text>
            ) : null}
            {mayAssign ? (
              <View testID="cp4-assign" style={{ gap: 10 }}>
                <Text style={{ color: t.textSecondary, fontWeight: '700' }}>{tr('access.cp4.title')}</Text>
                <Text style={{ color: t.textMuted, fontSize: 12 }}>{tr('access.cp4.hint')}</Text>
                {staff.map((m) => (
                  <View key={m.id} style={{ gap: 6 }}>
                    <Text style={{ color: t.textPrimary }} numberOfLines={1}>{m.name}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {offeredChoices(profileData?.profiles ?? []).map((c) => {
                        const selected = (picked[m.id] ?? 'none') === c.key;
                        return (
                          <Pressable
                            key={c.key}
                            disabled={!c.available}
                            accessibilityRole="radio"
                            accessibilityState={{ selected, disabled: !c.available }}
                            onPress={() => setPicked((p) => ({ ...p, [m.id]: c.key }))}
                            style={{
                              paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1,
                              borderColor: selected ? '#10B981' : t.cardBorder, opacity: c.available ? 1 : 0.4,
                            }}
                          >
                            <Text style={{ color: t.textPrimary, fontSize: 13, fontWeight: selected ? '700' : '500' }}>{tr(c.labelKey)}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
            {error ? <Text testID="warehouse-error" style={{ color: '#EF4444', fontSize: 13 }}>{error}</Text> : null}
            <PremiumButton
              label={tr('warehouse.save')}
              onPress={submit}
              loading={createWarehouse.isPending}
              disabled={name.trim().length === 0}
              style={{ marginTop: 8 }}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}
