import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Switch,
  Alert, ActivityIndicator, TextInput, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import { supabase } from '../lib/supabase';
import { weight } from '../theme/typography';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIVACY_ITEMS = [
  { key: 'workouts', label: 'Workouts & Sets',  icon: 'barbell-outline',    desc: 'Sessions, exercises, sets, reps, RPE' },
  { key: 'weight',   label: 'Body Weight',       icon: 'scale-outline',      desc: 'Weight logs & trend chart' },
  { key: 'steps',    label: 'Steps & Activity',  icon: 'footsteps-outline',  desc: 'Daily step counts' },
  { key: 'sleep',    label: 'Sleep',             icon: 'moon-outline',       desc: 'Hours slept & sleep quality' },
  { key: 'food',     label: 'Nutrition',         icon: 'restaurant-outline', desc: 'Calories & macro breakdown' },
];
const DEFAULT_VIS = { workouts: true, weight: true, steps: true, sleep: true, food: true };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts) return null;
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  const days = Math.floor(secs / 86400);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function avgArr(arr, key) {
  if (!arr || arr.length === 0) return 0;
  return Math.round(arr.reduce((s, x) => s + (x[key] ?? 0), 0) / arr.length);
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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ClientModeScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { isPro } = useSubscription();
  const navigation = useNavigation();
  const userId = user?.id;

  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [visibility, setVisibility] = useState(DEFAULT_VIS);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeCoach, setActiveCoach] = useState(null);
  const [linkedSince, setLinkedSince] = useState(null);
  const [linkId, setLinkId] = useState(null);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [lastMessage, setLastMessage] = useState(null);
  const [coachNote, setCoachNote] = useState(null);
  const [weeklySummary, setWeeklySummary] = useState(null);

  const loadClientData = async () => {
    if (!userId) return;

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    const [visRes, activeRes, pendingRes, wkRes, stRes, slRes, flRes] = await Promise.all([
      supabase.from('profiles').select('coach_visibility').eq('id', userId).single(),
      supabase.from('coach_clients').select('*').eq('client_id', userId).eq('status', 'active').limit(1).single(),
      supabase.from('coach_clients').select('id, coach_id, created_at').eq('client_id', userId).eq('status', 'pending').is('invite_code', null),
      supabase.from('workout_sessions').select('id').eq('user_id', userId).gte('date', sevenDaysAgo),
      supabase.from('step_logs').select('steps').eq('user_id', userId).gte('logged_at', sevenDaysAgo + 'T00:00:00'),
      supabase.from('sleep_logs').select('hours').eq('user_id', userId).gte('logged_at', sevenDaysAgo + 'T00:00:00'),
      supabase.from('food_logs').select('calories').eq('user_id', userId).gte('logged_at', sevenDaysAgo + 'T00:00:00'),
    ]);

    const storedVis = visRes.data?.coach_visibility ? { ...DEFAULT_VIS, ...visRes.data.coach_visibility } : DEFAULT_VIS;
    // Free users: ensure all categories are visible to coach; reset DB if any were restricted
    if (!isPro) {
      const anyRestricted = Object.values(storedVis).some(v => v === false);
      if (anyRestricted) {
        await supabase.from('profiles').update({ coach_visibility: DEFAULT_VIS }).eq('id', userId);
      }
      setVisibility(DEFAULT_VIS);
    } else {
      setVisibility(storedVis);
    }

    // Weekly summary
    setWeeklySummary({
      workouts: wkRes.data?.length ?? 0,
      avgSteps: avgArr(stRes.data, 'steps'),
      avgSleep: avgArr(slRes.data, 'hours'),
      avgCalories: avgArr(flRes.data, 'calories'),
    });

    setLoaded(true);

    if (activeRes.data?.coach_id) {
      const link = activeRes.data;
      setLinkId(link.id);
      setLinkedSince(link.created_at);
      setCoachNote(link.coach_note ?? null);

      const [profRes, msgRes] = await Promise.all([
        supabase.from('profiles').select('full_name, bio, goal, sex').eq('id', link.coach_id).single(),
        supabase.from('coach_messages')
          .select('sender_id, message, created_at')
          .eq('coach_id', link.coach_id)
          .eq('client_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single(),
      ]);

      setActiveCoach({ coach_id: link.coach_id, ...(profRes.data ?? {}) });
      setLastMessage(msgRes.data ?? null);

      // Mark client's last read time
      supabase.from('coach_clients')
        .update({ client_last_read: new Date().toISOString() })
        .eq('id', link.id)
        .then(() => {});
    } else {
      setActiveCoach(null);
      setLastMessage(null);
      setCoachNote(null);
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

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadClientData();
    setRefreshing(false);
  };

  const handleToggle = async (key, val) => {
    const next = { ...visibility, [key]: val };
    setVisibility(next);
    setSaving(true);
    await supabase.from('profiles').update({ coach_visibility: next }).eq('id', userId);
    setSaving(false);
  };

  const handleJoin = async () => {
    let code = inviteCode.trim();
    // Handle deep link format: fitzo://join?code=XXXX or https://fitzo.app/join?code=XXXX
    const match = code.match(/[?&]code=([A-Za-z0-9]+)/i);
    if (match) code = match[1];
    code = code.toUpperCase();
    if (!code) return;
    setJoining(true);
    try {
      const { data, error } = await supabase.rpc('accept_coach_invite', { p_code: code });
      if (error) throw error;
      if (data) {
        setInviteCode('');
        Alert.alert('Connected!', 'You are now linked to your coach.');
        await loadClientData();
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
        setActiveCoach(null); setLinkedSince(null); setLinkId(null); setLastMessage(null); setCoachNote(null);
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

  const enabledCount = isPro ? Object.values(visibility).filter(Boolean).length : PRIVACY_ITEMS.length;
  const coachingSince = linkedSince
    ? new Date(linkedSince).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null;

  if (!loaded) return (
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
          <Text style={{ fontSize: 11, fontWeight: weight.bold, color: '#22c55e', letterSpacing: 1.2 }}>CLIENT VIEW</Text>
        </View>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#22c55e18', borderWidth: 1, borderColor: '#22c55e35', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="person-outline" size={18} color="#22c55e" />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#22c55e" colors={['#22c55e']} />}
      >

        {/* ── Pending invitations ──────────────────────────────────── */}
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

        {/* ── Active coach card ─────────────────────────────────────── */}
        {activeCoach ? (
          <>
            <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, overflow: 'hidden', marginBottom: 12, borderWidth: 1, borderColor: colors.border }}>

              <View style={{ padding: 18, gap: 14 }}>
                {/* Identity */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <Avatar name={activeCoach.full_name || 'Coach'} size={56} fontSize={18} bg={colors.accent + '25'} color={colors.accent} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontSize: 17, fontWeight: weight.black, color: colors.text }}>
                        {activeCoach.full_name || 'Your Coach'}
                      </Text>
                      <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                    </View>
                    <Text style={{ fontSize: 12, color: colors.textDim }}>
                      {activeCoach.goal || 'Coach'}
                    </Text>
                    {activeCoach.goal ? (
                      <View style={{ alignSelf: 'flex-start', marginTop: 4, backgroundColor: colors.accent + '18', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.accent + '35' }}>
                        <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.accent }}>{activeCoach.goal}</Text>
                      </View>
                    ) : null}
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

                {/* Stats row */}
                <View style={{ height: 1, backgroundColor: colors.border }} />
                <View style={{ flexDirection: 'row' }}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.accent + '15', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="calendar-outline" size={16} color={colors.accent} />
                    </View>
                    <View>
                      <Text style={{ fontSize: 13, fontWeight: weight.black, color: colors.text }}>{coachingSince}</Text>
                      <Text style={{ fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 0.5 }}>COACHING SINCE</Text>
                    </View>
                  </View>
                  <View style={{ width: 1, backgroundColor: colors.border, marginHorizontal: 12 }} />
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.accent + '15', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="time-outline" size={16} color={colors.accent} />
                    </View>
                    <View>
                      <Text style={{ fontSize: 13, fontWeight: weight.black, color: colors.text }}>{'< 24 hrs'}</Text>
                      <Text style={{ fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 0.5 }}>REPLY TIME</Text>
                    </View>
                  </View>
                </View>

                {/* Last message preview */}
                {lastMessage && (
                  <TouchableOpacity
                    onPress={() => navigation.navigate('CoachChat', { coachId: activeCoach.coach_id, clientId: userId, coachName: activeCoach.full_name ?? 'Coach' })}
                    activeOpacity={0.75}
                    style={{ backgroundColor: colors.bg, borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border }}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.textDim} />
                    <Text style={{ flex: 1, fontSize: 12, color: colors.textDim }} numberOfLines={1}>
                      {lastMessage.sender_id === userId ? 'You: ' : `${activeCoach.full_name?.split(' ')[0] ?? 'Coach'}: `}
                      {lastMessage.message}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.textDim }}>{timeAgo(lastMessage.created_at)}</Text>
                    <Ionicons name="chevron-forward" size={13} color={colors.textDim} />
                  </TouchableOpacity>
                )}

                {/* Message button */}
                <TouchableOpacity
                  onPress={() => navigation.navigate('CoachChat', { coachId: activeCoach.coach_id, clientId: userId, coachName: activeCoach.full_name ?? 'Coach' })}
                  activeOpacity={0.8}
                  style={{ backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  <Ionicons name="chatbubble-ellipses" size={17} color={colors.bg} />
                  <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.bg }}>Message Coach</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ── Coach's Note for You ──────────────────────────────── */}
            {coachNote ? (
              <View style={{ backgroundColor: colors.accent + '10', borderRadius: 16, borderWidth: 1, borderColor: colors.accent + '35', borderLeftWidth: 3, borderLeftColor: colors.accent, padding: 16, marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Ionicons name="chatbubble-outline" size={13} color={colors.accent} />
                  <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.accent, letterSpacing: 0.8 }}>NOTE FROM YOUR COACH</Text>
                </View>
                <Text style={{ fontSize: 14, color: colors.text, lineHeight: 21 }}>{coachNote}</Text>
              </View>
            ) : null}

            {/* ── Your Week at a Glance ─────────────────────────────── */}
            {weeklySummary && (
              <View style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                  <Ionicons name="stats-chart" size={14} color="#22c55e" />
                  <Text style={{ fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1 }}>YOUR WEEK AT A GLANCE</Text>
                  <Text style={{ fontSize: 10, color: colors.textDim, marginLeft: 2 }}>· what your coach sees</Text>
                </View>
                <View style={{ flexDirection: 'row' }}>
                  <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.accent + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                      <Ionicons name="barbell-outline" size={17} color={colors.accent} />
                    </View>
                    <Text style={{ fontSize: 22, fontWeight: weight.black, color: colors.text }}>{weeklySummary.workouts}</Text>
                    <Text style={{ fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 0.5 }}>WORKOUTS</Text>
                  </View>
                  <View style={{ width: 1, backgroundColor: colors.border, marginHorizontal: 8 }} />
                  <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: '#22c55e18', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                      <Ionicons name="footsteps-outline" size={17} color="#22c55e" />
                    </View>
                    <Text style={{ fontSize: 22, fontWeight: weight.black, color: colors.text }}>
                      {weeklySummary.avgSteps >= 1000 ? `${(weeklySummary.avgSteps / 1000).toFixed(1)}k` : weeklySummary.avgSteps || '—'}
                    </Text>
                    <Text style={{ fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 0.5 }}>AVG STEPS</Text>
                  </View>
                  <View style={{ width: 1, backgroundColor: colors.border, marginHorizontal: 8 }} />
                  <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: '#6366f118', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                      <Ionicons name="moon-outline" size={17} color="#6366f1" />
                    </View>
                    <Text style={{ fontSize: 22, fontWeight: weight.black, color: colors.text }}>
                      {weeklySummary.avgSleep ? `${weeklySummary.avgSleep}h` : '—'}
                    </Text>
                    <Text style={{ fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 0.5 }}>AVG SLEEP</Text>
                  </View>
                  <View style={{ width: 1, backgroundColor: colors.border, marginHorizontal: 8 }} />
                  <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: '#f97316' + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                      <Ionicons name="flame-outline" size={17} color="#f97316" />
                    </View>
                    <Text style={{ fontSize: 22, fontWeight: weight.black, color: colors.text }}>
                      {weeklySummary.avgCalories ? `${(weeklySummary.avgCalories / 1000).toFixed(1)}k` : '—'}
                    </Text>
                    <Text style={{ fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 0.5 }}>AVG KCAL</Text>
                  </View>
                </View>
              </View>
            )}
          </>
        ) : (
          /* ── No Coach — Join form ─────────────────────────────────── */
          <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 24, marginBottom: 20, alignItems: 'center', gap: 16 }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accent + '15', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="people-circle-outline" size={40} color={colors.accent} />
            </View>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: weight.black, color: colors.text }}>No Coach Yet</Text>
              <Text style={{ fontSize: 13, color: colors.textDim, textAlign: 'center', lineHeight: 19 }}>
                Enter a coach's invite code or paste an invite link
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <TextInput
                style={{ flex: 1, backgroundColor: colors.bg, color: colors.text, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontWeight: weight.bold, letterSpacing: 2, textAlign: 'center' }}
                placeholder="Code or invite link"
                placeholderTextColor={colors.textDim}
                value={inviteCode}
                onChangeText={setInviteCode}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={handleJoin} disabled={joining || !inviteCode.trim()} activeOpacity={0.8}
                style={{ backgroundColor: colors.accent, borderRadius: 14, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', opacity: (!inviteCode.trim() || joining) ? 0.5 : 1 }}>
                {joining
                  ? <ActivityIndicator size="small" color={colors.bg} />
                  : <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.bg }}>Join</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Shared with Coach toggles ─────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <Text style={{ flex: 1, fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Shared with Coach
          </Text>
          <Text style={{ fontSize: 13, fontWeight: weight.bold, color: colors.textDim }}>
            {enabledCount}/{PRIVACY_ITEMS.length}
          </Text>
        </View>
        <Text style={{ fontSize: 12, color: colors.textDim, marginBottom: 10, lineHeight: 17 }}>
          {isPro
            ? 'Control exactly what your coach can see. Toggle off anything you\'d prefer to keep private.'
            : 'Your coach can see all your health data. Upgrade to Pro to restrict specific categories.'}
        </Text>

        <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 20 }}>
          {PRIVACY_ITEMS.map(({ key, label, icon, desc }, i) => {
            const isOn = isPro ? !!visibility[key] : true;
            return (
              <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: i < PRIVACY_ITEMS.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                <View style={{ width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: isOn ? colors.accent + '18' : colors.bg }}>
                  <Ionicons name={icon} size={18} color={isOn ? colors.accent : colors.textDim} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: weight.semibold, color: colors.text }}>{label}</Text>
                  <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>{desc}</Text>
                </View>
                <Switch
                  value={isOn}
                  onValueChange={v => isPro && handleToggle(key, v)}
                  trackColor={{ false: colors.border, true: colors.accent + '88' }}
                  thumbColor={isOn ? colors.accent : colors.textDim}
                  ios_backgroundColor={colors.border}
                  disabled={!isPro || !loaded}
                />
              </View>
            );
          })}

          {!isPro && (
            <TouchableOpacity onPress={() => navigation.navigate('Subscription')} activeOpacity={0.8}
              style={{ margin: 14, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.accent + '12', borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.accent + '30' }}>
              <Ionicons name="lock-open-outline" size={15} color={colors.accent} />
              <Text style={{ flex: 1, fontSize: 13, color: colors.textDim, lineHeight: 17 }}>
                <Text style={{ fontWeight: weight.bold, color: colors.text }}>Upgrade to Pro</Text> to control what your coach can see
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.accent} />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Disconnect ───────────────────────────────────────────── */}
        {activeCoach && (
          <TouchableOpacity onPress={handleDisconnect} activeOpacity={0.75} style={{ alignItems: 'center', paddingVertical: 12, marginBottom: 8 }}>
            <Text style={{ fontSize: 13, color: colors.danger, fontWeight: weight.semibold }}>Disconnect from coach</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
