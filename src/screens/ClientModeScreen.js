import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Switch,
  Alert, ActivityIndicator, TextInput,
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
    } else {
      setActiveCoach(null);
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

  const enabledCount = Object.values(visibility).filter(Boolean).length;
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
        {/* Avatar icon */}
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#22c55e18', borderWidth: 1, borderColor: '#22c55e35', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="person-outline" size={18} color="#22c55e" />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
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
          <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, overflow: 'hidden', marginBottom: 20, borderWidth: 1, borderColor: colors.border }}>
            <View style={{ height: 5, backgroundColor: '#22c55e' }} />
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
              <View style={{ flexDirection: 'row', gap: 0 }}>
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
        ) : (
          /* ── No Coach — Join form ─────────────────────────────────── */
          <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 24, marginBottom: 20, alignItems: 'center', gap: 16 }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accent + '15', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="people-circle-outline" size={40} color={colors.accent} />
            </View>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: weight.black, color: colors.text }}>No Coach Yet</Text>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ flex: 1, fontSize: 11, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Shared with Coach
          </Text>
          <Text style={{ fontSize: 13, fontWeight: weight.bold, color: colors.textDim }}>
            {enabledCount}/{PRIVACY_ITEMS.length}
          </Text>
        </View>

        <View style={{ backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 20 }}>
          {PRIVACY_ITEMS.map(({ key, label, icon, desc }, i) => (
            <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: i < PRIVACY_ITEMS.length - 1 ? 1 : 0, borderBottomColor: colors.border, opacity: isPro ? 1 : 0.45 }}>
              <View style={{ width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: (isPro && visibility[key]) ? colors.accent + '18' : colors.bg }}>
                <Ionicons name={isPro ? icon : 'lock-closed-outline'} size={18} color={(isPro && visibility[key]) ? colors.accent : colors.textDim} />
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
            <TouchableOpacity onPress={() => navigation.navigate('Subscription')} activeOpacity={0.8}
              style={{ margin: 14, backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Ionicons name="rocket" size={16} color={colors.bg} />
              <Text style={{ fontSize: 14, fontWeight: weight.bold, color: colors.bg }}>Upgrade to Pro to unlock</Text>
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
