import React, { useState, useEffect } from 'react';
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
import { useTranslation } from 'react-i18next';
import ScreenHeader from '../components/ScreenHeader';

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
  const clientIds = rows.filter(r => r.client_id).map(r => r.client_id);
  let profileMap = {};
  if (clientIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, goal')
      .in('id', clientIds);
    (profiles ?? []).forEach(p => { profileMap[p.id] = p; });
  }
  return rows.map(r => ({ ...r, client: profileMap[r.client_id] ?? null }));
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, size = 44, fontSize = 16, bg, color }) {
  const initials = (name || '?').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ fontSize, fontWeight: weight.black, color }}>{initials}</Text>
    </View>
  );
}

// ─── Invite Code Overlay ──────────────────────────────────────────────────────

function InviteOverlay({ code, onClose, colors, t }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await copyToClipboard(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <View style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', zIndex: 999,
    }}>
      <View style={{
        backgroundColor: colors.bgCard, borderRadius: 28, padding: 32,
        width: '88%', alignItems: 'center', gap: 20,
        borderWidth: 1, borderColor: colors.border,
      }}>
        {/* Icon */}
        <View style={{
          width: 64, height: 64, borderRadius: 32,
          backgroundColor: colors.accent + '20',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="key" size={28} color={colors.accent} />
        </View>

        {/* Code */}
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 2, textTransform: 'uppercase' }}>
            {t('coach.inviteCode')}
          </Text>
          <Text style={{ fontSize: 38, fontWeight: weight.black, color: colors.accent, letterSpacing: 10 }}>
            {code}
          </Text>
          <Text style={{ fontSize: 12, color: colors.textDim, textAlign: 'center', lineHeight: 18 }}>
            Share with your client · expires once used
          </Text>
        </View>

        {/* Copy */}
        <TouchableOpacity
          onPress={handleCopy}
          activeOpacity={0.75}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            backgroundColor: copied ? '#22c55e' + '20' : colors.accent + '18',
            borderWidth: 1.5, borderColor: copied ? '#22c55e' : colors.accent,
            paddingVertical: 14, borderRadius: 16, width: '100%',
          }}
        >
          <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={18} color={copied ? '#22c55e' : colors.accent} />
          <Text style={{ fontSize: 15, fontWeight: weight.bold, color: copied ? '#22c55e' : colors.accent }}>
            {copied ? 'Copied!' : 'Copy Code'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={{ paddingVertical: 6 }}>
          <Text style={{ fontSize: 14, color: colors.textDim }}>{t('coach.done')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Coach Tab ────────────────────────────────────────────────────────────────

const SPECIALTIES = ['Strength', 'Weight Loss', 'Muscle Gain', 'Cardio', 'Flexibility', 'Nutrition', 'Athletic Performance', 'Rehabilitation'];
const PRIVACY_ITEMS = [
  { key: 'workouts', label: 'Workouts & Sets',  icon: 'barbell-outline',    desc: 'Sessions, exercises, sets, reps, RPE' },
  { key: 'weight',   label: 'Body Weight',       icon: 'scale-outline',      desc: 'Weight logs & trend chart' },
  { key: 'steps',    label: 'Steps & Activity',  icon: 'footsteps-outline',  desc: 'Daily step counts' },
  { key: 'sleep',    label: 'Sleep',             icon: 'moon-outline',       desc: 'Hours slept & sleep quality' },
  { key: 'food',     label: 'Nutrition',         icon: 'restaurant-outline', desc: 'Calories & macro breakdown' },
];
const DEFAULT_VIS = { workouts: true, weight: true, steps: true, sleep: true, food: true };

function CoachTab({ userId, colors }) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const [inviteCode, setInviteCode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState(null);
  const [profile, setProfile] = useState({ full_name: '', bio: '', goal: '' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ full_name: '', bio: '', goal: '' });
  const [saving, setSaving] = useState(false);

  const { data: clientLinks = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['coachClients', userId],
    queryFn: () => fetchCoachClients(userId),
    enabled: !!userId, staleTime: 0, gcTime: 0,
  });

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('full_name, bio, goal').eq('id', userId).single()
      .then(({ data }) => {
        if (data) {
          const p = { full_name: data.full_name ?? '', bio: data.bio ?? '', goal: data.goal ?? '' };
          setProfile(p); setDraft(p);
        }
      });
  }, [userId]);

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

  const handleSave = async () => {
    setSaving(true);
    await supabase.from('profiles').update({ full_name: draft.full_name, bio: draft.bio, goal: draft.goal }).eq('id', userId);
    setProfile(draft); setSaving(false); setEditing(false);
  };

  const handleRemove = link => {
    const label = link.status === 'active' ? (link.client?.full_name ?? 'this client') : 'this invite';
    Alert.alert('Confirm', `Remove ${label}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMut.mutate(link.id) },
    ]);
  };

  const handleSearch = async (text) => {
    setSearchQuery(text);
    if (text.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const existingIds = clientLinks.filter(l => l.client_id).map(l => l.client_id);
    const { data } = await supabase.from('profiles').select('id, full_name, goal').ilike('full_name', `%${text.trim()}%`).neq('id', userId).limit(10);
    setSearchResults((data ?? []).filter(p => !existingIds.includes(p.id)));
    setSearching(false);
  };

  const handleInvite = async (p) => {
    setInviting(p.id);
    const { error } = await supabase.from('coach_clients').insert({ coach_id: userId, client_id: p.id, status: 'pending' });
    setInviting(null);
    if (error) { Alert.alert('Error', error.message); return; }
    Alert.alert('Invite Sent!', `${p.full_name} will see your invitation.`);
    setSearchResults(prev => prev.filter(x => x.id !== p.id));
    setSearchQuery('');
    qc.invalidateQueries({ queryKey: ['coachClients', userId] });
  };

  if (isLoading) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} colors={[colors.accent]} />}
      showsVerticalScrollIndicator={false}
    >

      {/* ── Profile card ───────────────────────────────────────────── */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
        {/* Accent stripe */}
        <View style={{ height: 5, backgroundColor: colors.accent }} />
        <View style={{ padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Avatar name={profile.full_name || '?'} size={56} fontSize={18} bg={colors.accent + '25'} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: weight.black, color: colors.text }}>
                {profile.full_name || 'Your Name'}
              </Text>
              <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }} numberOfLines={1}>
                {profile.goal || 'No specialty set'}
                {profile.bio ? ` · ${profile.bio}` : ''}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => editing ? (setDraft(profile), setEditing(false)) : setEditing(true)}
              activeOpacity={0.75}
              style={{
                paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                backgroundColor: editing ? colors.bgCard : colors.accent + '18',
                borderWidth: 1, borderColor: editing ? colors.border : colors.accent + '50',
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: weight.bold, color: editing ? colors.textDim : colors.accent }}>
                {editing ? 'Cancel' : 'Edit'}
              </Text>
            </TouchableOpacity>
          </View>

          {editing && (
            <View style={{ marginTop: 16, gap: 12 }}>
              <View>
                <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1, marginBottom: 6 }}>DISPLAY NAME</Text>
                <TextInput
                  value={draft.full_name}
                  onChangeText={v => setDraft(d => ({ ...d, full_name: v }))}
                  placeholder="Your name"
                  placeholderTextColor={colors.textDim}
                  style={{ backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1.5, borderColor: colors.accent + '40', paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.text }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1, marginBottom: 6 }}>BIO</Text>
                <TextInput
                  value={draft.bio}
                  onChangeText={v => setDraft(d => ({ ...d, bio: v }))}
                  placeholder="Tell your clients about yourself…"
                  placeholderTextColor={colors.textDim}
                  multiline numberOfLines={3}
                  style={{ backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1.5, borderColor: colors.accent + '40', paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.text, minHeight: 76, textAlignVertical: 'top' }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1, marginBottom: 8 }}>SPECIALTY</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {SPECIALTIES.map(s => {
                    const sel = draft.goal === s;
                    return (
                      <TouchableOpacity key={s} onPress={() => setDraft(d => ({ ...d, goal: sel ? '' : s }))} activeOpacity={0.75}
                        style={{ paddingHorizontal: 13, paddingVertical: 7, borderRadius: 20, backgroundColor: sel ? colors.accent : 'transparent', borderWidth: 1.5, borderColor: sel ? colors.accent : colors.border }}>
                        <Text style={{ fontSize: 12, fontWeight: weight.semibold, color: sel ? colors.bg : colors.textDim }}>{s}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <TouchableOpacity onPress={handleSave} disabled={saving} activeOpacity={0.8}
                style={{ backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: saving ? 0.7 : 1 }}>
                {saving ? <ActivityIndicator size="small" color={colors.bg} /> : <Ionicons name="checkmark-circle" size={17} color={colors.bg} />}
                <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.bg }}>Save Profile</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* ── Add clients ─────────────────────────────────────────────── */}
      <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>{t('coach.addClients')}</Text>

      {/* Search */}
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1.5, borderColor: searchQuery ? colors.accent + '60' : colors.border, paddingHorizontal: 12, paddingVertical: 4 }}>
          <Ionicons name="search" size={16} color={colors.textDim} />
          <TextInput
            style={{ flex: 1, paddingVertical: 9, fontSize: 15, color: colors.text }}
            placeholder="Search client by name…"
            placeholderTextColor={colors.textDim}
            value={searchQuery}
            onChangeText={handleSearch}
            autoCorrect={false}
          />
          {searching
            ? <ActivityIndicator size="small" color={colors.accent} />
            : searchQuery.length > 0
              ? <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }} activeOpacity={0.7}>
                  <Ionicons name="close-circle" size={18} color={colors.textDim} />
                </TouchableOpacity>
              : null}
        </View>

        {searchResults.length > 0 && (
          <View style={{ marginTop: 10, gap: 2 }}>
            {searchResults.map((p, i) => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border }}>
                <Avatar name={p.full_name} size={40} fontSize={13} bg={colors.accent + '20'} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: weight.semibold, color: colors.text }}>{p.full_name}</Text>
                  {p.goal ? <Text style={{ fontSize: 11, color: colors.textDim }}>{p.goal}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => handleInvite(p)} disabled={inviting === p.id} activeOpacity={0.8}
                  style={{ backgroundColor: colors.accent, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7, opacity: inviting === p.id ? 0.6 : 1 }}>
                  {inviting === p.id
                    ? <ActivityIndicator size="small" color={colors.bg} />
                    : <Text style={{ fontSize: 13, fontWeight: weight.bold, color: colors.bg }}>Invite</Text>}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
          <Text style={{ fontSize: 13, color: colors.textDim, textAlign: 'center', marginTop: 12 }}>No users found</Text>
        )}
      </View>

      {/* Invite via Code */}
      <TouchableOpacity
        onPress={() => generateMut.mutate()}
        disabled={generateMut.isPending}
        activeOpacity={0.8}
        style={{ backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 14 }}
      >
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent + '18', alignItems: 'center', justifyContent: 'center' }}>
          {generateMut.isPending
            ? <ActivityIndicator size="small" color={colors.accent} />
            : <Ionicons name="key-outline" size={22} color={colors.accent} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.text }}>Generate Invite Code</Text>
          <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }}>One-time code · expires after use</Text>
        </View>
        <View style={{ backgroundColor: colors.accent, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 }}>
          <Text style={{ fontSize: 13, fontWeight: weight.bold, color: colors.bg }}>Generate</Text>
        </View>
      </TouchableOpacity>

      {/* ── Pending invites ──────────────────────────────────────────── */}
      {pending.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>
            {t('coach.pending', { count: pending.length })}
          </Text>
          {pending.map(link => {
            const isSearch = !link.invite_code && link.client_id;
            const clientName = link.client?.full_name ?? 'Awaiting client';
            return (
              <View key={link.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fbbf2408', borderRadius: 14, borderWidth: 1, borderColor: '#fbbf2430', borderLeftWidth: 3, borderLeftColor: '#fbbf24', padding: 14, marginBottom: 8 }}>
                {isSearch
                  ? <Avatar name={clientName} size={40} fontSize={13} bg={'#fbbf2420'} color={'#fbbf24'} />
                  : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#fbbf2418', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="time-outline" size={20} color="#fbbf24" />
                    </View>}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: weight.bold, color: colors.text }}>
                    {isSearch ? clientName : link.invite_code}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 1 }}>
                    {isSearch ? 'Awaiting acceptance' : 'Awaiting client · code'}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => handleRemove(link)} activeOpacity={0.75}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.danger + '12', borderWidth: 1, borderColor: colors.danger + '35' }}>
                  <Text style={{ fontSize: 12, color: colors.danger, fontWeight: weight.semibold }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      {/* ── Active clients ───────────────────────────────────────────── */}
      <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>
        {t('coach.activeClients', { count: active.length })}
      </Text>

      {active.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 44, gap: 10, backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed' }}>
          <Ionicons name="people-outline" size={44} color={colors.textDim + '80'} />
          <Text style={{ fontSize: 14, color: colors.textDim, textAlign: 'center', lineHeight: 20 }}>
            No active clients yet.{'\n'}Invite someone to get started.
          </Text>
        </View>
      ) : (
        active.map(link => {
          const name = link.client?.full_name ?? 'Client';
          return (
            <View key={link.id} style={{ backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Avatar name={name} size={48} fontSize={16} bg={colors.accent + '22'} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.text }}>{name}</Text>
                {link.client?.goal ? <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }}>{link.client.goal}</Text> : null}
              </View>
              <TouchableOpacity
                onPress={() => navigation.navigate('CoachChat', { coachId: userId, clientId: link.client?.id, clientName: name })}
                activeOpacity={0.8}
                style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent + '18', alignItems: 'center', justifyContent: 'center', marginRight: 6 }}
              >
                <Ionicons name="chatbubble-outline" size={17} color={colors.accent} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => navigation.navigate('ClientDetail', { clientId: link.client?.id, clientName: name })}
                activeOpacity={0.8}
                style={{ backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <Ionicons name="bar-chart-outline" size={14} color={colors.bg} />
                <Text style={{ fontSize: 13, fontWeight: weight.bold, color: colors.bg }}>Stats</Text>
              </TouchableOpacity>
            </View>
          );
        })
      )}

      {inviteCode && <InviteOverlay code={inviteCode} onClose={() => setInviteCode(null)} colors={colors} t={t} />}
    </ScrollView>
  );
}

// ─── Client Tab ───────────────────────────────────────────────────────────────

function ClientTab({ userId, colors, isPro }) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [visibility, setVisibility] = useState(DEFAULT_VIS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeCoach, setActiveCoach] = useState(null);
  const [linkedSince, setLinkedSince] = useState(null);
  const [linkId, setLinkId] = useState(null);
  const [pendingInvites, setPendingInvites] = useState([]);

  const loadClientData = async () => {
    if (!userId) return;
    const [visRes, activeRes, pendingRes] = await Promise.all([
      supabase.from('profiles').select('coach_visibility').eq('id', userId).single(),
      supabase.from('coach_clients').select('id, coach_id, created_at').eq('client_id', userId).eq('status', 'active').limit(1).single(),
      supabase.from('coach_clients').select('id, coach_id, created_at').eq('client_id', userId).eq('status', 'pending').is('invite_code', null),
    ]);
    if (visRes.data?.coach_visibility) setVisibility({ ...DEFAULT_VIS, ...visRes.data.coach_visibility });
    setLoaded(true);
    if (activeRes.data?.coach_id) {
      const { data: prof } = await supabase.from('profiles').select('full_name, bio, goal, sex').eq('id', activeRes.data.coach_id).single();
      setLinkId(activeRes.data.id);
      setLinkedSince(activeRes.data.created_at);
      setActiveCoach({ coach_id: activeRes.data.coach_id, ...(prof ?? {}) });
    }
    const pending = pendingRes.data ?? [];
    if (pending.length > 0) {
      const coachIds = pending.map(r => r.coach_id);
      const { data: profiles } = await supabase.from('profiles').select('id, full_name, bio, goal').in('id', coachIds);
      const pMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]));
      setPendingInvites(pending.map(r => ({ ...r, coach: pMap[r.coach_id] ?? {} })));
    } else {
      setPendingInvites([]);
    }
  };

  useEffect(() => { loadClientData(); }, [userId]);

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
        const { data: link } = await supabase.from('coach_clients').select('id, coach_id, created_at').eq('client_id', userId).eq('status', 'active').limit(1).single();
        if (link?.coach_id) {
          setLinkId(link.id);
          setLinkedSince(link.created_at);
          const { data: prof } = await supabase.from('profiles').select('full_name, bio, goal, sex').eq('id', link.coach_id).single();
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
      { text: 'Leave', style: 'destructive', onPress: async () => {
        if (linkId) await supabase.from('coach_clients').update({ status: 'removed' }).eq('id', linkId);
        setActiveCoach(null); setLinkedSince(null); setLinkId(null);
        await loadClientData();
      }},
    ]);
  };

  const handleAcceptInvite = async (invite) => {
    let ok = false;
    const rpcRes = await supabase.rpc('accept_or_decline_coach_invite', { p_link_id: invite.id, p_action: 'accept' });
    if (rpcRes.error) {
      const { error } = await supabase.from('coach_clients').update({ status: 'active' }).eq('id', invite.id);
      if (error) { Alert.alert('Error', error.message); return; }
      ok = true;
    } else { ok = rpcRes.data; }
    if (!ok) { Alert.alert('Error', 'Could not accept invite. Please try again.'); return; }
    await loadClientData();
  };

  const handleDeclineInvite = async (invite) => {
    const rpcRes = await supabase.rpc('accept_or_decline_coach_invite', { p_link_id: invite.id, p_action: 'decline' });
    if (rpcRes.error) await supabase.from('coach_clients').update({ status: 'removed' }).eq('id', invite.id);
    await loadClientData();
  };

  if (!loaded) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 60 }}
      showsVerticalScrollIndicator={false}
    >

      {/* ── Pending invitations ──────────────────────────────────────── */}
      {!activeCoach && pendingInvites.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>
            Coach Invitations ({pendingInvites.length})
          </Text>
          {pendingInvites.map(invite => {
            const name = invite.coach?.full_name ?? 'Coach';
            return (
              <View key={invite.id} style={{ backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: colors.accent + '30', borderLeftWidth: 3, borderLeftColor: colors.accent, padding: 16, marginBottom: 10, gap: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <Avatar name={name} size={52} fontSize={17} bg={colors.accent + '22'} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: weight.black, color: colors.text }}>{name}</Text>
                    <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }}>
                      {invite.coach?.goal || 'Coach'} · wants to coach you
                    </Text>
                  </View>
                </View>
                {invite.coach?.bio ? (
                  <Text style={{ fontSize: 13, color: colors.textDim, fontStyle: 'italic' }} numberOfLines={2}>
                    "{invite.coach.bio}"
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => handleAcceptInvite(invite)} activeOpacity={0.8}
                    style={{ flex: 1, backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.bg} />
                    <Text style={{ fontSize: 14, fontWeight: weight.bold, color: colors.bg }}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDeclineInvite(invite)} activeOpacity={0.8}
                    style={{ paddingHorizontal: 20, borderRadius: 14, backgroundColor: colors.danger + '10', borderWidth: 1, borderColor: colors.danger + '35', flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Ionicons name="close-circle-outline" size={16} color={colors.danger} />
                    <Text style={{ fontSize: 14, fontWeight: weight.semibold, color: colors.danger }}>Decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* ── Active coach card ────────────────────────────────────────── */}
      {activeCoach ? (
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, overflow: 'hidden', marginBottom: 20, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ height: 5, backgroundColor: colors.accent }} />
          <View style={{ padding: 18, gap: 14 }}>
            {/* Coach identity */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Avatar name={activeCoach.full_name || 'Coach'} size={56} fontSize={18} bg={colors.accent + '25'} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: weight.black, color: colors.text }}>
                  {activeCoach.full_name || 'Your Coach'}
                </Text>
                <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }}>
                  {activeCoach.goal || 'Coach'}
                  {linkedSince ? ` · since ${new Date(linkedSince).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : ''}
                </Text>
              </View>
              <View style={{ backgroundColor: '#22c55e18', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#22c55e35' }}>
                <Text style={{ fontSize: 11, fontWeight: weight.bold, color: '#22c55e', letterSpacing: 0.5 }}>ACTIVE</Text>
              </View>
            </View>

            {activeCoach.bio ? (
              <Text style={{ fontSize: 13, color: colors.textDim, fontStyle: 'italic', lineHeight: 20 }} numberOfLines={2}>
                "{activeCoach.bio}"
              </Text>
            ) : null}

            {/* Actions */}
            <TouchableOpacity
              onPress={() => navigation.navigate('CoachChat', { coachId: activeCoach.coach_id, clientId: userId, coachName: activeCoach.full_name ?? 'Coach' })}
              activeOpacity={0.8}
              style={{ backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Ionicons name="chatbubble-ellipses" size={16} color={colors.bg} />
              <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.bg }}>{t('coach.messageCoach')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* ── Join a Coach ─────────────────────────────────────────────── */
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 24, marginBottom: 20, alignItems: 'center', gap: 16 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accent + '15', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="people-circle-outline" size={40} color={colors.accent} />
          </View>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 17, fontWeight: weight.black, color: colors.text }}>{t('coach.noCoachYet')}</Text>
            <Text style={{ fontSize: 13, color: colors.textDim, textAlign: 'center', lineHeight: 19 }}>
              Enter a coach's invite code{'\n'}to get started
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
            <TextInput
              style={{ flex: 1, backgroundColor: colors.bg, color: colors.text, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, fontWeight: weight.bold, letterSpacing: 4, textAlign: 'center' }}
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
              activeOpacity={0.8}
              style={{ backgroundColor: colors.accent, borderRadius: 14, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', opacity: (!inviteCode.trim() || joining) ? 0.5 : 1 }}
            >
              {joining
                ? <ActivityIndicator size="small" color={colors.bg} />
                : <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.bg }}>Join</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Privacy controls ─────────────────────────────────────────── */}
      <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>
        {t('coach.visibility')}
      </Text>
      <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 20 }}>
        {PRIVACY_ITEMS.map(({ key, label, icon, desc }, i) => (
          <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: i < PRIVACY_ITEMS.length - 1 ? 1 : 0, borderBottomColor: colors.border, opacity: isPro ? 1 : 0.45 }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: (isPro && visibility[key]) ? colors.accent + '18' : colors.bgCard }}>
              <Ionicons name={isPro ? icon : 'lock-closed-outline'} size={17} color={(isPro && visibility[key]) ? colors.accent : colors.textDim} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: weight.semibold, color: colors.text }}>{label}</Text>
              <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>{desc}</Text>
            </View>
            <Switch
              value={isPro ? !!visibility[key] : true}
              onValueChange={v => isPro && handleToggle(key, v)}
              trackColor={{ false: colors.border, true: colors.accent + '88' }}
              thumbColor={(isPro && visibility[key]) ? colors.accent : colors.textDim}
              ios_backgroundColor={colors.border}
              disabled={!isPro || !loaded}
            />
          </View>
        ))}

        {!isPro && (
          <TouchableOpacity
            onPress={() => navigation.navigate('Subscription')}
            activeOpacity={0.8}
            style={{ margin: 14, backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Ionicons name="rocket" size={16} color={colors.bg} />
            <Text style={{ fontSize: 14, fontWeight: weight.bold, color: colors.bg }}>Upgrade to Pro to unlock</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Disconnect ───────────────────────────────────────────────── */}
      {activeCoach && (
        <TouchableOpacity onPress={handleDisconnect} activeOpacity={0.75} style={{ alignItems: 'center', paddingVertical: 12, marginBottom: 8 }}>
          <Text style={{ fontSize: 13, color: colors.danger, fontWeight: weight.semibold }}>Disconnect from coach</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function CoachScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { colors } = useTheme();
  const { isPro } = useSubscription();
  const navigation = useNavigation();
  const [tab, setTab] = useState('coach');

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>

      <ScreenHeader title={t('coach.title')} onBack={() => navigation.goBack()} />

      {/* ── Tab switcher ────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 4 }}>
        {[
          { key: 'coach', label: t('coach.tabCoach'), icon: 'ribbon-outline' },
          { key: 'client', label: t('coach.tabClient'), icon: 'person-outline' },
        ].map(t => (
          <TouchableOpacity
            key={t.key}
            onPress={() => setTab(t.key)}
            activeOpacity={0.8}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, backgroundColor: tab === t.key ? colors.accent : 'transparent' }}
          >
            <Ionicons name={t.icon} size={15} color={tab === t.key ? colors.bg : colors.textDim} />
            <Text style={{ fontSize: 14, fontWeight: weight.bold, color: tab === t.key ? colors.bg : colors.textDim }}>
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
