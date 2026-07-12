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
import { useSubscription } from '../context/SubscriptionContext';
import { supabase } from '../lib/supabase';
import { weight } from '../theme/typography';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentWeekLabel() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const mon = new Date(now);
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${fmt(mon)} – ${fmt(sun)}`;
}

function timeAgo(ts) {
  if (!ts) return null;
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  const days = Math.floor(secs / 86400);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function fetchCoachClients(userId) {
  const { data, error } = await supabase
    .from('coach_clients')
    .select('*')
    .eq('coach_id', userId)
    .neq('status', 'removed')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const clientIds = rows.filter(r => r.client_id && r.status === 'active').map(r => r.client_id);

  let profileMap = {};
  if (clientIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, goal, step_goal, coach_visibility')
      .in('id', clientIds);
    (profiles ?? []).forEach(p => { profileMap[p.id] = p; });
  }

  // Unread messages: messages sent by clients after coach_last_read
  let unreadMap = {};
  if (clientIds.length > 0) {
    const { data: msgs } = await supabase
      .from('coach_messages')
      .select('client_id, created_at')
      .eq('coach_id', userId)
      .neq('sender_id', userId)
      .order('created_at', { ascending: false })
      .limit(500);
    for (const msg of msgs ?? []) {
      const link = rows.find(r => r.client_id === msg.client_id);
      if (!link) continue;
      if (!link.coach_last_read || new Date(msg.created_at) > new Date(link.coach_last_read)) {
        unreadMap[msg.client_id] = (unreadMap[msg.client_id] ?? 0) + 1;
      }
    }
  }

  // Last activity + weekly stats per client
  let lastActivityMap = {};
  let weeklyStatsMap = {};
  if (clientIds.length > 0) {
    const lim = clientIds.length * 5;
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const [wkRes, wgRes, stRes, slRes] = await Promise.all([
      supabase.from('workout_sessions').select('user_id, date, notes').in('user_id', clientIds)
        .order('date', { ascending: false }).limit(lim),
      supabase.from('weight_logs').select('user_id, weight, logged_at').in('user_id', clientIds)
        .gte('logged_at', weekAgo + 'T00:00:00'),
      supabase.from('step_logs').select('user_id, steps, logged_at').in('user_id', clientIds)
        .gte('logged_at', weekAgo + 'T00:00:00'),
      supabase.from('sleep_logs').select('user_id, hours').in('user_id', clientIds)
        .gte('logged_at', weekAgo + 'T00:00:00'),
    ]);
    const bump = (uid, ts) => {
      if (!lastActivityMap[uid] || ts > lastActivityMap[uid]) lastActivityMap[uid] = ts;
    };
    for (const r of wkRes.data ?? []) bump(r.user_id, new Date(r.date + 'T12:00:00').getTime());
    for (const r of wgRes.data ?? []) bump(r.user_id, new Date(r.logged_at).getTime());
    for (const r of stRes.data ?? []) bump(r.user_id, new Date(r.logged_at).getTime());

    const avgOf = (arr, key) => {
      if (!arr.length) return 0;
      const sum = arr.reduce((s, x) => s + (x[key] ?? 0), 0);
      return Math.round((sum / arr.length) * 10) / 10;
    };
    for (const clientId of clientIds) {
      const isStrength = r => {
        const n = (r.notes ?? '').toLowerCase();
        return !n.includes('rest') && !n.includes('cardio') && !n.includes('run') && !n.includes('cycle');
      };
      const wkWeek = (wkRes.data ?? []).filter(r => r.user_id === clientId && r.date >= weekAgo && isStrength(r));
      const weights = (wgRes.data ?? []).filter(r => r.user_id === clientId);
      const steps   = (stRes.data ?? []).filter(r => r.user_id === clientId);
      const sleep   = (slRes.data ?? []).filter(r => r.user_id === clientId);
      weeklyStatsMap[clientId] = {
        workouts:  wkWeek.length,
        avgWeight: avgOf(weights, 'weight'),
        avgSteps:  Math.round(avgOf(steps, 'steps')),
        avgSleep:  avgOf(sleep, 'hours'),
      };
    }
  }

  return rows.map(r => ({
    ...r,
    client: profileMap[r.client_id] ?? null,
    unreadCount: unreadMap[r.client_id] ?? 0,
    lastActivityTs: lastActivityMap[r.client_id] ?? null,
    weeklyStats: weeklyStatsMap[r.client_id] ?? null,
  }));
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
  const [copiedLink, setCopiedLink] = useState(false);

  const handleCopyCode = async () => {
    await copyToClipboard(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLink = async () => {
    await copyToClipboard(`fitzo://join?code=${code}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <View style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', zIndex: 999,
    }}>
      <View style={{
        backgroundColor: colors.bgCard, borderRadius: 28, padding: 32,
        width: '88%', alignItems: 'center', gap: 16,
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

        {/* Copy code */}
        <TouchableOpacity onPress={handleCopyCode} activeOpacity={0.75} style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          backgroundColor: copied ? '#22c55e20' : colors.accent + '18',
          borderWidth: 1.5, borderColor: copied ? '#22c55e' : colors.accent,
          paddingVertical: 13, borderRadius: 14, width: '100%',
        }}>
          <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={18} color={copied ? '#22c55e' : colors.accent} />
          <Text style={{ fontSize: 15, fontWeight: weight.bold, color: copied ? '#22c55e' : colors.accent }}>
            {copied ? 'Code Copied!' : 'Copy Code'}
          </Text>
        </TouchableOpacity>

        {/* Copy link */}
        <TouchableOpacity onPress={handleCopyLink} activeOpacity={0.75} style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          backgroundColor: copiedLink ? '#22c55e20' : colors.bg,
          borderWidth: 1.5, borderColor: copiedLink ? '#22c55e' : colors.border,
          paddingVertical: 13, borderRadius: 14, width: '100%',
        }}>
          <Ionicons name={copiedLink ? 'checkmark-circle' : 'link-outline'} size={18} color={copiedLink ? '#22c55e' : colors.textDim} />
          <Text style={{ fontSize: 15, fontWeight: weight.bold, color: copiedLink ? '#22c55e' : colors.textDim }}>
            {copiedLink ? 'Link Copied!' : 'Copy Invite Link'}
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

function AddClientSheet({ visible, onClose, userId, clientLinks, colors, onGenerate, generating, isPro, activeCount, onUpgrade }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState(null);
  const qc = useQueryClient();

  const limitReached = !isPro && activeCount >= 2;

  useEffect(() => {
    if (!visible) { setSearchQuery(''); setSearchResults([]); }
  }, [visible]);

  const handleSearch = async (text) => {
    setSearchQuery(text);
    if (text.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const existingIds = clientLinks.filter(l => l.client_id).map(l => l.client_id);
    const { data } = await supabase.from('profiles').select('id, full_name, goal, email').ilike('full_name', `%${text.trim()}%`).neq('id', userId).limit(10);
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
        <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 19, fontWeight: weight.black, color: colors.text }}>Add a client</Text>
            {!isPro && (
              <View style={{ backgroundColor: colors.accent + '18', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: colors.accent + '35' }}>
                <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.accent }}>{activeCount}/2 FREE</Text>
              </View>
            )}
          </View>

          {limitReached ? (
            /* ── Paywall state ── */
            <View style={{ gap: 16, paddingVertical: 8 }}>
              <View style={{ alignItems: 'center', paddingVertical: 20, gap: 12 }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accent + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="lock-closed" size={28} color={colors.accent} />
                </View>
                <Text style={{ fontSize: 17, fontWeight: weight.black, color: colors.text, textAlign: 'center' }}>
                  Free plan limit reached
                </Text>
                <Text style={{ fontSize: 13, color: colors.textDim, textAlign: 'center', lineHeight: 20 }}>
                  You've used both free client slots.{'\n'}Upgrade to Pro to coach unlimited clients.
                </Text>
              </View>

              {/* What you get */}
              <View style={{ backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 }}>
                {[
                  { icon: 'people', text: 'Unlimited clients' },
                  { icon: 'eye-off-outline', text: 'Clients can restrict data visibility' },
                  { icon: 'analytics-outline', text: 'Advanced client insights' },
                  { icon: 'ribbon-outline', text: 'Pro coach badge on profile' },
                ].map(({ icon, text }) => (
                  <View key={text} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.accent + '18', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={icon} size={14} color={colors.accent} />
                    </View>
                    <Text style={{ fontSize: 13, color: colors.text }}>{text}</Text>
                  </View>
                ))}
              </View>

              <TouchableOpacity onPress={() => { onClose(); onUpgrade(); }} activeOpacity={0.85}
                style={{ backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: weight.black, color: colors.bg }}>Upgrade to Pro →</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: colors.textDim }}>Not now</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* ── Normal add state ── */
            <>
              {!isPro && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.accent + '10', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.accent + '25' }}>
                  <Ionicons name="information-circle-outline" size={15} color={colors.accent} />
                  <Text style={{ flex: 1, fontSize: 11, color: colors.textDim, lineHeight: 16 }}>
                    Free plan: you can add <Text style={{ fontWeight: weight.bold, color: colors.text }}>up to 2 clients</Text>. You have {2 - activeCount} slot{2 - activeCount !== 1 ? 's' : ''} remaining.
                  </Text>
                </View>
              )}

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

              {searchResults.length > 0 && (
                <View style={{ backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
                  {searchResults.map((p, i) => (
                    <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border }}>
                      <Avatar name={p.full_name} size={40} fontSize={13} bg={colors.accent + '20'} color={colors.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: weight.semibold, color: colors.text }}>{p.full_name}</Text>
                        {p.email ? <Text style={{ fontSize: 11, color: colors.textDim }} numberOfLines={1}>{p.email}</Text> : p.goal ? <Text style={{ fontSize: 11, color: colors.textDim }}>{p.goal}</Text> : null}
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
                  <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.text }}>One-time invite code</Text>
                  <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 1 }}>Generate → copy code or link to share</Text>
                </View>
                <View style={{ backgroundColor: colors.accent, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: weight.bold, color: colors.bg }}>Generate</Text>
                </View>
              </TouchableOpacity>
            </>
          )}
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

// ─── Client Notes Sheet ───────────────────────────────────────────────────────

function ClientNotesSheet({ visible, onClose, link, colors, onSaved }) {
  const [privateNote, setPrivateNote] = useState('');
  const [clientNote, setClientNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && link) {
      setPrivateNote(link.notes ?? '');
      setClientNote(link.coach_note ?? '');
    }
  }, [visible, link?.id]);

  const handleSave = async () => {
    if (!link) return;
    setSaving(true);
    const { error } = await supabase
      .from('coach_clients')
      .update({ notes: privateNote || null, coach_note: clientNote || null })
      .eq('id', link.id);
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    onSaved(link.id, { notes: privateNote || null, coach_note: clientNote || null });
    onClose();
  };

  const clientName = link?.client?.full_name ?? 'Client';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        backgroundColor: colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24,
        borderTopWidth: 1, borderColor: colors.border, paddingBottom: 44,
      }}>
        <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 19, fontWeight: weight.black, color: colors.text }}>Notes</Text>
              <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }}>{clientName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <Ionicons name="close" size={22} color={colors.textDim} />
            </TouchableOpacity>
          </View>

          {/* Private notes — only coach sees */}
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="lock-closed-outline" size={13} color={colors.textDim} />
              <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1 }}>YOUR PRIVATE NOTES</Text>
            </View>
            <Text style={{ fontSize: 12, color: colors.textDim, lineHeight: 17 }}>
              Only you can see this — personal observations, reminders, strategies.
            </Text>
            <TextInput
              value={privateNote}
              onChangeText={setPrivateNote}
              placeholder="e.g. Recovering from knee injury, avoid squats for now…"
              placeholderTextColor={colors.textDim}
              multiline
              style={{
                backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1.5,
                borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12,
                fontSize: 14, color: colors.text, minHeight: 100, textAlignVertical: 'top', lineHeight: 20,
              }}
            />
          </View>

          {/* Coach note for client — client can read */}
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="eye-outline" size={13} color={colors.accent} />
              <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.accent, letterSpacing: 1 }}>NOTE FOR CLIENT</Text>
            </View>
            <Text style={{ fontSize: 12, color: colors.textDim, lineHeight: 17 }}>
              Visible to {clientName} on their Coach Zone page — use for weekly focus, motivation, or feedback.
            </Text>
            <TextInput
              value={clientNote}
              onChangeText={setClientNote}
              placeholder="e.g. Focus on protein this week. Great progress on deadlifts!"
              placeholderTextColor={colors.textDim}
              multiline
              style={{
                backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1.5,
                borderColor: colors.accent + '40', paddingHorizontal: 14, paddingVertical: 12,
                fontSize: 14, color: colors.text, minHeight: 80, textAlignVertical: 'top', lineHeight: 20,
              }}
            />
          </View>

          <TouchableOpacity onPress={handleSave} disabled={saving} activeOpacity={0.8}
            style={{ backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: saving ? 0.7 : 1 }}>
            {saving ? <ActivityIndicator size="small" color={colors.bg} /> : <Ionicons name="checkmark-circle" size={17} color={colors.bg} />}
            <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.bg }}>Save Notes</Text>
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
  const { isPro } = useSubscription();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const userId = user?.id;

  const [inviteCode, setInviteCode] = useState(null);
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [editSheetVisible, setEditSheetVisible] = useState(false);
  const [notesLink, setNotesLink] = useState(null);
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
  const totalUnread = active.reduce((sum, l) => sum + (l.unreadCount ?? 0), 0);

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

  // Optimistically update notes in the list without refetch
  const handleNotesSaved = (linkId, { notes, coach_note }) => {
    qc.setQueryData(['coachClients', userId], prev =>
      (prev ?? []).map(l => l.id === linkId ? { ...l, notes, coach_note } : l)
    );
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
        {totalUnread > 0 && (
          <View style={{ backgroundColor: colors.danger, borderRadius: 12, minWidth: 24, height: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: weight.black, color: '#fff' }}>{totalUnread}</Text>
          </View>
        )}
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

          <View style={{ padding: 16, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Avatar name={profile.full_name || '?'} size={56} fontSize={18} bg={colors.accent + '25'} color={colors.accent} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 18, fontWeight: weight.black, color: colors.text }}>{profile.full_name || 'Your Name'}</Text>
                <Text style={{ fontSize: 12, color: colors.textDim }}>
                  {profile.goal || 'No specialty set'}{' · Coach'}
                </Text>
                {profile.goal ? (
                  <View style={{ alignSelf: 'flex-start', marginTop: 4, backgroundColor: colors.accent + '18', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.accent + '35' }}>
                    <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.accent }}>{profile.goal}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View style={{ height: 1, backgroundColor: colors.border }} />
            <View style={{ flexDirection: 'row' }}>
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
          {!isPro && (
            <Text style={{ fontSize: 10, color: colors.textDim, marginRight: 6 }}>
              {active.length}/2 free
            </Text>
          )}
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
              const unread = link.unreadCount ?? 0;
              const lastActivity = link.lastActivityTs ? timeAgo(link.lastActivityTs) : null;
              const ws = link.weeklyStats;
              // Respect client's coach_visibility — if a key is false, show '—' for that stat
              const vis = { workouts: true, weight: true, steps: true, sleep: true, food: true, ...(link.client?.coach_visibility ?? {}) };
              const STATS = [
                { icon: 'barbell-outline',  color: colors.accent, visKey: 'workouts', label: 'WORKOUTS',   sublabel: 'strength only',  value: ws?.workouts ?? 0,  fmt: v => String(v) },
                { icon: 'footsteps-outline',color: '#22c55e',     visKey: 'steps',    label: 'AVG STEPS',  sublabel: '7-day avg',  value: ws?.avgSteps ?? 0,  fmt: v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : (v || '—') },
                { icon: 'moon-outline',     color: '#6366f1',     visKey: 'sleep',    label: 'AVG SLEEP',  sublabel: '7-day avg',  value: ws?.avgSleep ?? 0,  fmt: v => v ? `${v}h` : '—' },
                { icon: 'scale-outline',    color: '#f97316',     visKey: 'weight',   label: 'AVG WEIGHT', sublabel: '7-day avg',  value: ws?.avgWeight ?? 0, fmt: v => v ? `${v}kg` : '—' },
              ];
              return (
                <TouchableOpacity
                  key={link.id}
                  onPress={() => navigation.navigate('ClientDetail', { clientId: link.client?.id, clientName: name })}
                  activeOpacity={0.75}
                  style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: unread > 0 ? colors.danger + '60' : colors.border, padding: 14, marginBottom: 12 }}
                >
                  {/* ── Top row: avatar + name + unread + notes btn + chevron ── */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <View style={{ position: 'relative' }}>
                      <Avatar name={name} size={44} fontSize={14} bg={colors.accent + '22'} color={colors.accent} />
                      {unread > 0 && (
                        <View style={{ position: 'absolute', top: -2, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bgCard }}>
                          <Text style={{ fontSize: 10, fontWeight: weight.black, color: '#fff' }}>{unread > 9 ? '9+' : unread}</Text>
                        </View>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.text }}>{name}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
                        {link.client?.goal ? <Text style={{ fontSize: 11, color: colors.textDim }}>{link.client.goal}</Text> : null}
                        {link.client?.goal && lastActivity ? <Text style={{ fontSize: 11, color: colors.textDim }}>·</Text> : null}
                        {lastActivity
                          ? <Text style={{ fontSize: 11, color: colors.accent }}>Active {lastActivity}</Text>
                          : <Text style={{ fontSize: 11, color: colors.textDim }}>No recent activity</Text>}
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => setNotesLink(link)}
                      activeOpacity={0.7}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: link.notes || link.coach_note ? colors.accent + '20' : colors.bg, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, borderWidth: 1, borderColor: link.notes || link.coach_note ? colors.accent + '50' : colors.border }}
                    >
                      <Ionicons name="document-text-outline" size={13} color={link.notes || link.coach_note ? colors.accent : colors.textDim} />
                      <Text style={{ fontSize: 11, fontWeight: weight.bold, color: link.notes || link.coach_note ? colors.accent : colors.textDim }}>Notes</Text>
                    </TouchableOpacity>
                    <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
                  </View>

                  {link.notes ? (
                    <Text style={{ fontSize: 11, color: colors.textDim, marginBottom: 8, fontStyle: 'italic' }} numberOfLines={1}>📝 {link.notes}</Text>
                  ) : null}

                  {/* ── Week at a glance ── */}
                  <View style={{ height: 1, backgroundColor: colors.border, marginBottom: 10 }} />
                  {/* Week header */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 }}>
                    <Ionicons name="calendar-outline" size={11} color={colors.textDim} />
                    <Text style={{ fontSize: 10, color: colors.textDim, fontWeight: weight.bold, letterSpacing: 0.4 }}>
                      THIS WEEK · {currentWeekLabel()}
                    </Text>
                  </View>
                  {/* 4-column grid */}
                  <View style={{ flexDirection: 'row' }}>
                    {STATS.map(({ icon, color, visKey, label, sublabel, value, fmt }, idx, arr) => {
                      const allowed = vis[visKey] !== false;
                      return (
                        <React.Fragment key={label}>
                          <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                            <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: allowed ? color + '18' : colors.border + '40', alignItems: 'center', justifyContent: 'center' }}>
                              <Ionicons name={allowed ? icon : 'lock-closed'} size={14} color={allowed ? color : colors.textDim} />
                            </View>
                            <Text style={{ fontSize: 15, fontWeight: weight.black, color: allowed ? colors.text : colors.textDim }}>
                              {allowed ? fmt(value) : '—'}
                            </Text>
                            <Text style={{ fontSize: 9, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 0.3, textAlign: 'center' }}>{label}</Text>
                            <Text style={{ fontSize: 9, color: allowed ? colors.textDim : '#f97316', textAlign: 'center', marginTop: -2 }}>
                              {allowed ? sublabel : 'Restricted'}
                            </Text>
                          </View>
                          {idx < arr.length - 1 && <View style={{ width: 1, backgroundColor: colors.border }} />}
                        </React.Fragment>
                      );
                    })}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* ── Free tier limit banner ───────────────────────────────── */}
        {!isPro && active.length >= 2 && (
          <TouchableOpacity
            onPress={() => navigation.navigate('Subscription')}
            activeOpacity={0.85}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.accent + '15', borderRadius: 16, borderWidth: 1, borderColor: colors.accent + '40', padding: 14, marginBottom: 20 }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.accent + '25', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="lock-closed" size={16} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: weight.bold, color: colors.text }}>Free plan: 2 client limit reached</Text>
              <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>Upgrade to Pro for unlimited clients →</Text>
            </View>
          </TouchableOpacity>
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
        isPro={isPro}
        activeCount={active.length}
        onUpgrade={() => navigation.navigate('Subscription')}
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

      <ClientNotesSheet
        visible={!!notesLink}
        onClose={() => setNotesLink(null)}
        link={notesLink}
        colors={colors}
        onSaved={handleNotesSaved}
      />

      {inviteCode && <InviteOverlay code={inviteCode} onClose={() => setInviteCode(null)} colors={colors} />}
    </SafeAreaView>
  );
}
