import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  Alert, RefreshControl, ActivityIndicator, TextInput, Switch,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';

// ─── Data ─────────────────────────────────────────────────────────────────────

async function fetchCoachClients(userId) {
  const { data, error } = await supabase
    .from('coach_clients')
    .select('id, coach_id, client_id, invite_code, status, created_at')
    .eq('coach_id', userId)
    .neq('status', 'removed')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const activeIds = rows.filter(r => r.status === 'active' && r.client_id).map(r => r.client_id);
  let profileMap = {};
  if (activeIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, goal')
      .in('id', activeIds);
    (profiles ?? []).forEach(p => { profileMap[p.id] = p; });
  }
  return rows.map(r => ({ ...r, client: profileMap[r.client_id] ?? null }));
}

// ─── Shared section label ─────────────────────────────────────────────────────

function SectionLabel({ title, colors }) {
  return (
    <Text style={{
      fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted,
      textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
    }}>
      {title}
    </Text>
  );
}

// ─── Invite code overlay ──────────────────────────────────────────────────────

function InviteOverlay({ code, onClose, colors }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <View style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', zIndex: 999,
    }}>
      <View style={{
        backgroundColor: colors.bgCard, borderRadius: 24, padding: 28,
        width: '85%', borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 16,
      }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent + '22', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="link" size={26} color={colors.accent} />
        </View>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' }}>Invite Code</Text>
          <Text style={{ fontSize: 34, fontWeight: weight.bold, color: colors.accent, letterSpacing: 8 }}>{code}</Text>
          <Text style={{ fontSize: typography.xs, color: colors.textDim, textAlign: 'center', lineHeight: 18 }}>
            Share this with your client.{'\n'}It expires once used.
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleCopy}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: copied ? '#34d399' + '22' : colors.accent + '22',
            borderWidth: 1, borderColor: copied ? '#34d399' : colors.accent,
            paddingHorizontal: 24, paddingVertical: 11, borderRadius: 14, width: '100%', justifyContent: 'center',
          }}
        >
          <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={18} color={copied ? '#34d399' : colors.accent} />
          <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: copied ? '#34d399' : colors.accent }}>
            {copied ? 'Copied!' : 'Copy Code'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={{ paddingVertical: 8 }}>
          <Text style={{ fontSize: typography.sm, color: colors.textDim }}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Client card ──────────────────────────────────────────────────────────────

function ClientCard({ link, onViewStats, onRemove, colors }) {
  const client = link.client;
  const name = client?.full_name ?? 'Client';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return (
    <View style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: colors.border, marginBottom: 10, overflow: 'hidden' }}>
      <View style={{ height: 3, backgroundColor: colors.accent + '66' }} />
      <View style={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: colors.accent + '28', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.accent + '44' }}>
            <Text style={{ fontSize: typography.lg, fontWeight: weight.bold, color: colors.accent }}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: typography.base, fontWeight: weight.bold, color: colors.text }}>{name}</Text>
            {client?.goal && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                <Ionicons name="flag-outline" size={11} color={colors.textDim} />
                <Text style={{ fontSize: 11, color: colors.textDim }}>{client.goal}</Text>
              </View>
            )}
          </View>
          <View style={{ backgroundColor: '#34d399' + '22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#34d399' }} />
            <Text style={{ fontSize: 10, color: '#34d399', fontWeight: weight.bold }}>Active</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={onViewStats} style={{ flex: 1, backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Ionicons name="bar-chart-outline" size={15} color={colors.bg} />
            <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.bg }}>View Stats</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onRemove} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.danger + '15', borderWidth: 1, borderColor: colors.danger + '40', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Ionicons name="person-remove-outline" size={15} color={colors.danger} />
            <Text style={{ fontSize: typography.sm, color: colors.danger, fontWeight: weight.medium }}>Remove</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Coach tab ────────────────────────────────────────────────────────────────

function CoachTab({ userId, colors }) {
  const navigation = useNavigation();
  const qc = useQueryClient();
  const [inviteCode, setInviteCode] = useState(null);

  const { data: clientLinks = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['coachClients', userId],
    queryFn: () => fetchCoachClients(userId),
    enabled: !!userId, staleTime: 0, gcTime: 0,
  });

  const pending = clientLinks.filter(l => l.status === 'pending');
  const active  = clientLinks.filter(l => l.status === 'active');

  const generateMut = useMutation({
    mutationFn: () => supabase.rpc('generate_coach_invite', { p_coach_id: userId }).then(r => { if (r.error) throw r.error; return r.data; }),
    onSuccess: code => { setInviteCode(code); qc.invalidateQueries({ queryKey: ['coachClients', userId] }); },
    onError: e => Alert.alert('Error', e.message),
  });

  const removeMut = useMutation({
    mutationFn: id => supabase.from('coach_clients').update({ status: 'removed' }).eq('id', id).then(r => { if (r.error) throw r.error; }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coachClients', userId] }),
    onError: e => Alert.alert('Error', e.message),
  });

  const handleRemove = link => {
    const label = link.status === 'active' ? (link.client?.full_name ?? 'this client') : 'this invite';
    Alert.alert('Confirm', `Remove ${label}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMut.mutate(link.id) },
    ]);
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 50 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} colors={[colors.accent]} />}
    >
      {/* Generate Invite */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 18, marginBottom: 20 }}>
        <SectionLabel title="Invite a Client" colors={colors} />
        <Text style={{ fontSize: typography.sm, color: colors.textDim, lineHeight: 20, marginBottom: 14 }}>
          Generate a unique code and share it with your client. They go to Coach Mode → Join a Coach to enter it.
        </Text>
        <TouchableOpacity
          onPress={() => generateMut.mutate()}
          disabled={generateMut.isPending}
          style={{ backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: generateMut.isPending ? 0.7 : 1 }}
        >
          {generateMut.isPending ? <ActivityIndicator size="small" color={colors.bg} /> : <Ionicons name="add-circle-outline" size={18} color={colors.bg} />}
          <Text style={{ fontSize: typography.base, fontWeight: weight.bold, color: colors.bg }}>Generate New Invite Code</Text>
        </TouchableOpacity>
      </View>

      {/* Pending */}
      {pending.length > 0 && (
        <>
          <SectionLabel title={`Pending Invites (${pending.length})`} colors={colors} />
          {pending.map(link => (
            <View key={link.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: '#fbbf24', padding: 12, marginBottom: 8, gap: 10 }}>
              <Ionicons name="time-outline" size={18} color="#fbbf24" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: colors.textDim, marginBottom: 2 }}>Awaiting client</Text>
                <Text style={{ fontWeight: weight.bold, color: colors.text, letterSpacing: 2, fontSize: typography.sm }}>{link.invite_code}</Text>
              </View>
              <TouchableOpacity onPress={() => handleRemove(link)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.danger + '15', borderWidth: 1, borderColor: colors.danger + '44' }}>
                <Text style={{ fontSize: 11, color: colors.danger, fontWeight: weight.semibold }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ))}
          <View style={{ height: 10 }} />
        </>
      )}

      {/* Active Clients */}
      <SectionLabel title={`Active Clients (${active.length})`} colors={colors} />
      {isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginVertical: 20 }} />
      ) : active.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 40, gap: 12, backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' }}>
          <Ionicons name="people-outline" size={40} color={colors.textDim} />
          <Text style={{ fontSize: typography.sm, color: colors.textDim, textAlign: 'center', lineHeight: 20 }}>
            No active clients yet.{'\n'}Generate an invite code above to get started.
          </Text>
        </View>
      ) : (
        active.map(link => (
          <ClientCard
            key={link.id}
            link={link}
            onViewStats={() => navigation.navigate('ClientDetail', { clientId: link.client?.id, clientName: link.client?.full_name ?? 'Client' })}
            onRemove={() => handleRemove(link)}
            colors={colors}
          />
        ))
      )}

      {inviteCode && <InviteOverlay code={inviteCode} onClose={() => setInviteCode(null)} colors={colors} />}
    </ScrollView>
  );
}

// ─── Client tab ───────────────────────────────────────────────────────────────

const PRIVACY_ITEMS = [
  { key: 'workouts', label: 'Workouts & Sets',  icon: 'barbell-outline',    desc: 'Sessions, exercises, sets, reps, RPE' },
  { key: 'weight',   label: 'Body Weight',       icon: 'scale-outline',      desc: 'Weight logs & trend chart' },
  { key: 'steps',    label: 'Steps & Activity',  icon: 'footsteps-outline',  desc: 'Daily step counts' },
  { key: 'sleep',    label: 'Sleep',             icon: 'moon-outline',       desc: 'Hours slept & sleep quality' },
  { key: 'food',     label: 'Nutrition',         icon: 'restaurant-outline', desc: 'Calories & macro breakdown' },
];

const DEFAULT_VIS = { workouts: true, weight: true, steps: true, sleep: true, food: true };

function ClientTab({ userId, colors }) {
  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [visibility, setVisibility] = useState(DEFAULT_VIS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('coach_visibility').eq('id', userId).single()
      .then(({ data }) => {
        if (data?.coach_visibility) setVisibility({ ...DEFAULT_VIS, ...data.coach_visibility });
        setLoaded(true);
      });
  }, [userId]);

  const handleToggle = async (key, val) => {
    const next = { ...visibility, [key]: val };
    setVisibility(next);
    setSaving(true);
    await supabase.from('profiles').update({ coach_visibility: next }).eq('id', userId);
    setSaving(false);
  };

  const handleJoin = async () => {
    const code = inviteCode.trim().toUpperCase();
    if (!code) return;
    setJoining(true);
    try {
      const { data, error } = await supabase.rpc('accept_coach_invite', { p_code: code });
      if (error) throw error;
      if (data) { setInviteCode(''); Alert.alert('Connected!', 'You are now linked to your coach.'); }
      else Alert.alert('Invalid Code', 'This code is invalid or has already been used.');
    } catch (e) { Alert.alert('Error', e.message); }
    finally { setJoining(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 50 }}>
      {/* Join a Coach */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 18, marginBottom: 20 }}>
        <SectionLabel title="Join a Coach" colors={colors} />
        <Text style={{ fontSize: typography.sm, color: colors.textDim, lineHeight: 20, marginBottom: 14 }}>
          Enter the 8-character invite code your coach shared with you.
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextInput
            style={{
              flex: 1, backgroundColor: colors.bgElevated, color: colors.text,
              borderRadius: 12, borderWidth: 1, borderColor: colors.border,
              paddingHorizontal: 14, paddingVertical: 11, fontSize: 16,
              fontWeight: weight.bold, letterSpacing: 3,
            }}
            placeholder="XXXXXXXX"
            placeholderTextColor={colors.textDim}
            value={inviteCode}
            onChangeText={v => setInviteCode(v.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
          />
          <TouchableOpacity
            onPress={handleJoin}
            disabled={joining || !inviteCode.trim()}
            style={{
              backgroundColor: colors.accent, borderRadius: 12,
              paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center',
              opacity: (!inviteCode.trim() || joining) ? 0.5 : 1,
            }}
          >
            {joining
              ? <ActivityIndicator size="small" color={colors.bg} />
              : <Text style={{ color: colors.bg, fontWeight: weight.bold, fontSize: 15 }}>Join</Text>
            }
          </TouchableOpacity>
        </View>
      </View>

      {/* Privacy Controls */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
        <View style={{ padding: 18, paddingBottom: 10 }}>
          <SectionLabel title="What Your Coach Can See" colors={colors} />
          <Text style={{ fontSize: typography.sm, color: colors.textDim, lineHeight: 20 }}>
            Toggle off any category to hide it from your coach. They'll see a locked placeholder instead.
          </Text>
          {saving && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={{ fontSize: 11, color: colors.textDim }}>Saving…</Text>
            </View>
          )}
        </View>

        {PRIVACY_ITEMS.map(({ key, label, icon, desc }, i) => (
          <View
            key={key}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              paddingHorizontal: 18, paddingVertical: 14,
              borderTopWidth: 1, borderTopColor: colors.border,
            }}
          >
            <View style={{
              width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              backgroundColor: visibility[key] ? colors.accent + '20' : colors.bgElevated,
            }}>
              <Ionicons name={icon} size={18} color={visibility[key] ? colors.accent : colors.textDim} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: typography.sm, fontWeight: weight.semibold, color: visibility[key] ? colors.text : colors.textDim }}>
                  {label}
                </Text>
                {!visibility[key] && <Ionicons name="lock-closed" size={12} color={colors.textDim} />}
              </View>
              <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>{desc}</Text>
            </View>
            <Switch
              value={!!visibility[key]}
              onValueChange={v => handleToggle(key, v)}
              trackColor={{ false: colors.bgElevated, true: colors.accent + '88' }}
              thumbColor={visibility[key] ? colors.accent : colors.textDim}
              ios_backgroundColor={colors.bgElevated}
              disabled={!loaded}
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function CoachScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const navigation = useNavigation();
  const [tab, setTab] = useState('coach');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 6, paddingBottom: 4, gap: 12 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={{ flex: 1, fontSize: typography.xl, fontWeight: weight.bold, color: colors.text }}>Coach Mode</Text>
        <Ionicons name="people" size={22} color={colors.accent} />
      </View>

      {/* Tab switcher */}
      <View style={{ flexDirection: 'row', marginHorizontal: 16, marginTop: 10, marginBottom: 6, backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 4, gap: 4 }}>
        {[
          { key: 'coach', label: 'I\'m a Coach', icon: 'people' },
          { key: 'client', label: 'I\'m a Client', icon: 'person' },
        ].map(t => (
          <TouchableOpacity
            key={t.key}
            onPress={() => setTab(t.key)}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 6, paddingVertical: 9, borderRadius: 10,
              backgroundColor: tab === t.key ? colors.accent : 'transparent',
            }}
          >
            <Ionicons name={t.icon} size={15} color={tab === t.key ? colors.bg : colors.textMuted} />
            <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: tab === t.key ? colors.bg : colors.textMuted }}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'coach'
        ? <CoachTab userId={user?.id} colors={colors} />
        : <ClientTab userId={user?.id} colors={colors} />
      }
    </SafeAreaView>
  );
}
