import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  Alert, RefreshControl, ActivityIndicator, TextInput, Switch,
} from 'react-native';
let Clipboard = null;
try { Clipboard = require('expo-clipboard'); } catch (_) {}
const copyToClipboard = (text) => {
  if (Clipboard?.setStringAsync) return Clipboard.setStringAsync(text);
  if (Clipboard?.setString) { Clipboard.setString(text); return Promise.resolve(); }
  return Promise.resolve();
};
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
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
    await copyToClipboard(code);
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
    <View style={{
      backgroundColor: colors.bgCard, borderRadius: 14,
      borderWidth: 1, borderColor: colors.border,
      marginBottom: 8, flexDirection: 'row', alignItems: 'center',
      paddingVertical: 10, paddingHorizontal: 12, gap: 10,
    }}>
      <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent + '22', borderWidth: 1.5, borderColor: colors.accent + '44', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 13, fontWeight: weight.bold, color: colors.accent }}>{initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.text }}>{name}</Text>
        {client?.goal && (
          <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>{client.goal}</Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <TouchableOpacity onPress={onViewStats} style={{ backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Ionicons name="bar-chart-outline" size={13} color={colors.bg} />
          <Text style={{ fontSize: 12, fontWeight: weight.bold, color: colors.bg }}>Stats</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onRemove} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.danger + '12', borderWidth: 1, borderColor: colors.danger + '40', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="person-remove-outline" size={14} color={colors.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Coach tab ────────────────────────────────────────────────────────────────

const SPECIALTIES = ['Strength', 'Weight Loss', 'Muscle Gain', 'Cardio', 'Flexibility', 'Nutrition', 'Athletic Performance', 'Rehabilitation'];

function CoachProfileCard({ userId, colors }) {
  const [profile, setProfile] = useState({ full_name: '', bio: '', goal: '' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ full_name: '', bio: '', goal: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('full_name, bio, goal').eq('id', userId).single()
      .then(({ data }) => {
        if (data) {
          const p = { full_name: data.full_name ?? '', bio: data.bio ?? '', goal: data.goal ?? '' };
          setProfile(p);
          setDraft(p);
        }
      });
  }, [userId]);

  const handleSave = async () => {
    setSaving(true);
    await supabase.from('profiles').update({ full_name: draft.full_name, bio: draft.bio, goal: draft.goal }).eq('id', userId);
    setProfile(draft);
    setSaving(false);
    setEditing(false);
  };

  const handleCancel = () => { setDraft(profile); setEditing(false); };

  const initials = (profile.full_name || '?').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <View style={{ backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 14 }}>
      <View style={{ height: 3, backgroundColor: colors.accent }} />
      <View style={{ padding: 12, gap: editing ? 12 : 0 }}>
        {/* Header row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accent + '22', borderWidth: 1.5, borderColor: colors.accent + '55', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 15, fontWeight: weight.black, color: colors.accent }}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.text }}>{profile.full_name || 'Your Name'}</Text>
            <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>
              {profile.goal ? profile.goal : 'No specialty set'}
              {profile.bio ? ` · ${profile.bio.slice(0, 30)}${profile.bio.length > 30 ? '…' : ''}` : ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => editing ? handleCancel() : setEditing(true)}
            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, backgroundColor: editing ? colors.bgElevated : colors.accent + '18', borderWidth: 1, borderColor: editing ? colors.border : colors.accent + '40' }}
          >
            <Text style={{ fontSize: 12, fontWeight: weight.bold, color: editing ? colors.textDim : colors.accent }}>
              {editing ? 'Cancel' : 'Edit'}
            </Text>
          </TouchableOpacity>
        </View>

        {editing ? (
          <View style={{ gap: 10 }}>
            {/* Name */}
            <View>
              <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, marginBottom: 5, letterSpacing: 0.5 }}>DISPLAY NAME</Text>
              <TextInput
                value={draft.full_name}
                onChangeText={v => setDraft(d => ({ ...d, full_name: v }))}
                placeholder="Your name"
                placeholderTextColor={colors.textDim}
                style={{ backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1.5, borderColor: colors.accent + '50', paddingHorizontal: 14, paddingVertical: 11, fontSize: typography.sm, color: colors.text }}
              />
            </View>

            {/* Bio */}
            <View>
              <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, marginBottom: 5, letterSpacing: 0.5 }}>BIO / INTRO</Text>
              <TextInput
                value={draft.bio}
                onChangeText={v => setDraft(d => ({ ...d, bio: v }))}
                placeholder="Tell your clients about yourself…"
                placeholderTextColor={colors.textDim}
                multiline
                numberOfLines={3}
                style={{ backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1.5, borderColor: colors.accent + '50', paddingHorizontal: 14, paddingVertical: 11, fontSize: typography.sm, color: colors.text, minHeight: 80, textAlignVertical: 'top' }}
              />
            </View>

            {/* Specialty chips */}
            <View>
              <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, marginBottom: 8, letterSpacing: 0.5 }}>SPECIALTY</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                {SPECIALTIES.map(s => {
                  const sel = draft.goal === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      onPress={() => setDraft(d => ({ ...d, goal: sel ? '' : s }))}
                      style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: sel ? colors.accent : colors.bgElevated, borderWidth: 1.5, borderColor: sel ? colors.accent : colors.border }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: weight.semibold, color: sel ? colors.bg : colors.textDim }}>{s}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Save */}
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={{ backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: saving ? 0.7 : 1, marginTop: 4 }}
            >
              {saving ? <ActivityIndicator size="small" color={colors.bg} /> : <Ionicons name="checkmark-circle" size={17} color={colors.bg} />}
              <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.bg }}>Save Profile</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}

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
      {/* Coach Profile */}
      <CoachProfileCard userId={userId} colors={colors} />

      {/* Generate Invite */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.text }}>Invite a Client</Text>
          <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>Share a unique code — expires once used</Text>
        </View>
        <TouchableOpacity
          onPress={() => generateMut.mutate()}
          disabled={generateMut.isPending}
          style={{ backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: generateMut.isPending ? 0.7 : 1 }}
        >
          {generateMut.isPending
            ? <ActivityIndicator size="small" color={colors.bg} />
            : <Ionicons name="add-circle-outline" size={15} color={colors.bg} />}
          <Text style={{ fontSize: 13, fontWeight: weight.bold, color: colors.bg }}>Generate</Text>
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

function CoachCard({ coach, linkedSince, colors, onChat, onDisconnect }) {
  const name = coach.full_name ?? 'Coach';
  const initials = name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const memberSince = linkedSince
    ? new Date(linkedSince).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null;

  return (
    <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 20 }}>
      {/* Top accent bar */}
      <View style={{ height: 4, backgroundColor: colors.accent }} />

      <View style={{ padding: 20, gap: 16 }}>
        {/* Coach identity row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{
            width: 64, height: 64, borderRadius: 32,
            backgroundColor: colors.accent + '22',
            borderWidth: 2, borderColor: colors.accent + '55',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 22, fontWeight: weight.black, color: colors.accent }}>{initials}</Text>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ fontSize: typography.lg, fontWeight: weight.bold, color: colors.text }}>{name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#22c55e' }} />
              <Text style={{ fontSize: 12, color: '#22c55e', fontWeight: weight.semibold }}>Your Coach</Text>
            </View>
            {memberSince && (
              <Text style={{ fontSize: 11, color: colors.textDim }}>Connected since {memberSince}</Text>
            )}
          </View>
          <View style={{
            backgroundColor: '#22c55e' + '18', borderRadius: 10,
            paddingHorizontal: 10, paddingVertical: 5,
            borderWidth: 1, borderColor: '#22c55e' + '40',
          }}>
            <Text style={{ fontSize: 10, fontWeight: weight.bold, color: '#22c55e' }}>ACTIVE</Text>
          </View>
        </View>

        {/* Bio */}
        {coach.bio ? (
          <View style={{ backgroundColor: colors.bg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: typography.sm, color: colors.text, lineHeight: 20 }}>"{coach.bio}"</Text>
          </View>
        ) : null}

        {/* Stats row */}
        <View style={{ flexDirection: 'row', gap: 1, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
          {[
            { icon: 'barbell-outline',   label: 'Specialty',   value: coach.goal ?? 'Fitness' },
            { icon: 'body-outline',      label: 'Focus',       value: coach.sex ? (coach.sex === 'male' ? 'Male Coach' : 'Female Coach') : 'General' },
          ].map((item, i) => (
            <View key={i} style={{ flex: 1, backgroundColor: colors.bg, padding: 12, alignItems: 'center', gap: 4, borderRightWidth: i === 0 ? 1 : 0, borderRightColor: colors.border }}>
              <Ionicons name={item.icon} size={16} color={colors.accent} />
              <Text style={{ fontSize: 12, fontWeight: weight.bold, color: colors.text, textAlign: 'center' }}>{item.value}</Text>
              <Text style={{ fontSize: 10, color: colors.textDim }}>{item.label}</Text>
            </View>
          ))}
        </View>

        {/* Actions */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            onPress={onChat}
            style={{ flex: 1, backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}
            activeOpacity={0.8}
          >
            <Ionicons name="chatbubble-ellipses" size={16} color={colors.bg} />
            <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.bg }}>Message Coach</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDisconnect}
            style={{ paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.danger + '12', borderWidth: 1, borderColor: colors.danger + '40', flexDirection: 'row', alignItems: 'center', gap: 5 }}
            activeOpacity={0.8}
          >
            <Ionicons name="unlink-outline" size={15} color={colors.danger} />
            <Text style={{ fontSize: typography.sm, color: colors.danger, fontWeight: weight.medium }}>Leave</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function ClientTab({ userId, colors, isPro }) {
  const navigation = useNavigation();
  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [visibility, setVisibility] = useState(DEFAULT_VIS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeCoach, setActiveCoach] = useState(null);
  const [linkedSince, setLinkedSince] = useState(null);
  const [linkId, setLinkId] = useState(null);

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('coach_visibility').eq('id', userId).single()
      .then(({ data }) => {
        if (data?.coach_visibility) setVisibility({ ...DEFAULT_VIS, ...data.coach_visibility });
        setLoaded(true);
      });
    supabase.from('coach_clients')
      .select('id, coach_id, created_at')
      .eq('client_id', userId).eq('status', 'active').limit(1).single()
      .then(async ({ data }) => {
        if (!data?.coach_id) return;
        setLinkId(data.id);
        setLinkedSince(data.created_at);
        const { data: prof } = await supabase.from('profiles')
          .select('full_name, bio, goal, sex')
          .eq('id', data.coach_id).single();
        setActiveCoach({ coach_id: data.coach_id, ...(prof ?? {}) });
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
      if (data) {
        setInviteCode('');
        Alert.alert('Connected!', 'You are now linked to your coach.');
        // Re-fetch coach details
        const { data: link } = await supabase.from('coach_clients')
          .select('id, coach_id, created_at').eq('client_id', userId).eq('status', 'active').limit(1).single();
        if (link?.coach_id) {
          setLinkId(link.id);
          setLinkedSince(link.created_at);
          const { data: prof } = await supabase.from('profiles')
            .select('full_name, bio, goal, sex').eq('id', link.coach_id).single();
          setActiveCoach({ coach_id: link.coach_id, ...(prof ?? {}) });
        }
      } else {
        Alert.alert('Invalid Code', 'This code is invalid or has already been used.');
      }
    } catch (e) { Alert.alert('Error', e.message); }
    finally { setJoining(false); }
  };

  const handleDisconnect = () => {
    Alert.alert('Leave Coach', 'Are you sure you want to disconnect from your coach?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive', onPress: async () => {
          if (linkId) await supabase.from('coach_clients').update({ status: 'removed' }).eq('id', linkId);
          setActiveCoach(null);
          setLinkedSince(null);
          setLinkId(null);
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>

      {/* Active coach card — shown when connected */}
      {activeCoach ? (
        <CoachCard
          coach={activeCoach}
          linkedSince={linkedSince}
          colors={colors}
          onChat={() => navigation.navigate('CoachChat', {
            coachId: activeCoach.coach_id,
            clientId: userId,
            coachName: activeCoach.full_name ?? 'Coach',
          })}
          onDisconnect={handleDisconnect}
        />
      ) : (
        /* Join a Coach — only shown when not yet connected */
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
      )}

      {/* Privacy Controls */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
        <View style={{ padding: 18, paddingBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Text style={{
              fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted,
              textTransform: 'uppercase', letterSpacing: 1, flex: 1,
            }}>
              What Your Coach Can See
            </Text>
            {!isPro && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accent + '20', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Ionicons name="rocket" size={11} color={colors.accent} />
                <Text style={{ fontSize: 10, fontWeight: weight.bold, color: colors.accent }}>PRO</Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: typography.sm, color: colors.textDim, lineHeight: 20 }}>
            {isPro
              ? "Toggle off any category to hide it from your coach. They'll see a locked placeholder instead."
              : 'Upgrade to Pro to control exactly what your coach can see.'}
          </Text>
          {isPro && saving && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={{ fontSize: 11, color: colors.textDim }}>Saving…</Text>
            </View>
          )}
        </View>

        {PRIVACY_ITEMS.map(({ key, label, icon, desc }) => (
          <View
            key={key}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              paddingHorizontal: 18, paddingVertical: 14,
              borderTopWidth: 1, borderTopColor: colors.border,
              opacity: isPro ? 1 : 0.5,
            }}
          >
            <View style={{
              width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              backgroundColor: (isPro && visibility[key]) ? colors.accent + '20' : colors.bgElevated,
            }}>
              <Ionicons name={isPro ? icon : 'lock-closed'} size={18} color={(isPro && visibility[key]) ? colors.accent : colors.textDim} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text }}>{label}</Text>
              <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>{desc}</Text>
            </View>
            <Switch
              value={isPro ? !!visibility[key] : true}
              onValueChange={v => isPro && handleToggle(key, v)}
              trackColor={{ false: colors.bgElevated, true: colors.accent + '88' }}
              thumbColor={(isPro && visibility[key]) ? colors.accent : colors.textDim}
              ios_backgroundColor={colors.bgElevated}
              disabled={!isPro || !loaded}
            />
          </View>
        ))}

        {!isPro && (
          <TouchableOpacity
            onPress={() => navigation.navigate('Subscription')}
            style={{
              margin: 14, marginTop: 4,
              backgroundColor: colors.accent, borderRadius: 14,
              paddingVertical: 13, flexDirection: 'row',
              alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <Ionicons name="rocket" size={16} color={colors.bg} />
            <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.bg }}>
              Upgrade to Pro to unlock privacy controls
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Disconnect from coach — shown only when connected */}
      {activeCoach && (
        <TouchableOpacity
          onPress={handleDisconnect}
          style={{
            marginTop: 14,
            backgroundColor: colors.danger + '10',
            borderRadius: 16, borderWidth: 1, borderColor: colors.danger + '40',
            paddingVertical: 14, paddingHorizontal: 18,
            flexDirection: 'row', alignItems: 'center', gap: 12,
          }}
          activeOpacity={0.7}
        >
          <View style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: colors.danger + '18',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name="unlink-outline" size={18} color={colors.danger} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.danger }}>
              Remove Coach
            </Text>
            <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
              Disconnect from {activeCoach.full_name ?? 'your coach'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.danger + '80'} />
        </TouchableOpacity>
      )}
    </ScrollView>
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function CoachScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { isPro } = useSubscription();
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
        : <ClientTab userId={user?.id} colors={colors} isPro={isPro} />
      }
    </SafeAreaView>
  );
}
