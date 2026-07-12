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

// ─── Shared section label ─────────────────────────────────────────────────────

function SectionLabel({ title, colors }) {
  return (
    <Text style={{
      fontSize: 11,
      fontWeight: weight.bold,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1.2,
      marginBottom: 10,
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
      backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', zIndex: 999,
    }}>
      <View style={{
        backgroundColor: colors.bgCard, borderRadius: 24, padding: 30,
        width: '88%', borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 18,
      }}>
        <View style={{
          width: 60, height: 60, borderRadius: 30,
          backgroundColor: colors.accent + '22',
          alignItems: 'center', justifyContent: 'center',
          borderWidth: 1.5, borderColor: colors.accent + '44',
        }}>
          <Ionicons name="link" size={28} color={colors.accent} />
        </View>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Text style={{
            fontSize: 11, fontWeight: weight.bold, color: colors.textMuted,
            letterSpacing: 1.2, textTransform: 'uppercase',
          }}>
            Invite Code
          </Text>
          <Text style={{ fontSize: 36, fontWeight: weight.bold, color: colors.accent, letterSpacing: 9 }}>
            {code}
          </Text>
          <Text style={{ fontSize: typography.xs, color: colors.textDim, textAlign: 'center', lineHeight: 19 }}>
            Share this with your client.{'\n'}It expires once used.
          </Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={handleCopy}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: copied ? '#34d399' + '20' : colors.accent + '20',
            borderWidth: 1, borderColor: copied ? '#34d399' : colors.accent,
            paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, width: '100%', justifyContent: 'center',
          }}
        >
          <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={18} color={copied ? '#34d399' : colors.accent} />
          <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: copied ? '#34d399' : colors.accent }}>
            {copied ? 'Copied!' : 'Copy Code'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.75} onPress={onClose} style={{ paddingVertical: 8 }}>
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
      backgroundColor: colors.bgCard, borderRadius: 18,
      borderWidth: 1, borderColor: colors.border,
      marginBottom: 12, flexDirection: 'row', alignItems: 'center',
      paddingVertical: 13, paddingHorizontal: 14, gap: 12,
    }}>
      <View style={{
        width: 46, height: 46, borderRadius: 23,
        backgroundColor: colors.accent + '22',
        borderWidth: 1.5, borderColor: colors.accent + '55',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.accent }}>{initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.text }}>{name}</Text>
        {client?.goal && (
          <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>{client.goal}</Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={onViewStats}
          style={{
            backgroundColor: colors.accent, borderRadius: 12,
            paddingHorizontal: 14, paddingVertical: 8,
            flexDirection: 'row', alignItems: 'center', gap: 5,
          }}
        >
          <Ionicons name="bar-chart-outline" size={13} color={colors.bg} />
          <Text style={{ fontSize: 12, fontWeight: weight.bold, color: colors.bg }}>Stats</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={onRemove}
          style={{
            width: 34, height: 34, borderRadius: 12,
            backgroundColor: colors.danger + '12',
            borderWidth: 1, borderColor: colors.danger + '40',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
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
    <View style={{
      backgroundColor: colors.bgCard, borderRadius: 18,
      borderWidth: 1, borderColor: colors.border,
      overflow: 'hidden', marginBottom: 12,
    }}>
      {/* Accent top bar */}
      <View style={{ height: 4, backgroundColor: colors.accent, borderTopLeftRadius: 18, borderTopRightRadius: 18 }} />

      <View style={{ padding: 16 }}>
        {/* Header row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{
            width: 52, height: 52, borderRadius: 26,
            backgroundColor: colors.accent + '22',
            borderWidth: 2, borderColor: colors.accent + '55',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 18, fontWeight: weight.black, color: colors.accent }}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: weight.bold, color: colors.text, lineHeight: 22 }}>
              {profile.full_name || 'Your Name'}
            </Text>
            <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }}>
              {profile.goal ? profile.goal : 'No specialty set'}
              {profile.bio ? ` · ${profile.bio.slice(0, 32)}${profile.bio.length > 32 ? '…' : ''}` : ''}
            </Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => editing ? handleCancel() : setEditing(true)}
            style={{
              paddingHorizontal: 12, paddingVertical: 7, borderRadius: 24,
              backgroundColor: editing ? colors.bgElevated : colors.accent + '18',
              borderWidth: 1, borderColor: editing ? colors.border : colors.accent + '40',
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: weight.bold, color: editing ? colors.textDim : colors.accent }}>
              {editing ? 'Cancel' : 'Edit'}
            </Text>
          </TouchableOpacity>
        </View>

        {editing ? (
          <View style={{ gap: 14, marginTop: 16 }}>
            {/* Name */}
            <View>
              <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textMuted, marginBottom: 6, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                Display Name
              </Text>
              <TextInput
                value={draft.full_name}
                onChangeText={v => setDraft(d => ({ ...d, full_name: v }))}
                placeholder="Your name"
                placeholderTextColor={colors.textDim}
                style={{
                  backgroundColor: colors.bg, borderRadius: 14,
                  borderWidth: 1.5, borderColor: colors.accent + '50',
                  paddingHorizontal: 14, paddingVertical: 12,
                  fontSize: typography.sm, color: colors.text,
                }}
              />
            </View>

            {/* Bio */}
            <View>
              <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textMuted, marginBottom: 6, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                Bio / Intro
              </Text>
              <TextInput
                value={draft.bio}
                onChangeText={v => setDraft(d => ({ ...d, bio: v }))}
                placeholder="Tell your clients about yourself…"
                placeholderTextColor={colors.textDim}
                multiline
                numberOfLines={3}
                style={{
                  backgroundColor: colors.bg, borderRadius: 14,
                  borderWidth: 1.5, borderColor: colors.accent + '50',
                  paddingHorizontal: 14, paddingVertical: 12,
                  fontSize: typography.sm, color: colors.text,
                  minHeight: 82, textAlignVertical: 'top',
                }}
              />
            </View>

            {/* Specialty chips */}
            <View>
              <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textMuted, marginBottom: 8, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                Specialty
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                {SPECIALTIES.map(s => {
                  const sel = draft.goal === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      activeOpacity={0.75}
                      onPress={() => setDraft(d => ({ ...d, goal: sel ? '' : s }))}
                      style={{
                        paddingHorizontal: 13, paddingVertical: 7, borderRadius: 24,
                        backgroundColor: sel ? colors.accent : colors.bgElevated,
                        borderWidth: 1.5, borderColor: sel ? colors.accent : colors.border,
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: weight.semibold, color: sel ? colors.bg : colors.textDim }}>
                        {s}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Save */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={handleSave}
              disabled={saving}
              style={{
                backgroundColor: colors.accent, borderRadius: 12,
                paddingVertical: 13, flexDirection: 'row', alignItems: 'center',
                justifyContent: 'center', gap: 8, opacity: saving ? 0.7 : 1, marginTop: 2,
              }}
            >
              {saving
                ? <ActivityIndicator size="small" color={colors.bg} />
                : <Ionicons name="checkmark-circle" size={17} color={colors.bg} />}
              <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.bg }}>Save Profile</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ─── Search & Invite ─────────────────────────────────────────────────────────

function SearchInviteSection({ userId, existingClientIds, colors, onInvited }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState(null);

  const handleSearch = async (text) => {
    setQuery(text);
    if (text.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const { data } = await supabase.from('profiles')
      .select('id, full_name, goal')
      .ilike('full_name', `%${text.trim()}%`)
      .neq('id', userId)
      .limit(10);
    setResults((data ?? []).filter(p => !existingClientIds.includes(p.id)));
    setSearching(false);
  };

  const handleInvite = async (profile) => {
    setInviting(profile.id);
    const { error } = await supabase.from('coach_clients').insert({
      coach_id: userId, client_id: profile.id, status: 'pending',
    });
    setInviting(null);
    if (error) { Alert.alert('Error', error.message); return; }
    Alert.alert('Invite Sent!', `${profile.full_name} will see your invitation and can accept it.`);
    setResults(prev => prev.filter(p => p.id !== profile.id));
    setQuery('');
    onInvited();
  };

  return (
    <View style={{
      backgroundColor: colors.bgCard, borderRadius: 18,
      borderWidth: 1, borderColor: colors.border,
      padding: 16, marginBottom: 12,
    }}>
      {/* Section header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <View style={{
          width: 30, height: 30, borderRadius: 15,
          backgroundColor: colors.accent + '18',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="search" size={15} color={colors.accent} />
        </View>
        <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
          Find & Invite
        </Text>
      </View>

      {/* Search input */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: colors.bg, borderRadius: 14,
        borderWidth: 1.5, borderColor: query ? colors.accent + '70' : colors.border,
        paddingHorizontal: 12,
      }}>
        <Ionicons name="search" size={16} color={colors.textDim} />
        <TextInput
          style={{ flex: 1, paddingVertical: 11, fontSize: typography.sm, color: colors.text }}
          placeholder="Search by name…"
          placeholderTextColor={colors.textDim}
          value={query}
          onChangeText={handleSearch}
          autoCorrect={false}
        />
        {searching
          ? <ActivityIndicator size="small" color={colors.accent} />
          : query.length > 0
            ? <TouchableOpacity activeOpacity={0.75} onPress={() => { setQuery(''); setResults([]); }}>
                <Ionicons name="close-circle" size={17} color={colors.textDim} />
              </TouchableOpacity>
            : null}
      </View>

      {results.length > 0 && (
        <View style={{ marginTop: 10, gap: 2 }}>
          {results.map((profile, i) => {
            const initials = (profile.full_name ?? '?').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
            return (
              <View key={profile.id} style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 10,
                borderTopWidth: i === 0 ? 1 : 0,
                borderBottomWidth: 1,
                borderColor: colors.border,
              }}>
                <View style={{
                  width: 38, height: 38, borderRadius: 19,
                  backgroundColor: colors.accent + '22',
                  borderWidth: 1, borderColor: colors.accent + '44',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 12, fontWeight: weight.bold, color: colors.accent }}>{initials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text }}>{profile.full_name}</Text>
                  {profile.goal ? <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>{profile.goal}</Text> : null}
                </View>
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => handleInvite(profile)}
                  disabled={inviting === profile.id}
                  style={{
                    backgroundColor: colors.accent, borderRadius: 24,
                    paddingHorizontal: 14, paddingVertical: 7,
                    flexDirection: 'row', alignItems: 'center', gap: 5,
                    opacity: inviting === profile.id ? 0.7 : 1,
                  }}
                >
                  {inviting === profile.id
                    ? <ActivityIndicator size="small" color={colors.bg} />
                    : <Ionicons name="person-add-outline" size={13} color={colors.bg} />}
                  <Text style={{ fontSize: 12, fontWeight: weight.bold, color: colors.bg }}>Invite</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      {query.length >= 2 && !searching && results.length === 0 && (
        <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 12, textAlign: 'center' }}>
          No users found
        </Text>
      )}
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
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 50 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} colors={[colors.accent]} />}
    >
      {/* Coach Profile */}
      <CoachProfileCard userId={userId} colors={colors} />

      {/* Search & Invite */}
      <SearchInviteSection
        userId={userId}
        existingClientIds={clientLinks.filter(l => l.client_id).map(l => l.client_id)}
        colors={colors}
        onInvited={() => qc.invalidateQueries({ queryKey: ['coachClients', userId] })}
      />

      {/* Invite via Code */}
      <View style={{
        backgroundColor: colors.bgCard, borderRadius: 18,
        borderWidth: 1, borderColor: colors.border,
        padding: 16, marginBottom: 12,
        flexDirection: 'row', alignItems: 'center', gap: 14,
      }}>
        <View style={{
          width: 44, height: 44, borderRadius: 22,
          backgroundColor: colors.accent + '20',
          borderWidth: 1.5, borderColor: colors.accent + '40',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="key-outline" size={20} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.text }}>
            Invite via Code
          </Text>
          <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
            One-time code, expires after use
          </Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => generateMut.mutate()}
          disabled={generateMut.isPending}
          style={{
            backgroundColor: colors.accent, borderRadius: 24,
            paddingHorizontal: 16, paddingVertical: 9,
            flexDirection: 'row', alignItems: 'center', gap: 6,
            opacity: generateMut.isPending ? 0.7 : 1,
          }}
        >
          {generateMut.isPending
            ? <ActivityIndicator size="small" color={colors.bg} />
            : <Ionicons name="flash-outline" size={14} color={colors.bg} />}
          <Text style={{ fontSize: 13, fontWeight: weight.bold, color: colors.bg }}>Generate</Text>
        </TouchableOpacity>
      </View>

      {/* Pending */}
      {pending.length > 0 && (
        <>
          <SectionLabel title={`Pending Invites (${pending.length})`} colors={colors} />
          {pending.map(link => {
            const isSearch = !link.invite_code && link.client_id;
            const clientName = link.client?.full_name ?? 'Client';
            const initials = clientName.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
            return (
              <View key={link.id} style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: '#fbbf2408',
                borderRadius: 14, borderWidth: 1, borderColor: '#fbbf2430',
                borderLeftWidth: 3, borderLeftColor: '#fbbf24',
                padding: 13, marginBottom: 8, gap: 10,
              }}>
                {isSearch ? (
                  <View style={{
                    width: 36, height: 36, borderRadius: 18,
                    backgroundColor: '#fbbf2420', borderWidth: 1, borderColor: '#fbbf2444',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 12, fontWeight: weight.bold, color: '#fbbf24' }}>{initials}</Text>
                  </View>
                ) : (
                  <View style={{
                    width: 36, height: 36, borderRadius: 18,
                    backgroundColor: '#fbbf2420',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name="time-outline" size={18} color="#fbbf24" />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.textDim, marginBottom: 2 }}>
                    {isSearch ? 'Awaiting acceptance' : 'Awaiting client'}
                  </Text>
                  <Text style={{
                    fontWeight: weight.bold, color: colors.text,
                    letterSpacing: isSearch ? 0 : 2, fontSize: typography.sm,
                  }}>
                    {isSearch ? clientName : link.invite_code}
                  </Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => handleRemove(link)}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                    backgroundColor: colors.danger + '12',
                    borderWidth: 1, borderColor: colors.danger + '40',
                  }}
                >
                  <Text style={{ fontSize: 11, color: colors.danger, fontWeight: weight.semibold }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          <View style={{ height: 10 }} />
        </>
      )}

      {/* Active Clients */}
      <SectionLabel title={`Active Clients (${active.length})`} colors={colors} />
      {isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginVertical: 20 }} />
      ) : active.length === 0 ? (
        <View style={{
          alignItems: 'center', paddingVertical: 44, gap: 12,
          backgroundColor: colors.bgCard, borderRadius: 18,
          borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
        }}>
          <Ionicons name="people-outline" size={44} color={colors.textDim} />
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
    <View style={{
      backgroundColor: colors.bgCard, borderRadius: 18,
      borderWidth: 1, borderColor: colors.border,
      overflow: 'hidden', marginBottom: 12,
    }}>
      {/* Hero accent stripe */}
      <View style={{ height: 4, backgroundColor: colors.accent, borderTopLeftRadius: 18, borderTopRightRadius: 18 }} />

      <View style={{ padding: 16, gap: 12 }}>
        {/* Identity row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{
            width: 52, height: 52, borderRadius: 26,
            backgroundColor: colors.accent + '22',
            borderWidth: 2, borderColor: colors.accent + '55',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 18, fontWeight: weight.black, color: colors.accent }}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: weight.bold, color: colors.text, lineHeight: 22 }}>{name}</Text>
            <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }}>
              {coach.goal ? coach.goal : 'Your Coach'}
              {memberSince ? ` · since ${memberSince}` : ''}
            </Text>
          </View>
          <View style={{
            backgroundColor: '#22c55e18', borderRadius: 24,
            paddingHorizontal: 9, paddingVertical: 4,
            borderWidth: 1, borderColor: '#22c55e40',
          }}>
            <Text style={{ fontSize: 10, fontWeight: weight.bold, color: '#22c55e', letterSpacing: 0.8 }}>ACTIVE</Text>
          </View>
        </View>

        {/* Bio */}
        {coach.bio ? (
          <Text style={{ fontSize: 12, color: colors.textDim, fontStyle: 'italic', lineHeight: 18 }} numberOfLines={2}>
            "{coach.bio}"
          </Text>
        ) : null}

        {/* Actions */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={onChat}
            style={{
              flex: 1, backgroundColor: colors.accent, borderRadius: 12,
              paddingVertical: 11, flexDirection: 'row',
              alignItems: 'center', justifyContent: 'center', gap: 7,
            }}
          >
            <Ionicons name="chatbubble-ellipses" size={15} color={colors.bg} />
            <Text style={{ fontSize: 13, fontWeight: weight.bold, color: colors.bg }}>Message Coach</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={onDisconnect}
            style={{
              paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12,
              backgroundColor: colors.danger + '12',
              borderWidth: 1, borderColor: colors.danger + '40',
              flexDirection: 'row', alignItems: 'center', gap: 6,
            }}
          >
            <Ionicons name="unlink-outline" size={15} color={colors.danger} />
            <Text style={{ fontSize: 13, color: colors.danger, fontWeight: weight.medium }}>Leave</Text>
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
          await loadClientData();
        },
      },
    ]);
  };

  const handleAcceptInvite = async (invite) => {
    // Try RPC first (SECURITY DEFINER bypasses RLS); fall back to direct update
    let ok = false;
    const rpcRes = await supabase.rpc('accept_or_decline_coach_invite', { p_link_id: invite.id, p_action: 'accept' });
    if (rpcRes.error) {
      const { error } = await supabase.from('coach_clients').update({ status: 'active' }).eq('id', invite.id);
      if (error) { Alert.alert('Error', error.message); return; }
      ok = true;
    } else {
      ok = rpcRes.data;
    }
    if (!ok) { Alert.alert('Error', 'Could not accept invite. Please try again.'); return; }
    // Re-fetch from DB so state matches actual DB state after any tab switch
    await loadClientData();
  };

  const handleDeclineInvite = async (invite) => {
    const rpcRes = await supabase.rpc('accept_or_decline_coach_invite', { p_link_id: invite.id, p_action: 'decline' });
    if (rpcRes.error) {
      await supabase.from('coach_clients').update({ status: 'removed' }).eq('id', invite.id);
    }
    await loadClientData();
  };

  return (
    <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 100 }}>

      {/* Pending coach invitations */}
      {!activeCoach && pendingInvites.length > 0 && (
        <View style={{ marginBottom: 12 }}>
          <SectionLabel title={`Coach Invitations (${pendingInvites.length})`} colors={colors} />
          {pendingInvites.map(invite => {
            const name = invite.coach?.full_name ?? 'Coach';
            const initials = name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
            return (
              <View key={invite.id} style={{
                backgroundColor: colors.bgCard, borderRadius: 18,
                borderWidth: 1, borderColor: colors.accent + '40',
                borderLeftWidth: 3, borderLeftColor: colors.accent,
                padding: 14, marginBottom: 10, gap: 12,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{
                    width: 46, height: 46, borderRadius: 23,
                    backgroundColor: colors.accent + '22',
                    borderWidth: 1.5, borderColor: colors.accent + '55',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.accent }}>{initials}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.text }}>{name}</Text>
                    <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
                      {invite.coach?.goal ? invite.coach.goal : 'Coach'} · wants to coach you
                    </Text>
                  </View>
                </View>
                {invite.coach?.bio ? (
                  <Text style={{ fontSize: 12, color: colors.textDim, fontStyle: 'italic', lineHeight: 17 }} numberOfLines={2}>
                    "{invite.coach.bio}"
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    onPress={() => handleAcceptInvite(invite)}
                    style={{
                      flex: 1, backgroundColor: colors.accent, borderRadius: 12,
                      paddingVertical: 10, flexDirection: 'row',
                      alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    <Ionicons name="checkmark-circle" size={15} color={colors.bg} />
                    <Text style={{ fontSize: 13, fontWeight: weight.bold, color: colors.bg }}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    onPress={() => handleDeclineInvite(invite)}
                    style={{
                      paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12,
                      backgroundColor: colors.danger + '12',
                      borderWidth: 1, borderColor: colors.danger + '40',
                      flexDirection: 'row', alignItems: 'center', gap: 5,
                    }}
                  >
                    <Ionicons name="close-outline" size={15} color={colors.danger} />
                    <Text style={{ fontSize: 13, color: colors.danger, fontWeight: weight.medium }}>Decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Active coach card OR Join a Coach */}
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
        <View style={{
          backgroundColor: colors.bgCard, borderRadius: 18,
          borderWidth: 1, borderColor: colors.border,
          padding: 20, marginBottom: 12, alignItems: 'center', gap: 14,
        }}>
          <View style={{
            width: 72, height: 72, borderRadius: 36,
            backgroundColor: colors.accent + '14',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name="people-circle-outline" size={44} color={colors.accent + 'aa'} />
          </View>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 17, fontWeight: weight.bold, color: colors.text }}>No Coach Yet</Text>
            <Text style={{ fontSize: 13, color: colors.textDim, textAlign: 'center', lineHeight: 19 }}>
              Enter an invite code from your coach{'\n'}to get connected and start tracking together.
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
            <TextInput
              style={{
                flex: 1, backgroundColor: colors.bgElevated, color: colors.text,
                borderRadius: 12, borderWidth: 1.5, borderColor: colors.border,
                paddingHorizontal: 14, paddingVertical: 11, fontSize: 15,
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
              activeOpacity={0.75}
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
                : <Text style={{ color: colors.bg, fontWeight: weight.bold, fontSize: 14 }}>Join</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Privacy / Visibility */}
      <View style={{
        backgroundColor: colors.bgCard, borderRadius: 18,
        borderWidth: 1, borderColor: colors.border,
        overflow: 'hidden', marginBottom: 12,
      }}>
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          paddingHorizontal: 16, paddingVertical: 13,
          borderBottomWidth: 1, borderBottomColor: colors.border,
        }}>
          <View style={{
            width: 32, height: 32, borderRadius: 16,
            backgroundColor: colors.accent + '18',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              Privacy & Visibility
            </Text>
            <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>
              Choose what your coach can see
            </Text>
          </View>
          {!isPro && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: colors.accent + '20', borderRadius: 24,
              paddingHorizontal: 8, paddingVertical: 3,
            }}>
              <Ionicons name="rocket" size={10} color={colors.accent} />
              <Text style={{ fontSize: 10, fontWeight: weight.bold, color: colors.accent }}>PRO</Text>
            </View>
          )}
          {isPro && saving && <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: 4 }} />}
        </View>

        {PRIVACY_ITEMS.map(({ key, label, icon, desc }) => (
          <View
            key={key}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              paddingHorizontal: 16, paddingVertical: 12,
              borderBottomWidth: 1, borderBottomColor: colors.border,
              opacity: isPro ? 1 : 0.5,
            }}
          >
            <View style={{
              width: 34, height: 34, borderRadius: 10,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: (isPro && visibility[key]) ? colors.accent + '18' : colors.bgElevated,
            }}>
              <Ionicons
                name={isPro ? icon : 'lock-closed'}
                size={16}
                color={(isPro && visibility[key]) ? colors.accent : colors.textDim}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text }}>{label}</Text>
              <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 1 }}>{desc}</Text>
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
            activeOpacity={0.75}
            onPress={() => navigation.navigate('Subscription')}
            style={{
              margin: 14, marginTop: 6,
              backgroundColor: colors.accent, borderRadius: 14,
              paddingVertical: 13, flexDirection: 'row',
              alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <Ionicons name="rocket" size={15} color={colors.bg} />
            <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.bg }}>
              Upgrade to Pro to unlock privacy controls
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Danger zone — disconnect link */}
      {activeCoach && (
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={handleDisconnect}
          style={{ alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 4, marginTop: 4 }}
        >
          <Text style={{ fontSize: 12, color: colors.danger, fontWeight: weight.medium }}>
            Disconnect from coach
          </Text>
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
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6,
      }}>
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => navigation.goBack()}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: colors.bgCard,
            borderWidth: 1, borderColor: colors.border,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={{
          flex: 1, textAlign: 'center',
          fontSize: typography.lg, fontWeight: weight.bold, color: colors.text,
        }}>
          Coach Zone
        </Text>
        <View style={{ width: 36, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="people" size={22} color={colors.accent} />
        </View>
      </View>

      {/* Segmented pill tab switcher */}
      <View style={{
        flexDirection: 'row', marginHorizontal: 16, marginTop: 8, marginBottom: 8,
        backgroundColor: colors.bgCard, borderRadius: 24,
        borderWidth: 1, borderColor: colors.border,
        padding: 4, gap: 4,
      }}>
        {[
          { key: 'coach', label: "I'm a Coach", icon: 'trophy-outline' },
          { key: 'client', label: "I'm a Client", icon: 'person-outline' },
        ].map(t => (
          <TouchableOpacity
            key={t.key}
            activeOpacity={0.75}
            onPress={() => setTab(t.key)}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 6, paddingVertical: 10, borderRadius: 24,
              backgroundColor: tab === t.key ? colors.accent : 'transparent',
            }}
          >
            <Ionicons name={t.icon} size={15} color={tab === t.key ? colors.bg : colors.textDim} />
            <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: tab === t.key ? colors.bg : colors.textDim }}>
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
