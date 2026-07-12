import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, Pressable,
  Alert, RefreshControl, ActivityIndicator, TextInput, Animated,
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
import { supabase } from '../lib/supabase';
import { weight } from '../theme/typography';

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
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize, fontWeight: weight.black, color }}>{initials}</Text>
    </View>
  );
}

// ─── Invite Code Overlay ──────────────────────────────────────────────────────

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
      backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', zIndex: 999,
    }}>
      <View style={{
        backgroundColor: colors.bgCard, borderRadius: 28, padding: 32,
        width: '88%', alignItems: 'center', gap: 20,
        borderWidth: 1, borderColor: colors.border,
      }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accent + '20', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="key" size={28} color={colors.accent} />
        </View>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 2, textTransform: 'uppercase' }}>Invite Code</Text>
          <Text style={{ fontSize: 38, fontWeight: weight.black, color: colors.accent, letterSpacing: 10 }}>{code}</Text>
          <Text style={{ fontSize: 12, color: colors.textDim, textAlign: 'center', lineHeight: 18 }}>Share with your client · expires once used</Text>
        </View>
        <TouchableOpacity onPress={handleCopy} activeOpacity={0.75} style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          backgroundColor: copied ? '#22c55e20' : colors.accent + '18',
          borderWidth: 1.5, borderColor: copied ? '#22c55e' : colors.accent,
          paddingVertical: 14, borderRadius: 16, width: '100%',
        }}>
          <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={18} color={copied ? '#22c55e' : colors.accent} />
          <Text style={{ fontSize: 15, fontWeight: weight.bold, color: copied ? '#22c55e' : colors.accent }}>
            {copied ? 'Copied!' : 'Copy Code'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={{ paddingVertical: 6 }}>
          <Text style={{ fontSize: 14, color: colors.textDim }}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Add Client Sheet ─────────────────────────────────────────────────────────

function AddClientSheet({ visible, onClose, userId, clientLinks, colors, onGenerate, generating }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!visible) { setSearchQuery(''); setSearchResults([]); }
  }, [visible]);

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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        backgroundColor: colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24,
        borderTopWidth: 1, borderColor: colors.border, paddingBottom: 40,
      }}>
        {/* Grabber */}
        <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, gap: 16 }}>
          <Text style={{ fontSize: 19, fontWeight: weight.black, color: colors.text }}>Add a client</Text>

          {/* Search */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1.5, borderColor: searchQuery ? colors.accent + '60' : colors.border, paddingHorizontal: 14, paddingVertical: 4 }}>
            <Ionicons name="search" size={17} color={colors.textDim} />
            <TextInput
              style={{ flex: 1, paddingVertical: 11, fontSize: 15, color: colors.text }}
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

          {/* Search results */}
          {searchResults.length > 0 && (
            <View style={{ backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
              {searchResults.map((p, i) => (
                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border }}>
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
            <Text style={{ fontSize: 13, color: colors.textDim, textAlign: 'center' }}>No users found</Text>
          )}

          {/* Invite code */}
          <TouchableOpacity onPress={onGenerate} disabled={generating} activeOpacity={0.8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.bg, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16 }}>
            <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent + '18', alignItems: 'center', justifyContent: 'center' }}>
              {generating
                ? <ActivityIndicator size="small" color={colors.accent} />
                : <Ionicons name="key-outline" size={20} color={colors.accent} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.text }}>Invite code</Text>
              <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 1 }}>One-time · expires after use</Text>
            </View>
            <View style={{ backgroundColor: colors.accent, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: weight.bold, color: colors.bg }}>Generate</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Edit Profile Sheet ───────────────────────────────────────────────────────

const SPECIALTIES = ['Strength', 'Weight Loss', 'Muscle Gain', 'Cardio', 'Flexibility', 'Nutrition', 'Athletic Performance', 'Rehabilitation'];

function EditProfileSheet({ visible, onClose, draft, setDraft, onSave, saving, colors }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        backgroundColor: colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24,
        borderTopWidth: 1, borderColor: colors.border, paddingBottom: 40,
      }}>
        <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 16 }}>
          <Text style={{ fontSize: 19, fontWeight: weight.black, color: colors.text }}>Edit Profile</Text>

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1 }}>DISPLAY NAME</Text>
            <TextInput
              value={draft.full_name}
              onChangeText={v => setDraft(d => ({ ...d, full_name: v }))}
              placeholder="Your name"
              placeholderTextColor={colors.textDim}
              style={{ backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1.5, borderColor: colors.accent + '40', paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.text }}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1 }}>BIO</Text>
            <TextInput
              value={draft.bio}
              onChangeText={v => setDraft(d => ({ ...d, bio: v }))}
              placeholder="Tell your clients about yourself…"
              placeholderTextColor={colors.textDim}
              multiline numberOfLines={3}
              style={{ backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1.5, borderColor: colors.accent + '40', paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.text, minHeight: 76, textAlignVertical: 'top' }}
            />
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1 }}>SPECIALTY</Text>
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

          <TouchableOpacity onPress={onSave} disabled={saving} activeOpacity={0.8}
            style={{ backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: saving ? 0.7 : 1 }}>
            {saving ? <ActivityIndicator size="small" color={colors.bg} /> : <Ionicons name="checkmark-circle" size={17} color={colors.bg} />}
            <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.bg }}>Save Profile</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CoachModeScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const userId = user?.id;

  const [inviteCode, setInviteCode] = useState(null);
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [editSheetVisible, setEditSheetVisible] = useState(false);
  const [profile, setProfile] = useState({ full_name: '', bio: '', goal: '', created_at: null });
  const [draft, setDraft] = useState({ full_name: '', bio: '', goal: '' });
  const [saving, setSaving] = useState(false);

  const { data: clientLinks = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['coachClients', userId],
    queryFn: () => fetchCoachClients(userId),
    enabled: !!userId, staleTime: 0, gcTime: 0,
  });

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('full_name, bio, goal, created_at').eq('id', userId).single()
      .then(({ data }) => {
        if (data) {
          const p = { full_name: data.full_name ?? '', bio: data.bio ?? '', goal: data.goal ?? '', created_at: data.created_at };
          setProfile(p); setDraft(p);
        }
      });
  }, [userId]);

  const pending = clientLinks.filter(l => l.status === 'pending');
  const active = clientLinks.filter(l => l.status === 'active');

  const generateMut = useMutation({
    mutationFn: () => supabase.rpc('generate_coach_invite', { p_coach_id: userId }).then(r => { if (r.error) throw r.error; return r.data; }),
    onSuccess: code => {
      setInviteCode(code);
      setAddSheetVisible(false);
      qc.invalidateQueries({ queryKey: ['coachClients', userId] });
    },
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
    setProfile(prev => ({ ...prev, ...draft }));
    setSaving(false);
    setEditSheetVisible(false);
  };

  const handleRemove = link => {
    const label = link.status === 'active' ? (link.client?.full_name ?? 'this client') : 'this invite';
    Alert.alert('Confirm', `Remove ${label}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMut.mutate(link.id) },
    ]);
  };

  const coachingSince = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : '—';

  if (isLoading) return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: 12 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.75}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 20, fontWeight: weight.black, color: colors.text }}>Coach Zone</Text>
          <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.accent, letterSpacing: 1.2 }}>COACH VIEW</Text>
        </View>
        <TouchableOpacity onPress={() => { setDraft({ full_name: profile.full_name, bio: profile.bio, goal: profile.goal }); setEditSheetVisible(true); }} activeOpacity={0.75}
          style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.accent + '18', borderWidth: 1, borderColor: colors.accent + '50' }}>
          <Text style={{ fontSize: 13, fontWeight: weight.bold, color: colors.accent }}>Edit</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} colors={[colors.accent]} />}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Profile card ─────────────────────────────────────────── */}
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, overflow: 'hidden', marginBottom: 20, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ height: 5, backgroundColor: colors.accent }} />
          <View style={{ padding: 16, gap: 14 }}>
            {/* Identity row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Avatar name={profile.full_name || '?'} size={56} fontSize={18} bg={colors.accent + '25'} color={colors.accent} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 18, fontWeight: weight.black, color: colors.text }}>{profile.full_name || 'Your Name'}</Text>
                <Text style={{ fontSize: 12, color: colors.textDim }}>
                  {profile.goal || 'No specialty set'}{profile.bio ? ` · Coach` : ' · Coach'}
                </Text>
                {profile.goal ? (
                  <View style={{ alignSelf: 'flex-start', marginTop: 4, backgroundColor: colors.accent + '18', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.accent + '35' }}>
                    <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.accent }}>{profile.goal}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Divider */}
            <View style={{ height: 1, backgroundColor: colors.border }} />

            {/* Stats row */}
            <View style={{ flexDirection: 'row', gap: 0 }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.accent + '15', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="people-outline" size={16} color={colors.accent} />
                </View>
                <View>
                  <Text style={{ fontSize: 16, fontWeight: weight.black, color: colors.text }}>{active.length}</Text>
                  <Text style={{ fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 0.5 }}>ACTIVE CLIENT{active.length !== 1 ? 'S' : ''}</Text>
                </View>
              </View>
              <View style={{ width: 1, backgroundColor: colors.border, marginHorizontal: 12 }} />
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.accent + '15', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="calendar-outline" size={16} color={colors.accent} />
                </View>
                <View>
                  <Text style={{ fontSize: 13, fontWeight: weight.black, color: colors.text }}>{coachingSince}</Text>
                  <Text style={{ fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 0.5 }}>COACHING SINCE</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* ── Pending invites ──────────────────────────────────────── */}
        {pending.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>
              Pending ({pending.length})
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

        {/* ── Active clients ───────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ flex: 1, fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Active Clients
          </Text>
          <Text style={{ fontSize: 13, fontWeight: weight.black, color: colors.accent }}>
            {String(active.length).padStart(2, '0')}
          </Text>
        </View>

        {active.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 44, gap: 10, backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed', marginBottom: 16 }}>
            <Ionicons name="people-outline" size={44} color={colors.textDim + '80'} />
            <Text style={{ fontSize: 14, color: colors.textDim, textAlign: 'center', lineHeight: 20 }}>
              No active clients yet.{'\n'}Tap + to invite someone.
            </Text>
          </View>
        ) : (
          <View style={{ marginBottom: 4 }}>
            {active.map(link => {
              const name = link.client?.full_name ?? 'Client';
              return (
                <TouchableOpacity
                  key={link.id}
                  onPress={() => navigation.navigate('ClientDetail', { clientId: link.client?.id, clientName: name })}
                  activeOpacity={0.75}
                  style={{ backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 14 }}
                >
                  <Avatar name={name} size={46} fontSize={15} bg={colors.accent + '22'} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.text }}>{name}</Text>
                    {link.client?.goal ? <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }}>{link.client.goal}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

      </ScrollView>

      {/* ── FAB ─────────────────────────────────────────────────────── */}
      <TouchableOpacity
        onPress={() => setAddSheetVisible(true)}
        activeOpacity={0.85}
        style={{
          position: 'absolute', bottom: 28, right: 20,
          width: 58, height: 58, borderRadius: 29,
          backgroundColor: colors.accent,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.45, shadowRadius: 10, elevation: 8,
        }}
      >
        <Ionicons name="add" size={30} color={colors.bg} />
      </TouchableOpacity>

      {/* ── Modals ──────────────────────────────────────────────────── */}
      <AddClientSheet
        visible={addSheetVisible}
        onClose={() => setAddSheetVisible(false)}
        userId={userId}
        clientLinks={clientLinks}
        colors={colors}
        onGenerate={() => generateMut.mutate()}
        generating={generateMut.isPending}
      />

      <EditProfileSheet
        visible={editSheetVisible}
        onClose={() => setEditSheetVisible(false)}
        draft={draft}
        setDraft={setDraft}
        onSave={handleSave}
        saving={saving}
        colors={colors}
      />

      {inviteCode && <InviteOverlay code={inviteCode} onClose={() => setInviteCode(null)} colors={colors} />}
    </SafeAreaView>
  );
}
