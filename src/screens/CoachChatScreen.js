import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, LayoutAnimation,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import { supabase } from '../lib/supabase';
import { sendChatPushNotification } from '../lib/notifications';
import { typography, weight } from '../theme/typography';

// ─── Data ─────────────────────────────────────────────────────────────────────

async function fetchClientStats(clientId) {
  if (!clientId) return null;
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const [wRes, stRes, slRes, flRes, wkRes] = await Promise.all([
    supabase.from('weight_logs').select('weight, logged_at').eq('user_id', clientId)
      .order('logged_at', { ascending: false }).limit(7),
    supabase.from('step_logs').select('steps, logged_at').eq('user_id', clientId)
      .gte('logged_at', weekAgo + 'T00:00:00').order('logged_at', { ascending: false }).limit(7),
    supabase.from('sleep_logs').select('hours, logged_at').eq('user_id', clientId)
      .gte('logged_at', weekAgo + 'T00:00:00').order('logged_at', { ascending: false }).limit(7),
    supabase.from('food_logs').select('calories, logged_at').eq('user_id', clientId)
      .gte('logged_at', weekAgo + 'T00:00:00').order('logged_at', { ascending: false }).limit(50),
    supabase.from('workout_sessions').select('date').eq('user_id', clientId)
      .gte('date', weekAgo).order('date', { ascending: false }).limit(7),
  ]);
  const avg = (arr, key) => {
    if (!arr?.length) return null;
    return Math.round((arr.reduce((s, x) => s + (x[key] ?? 0), 0) / arr.length) * 10) / 10;
  };
  // calories: group by date then average daily totals
  const calByDay = {};
  for (const r of flRes.data ?? []) {
    const d = r.logged_at.split('T')[0];
    calByDay[d] = (calByDay[d] ?? 0) + (r.calories ?? 0);
  }
  const calVals = Object.values(calByDay);
  const avgCal = calVals.length ? Math.round(calVals.reduce((s, v) => s + v, 0) / calVals.length) : null;

  return {
    latestWeight: wRes.data?.[0]?.weight ?? null,
    avgSteps: avg(stRes.data, 'steps'),
    avgSleep: avg(slRes.data, 'hours'),
    avgCalories: avgCal,
    workouts: wkRes.data?.length ?? 0,
  };
}

async function fetchMessages(coachId, clientId) {
  const { data, error } = await supabase
    .from('coach_messages')
    .select('id, sender_id, message, created_at')
    .eq('coach_id', coachId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ─── Date divider ─────────────────────────────────────────────────────────────

function DateDivider({ date, colors }) {
  const label = (() => {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'TODAY';
    if (d.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
  })();
  return (
    <View style={{ alignItems: 'center', marginVertical: 10 }}>
      <View style={{
        backgroundColor: colors.bgCard, borderRadius: 8,
        paddingHorizontal: 12, paddingVertical: 4,
        borderWidth: 1, borderColor: colors.border,
      }}>
        <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '600', letterSpacing: 0.3 }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

// ─── Bubble ───────────────────────────────────────────────────────────────────

function Bubble({ msg, isMe, prevSame, nextSame, colors }) {
  const time = new Date(msg.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const accent      = colors.accent;
  const sentBg      = accent;
  const sentText    = colors.bg;           // dark bg on light accent
  const receivedBg  = colors.bgCard;
  const receivedTxt = colors.text;
  const timeSent    = colors.bg + 'aa';
  const timeRecv    = colors.textDim;
  return (
    <View style={{
      marginTop: prevSame ? 2 : 8,
      marginBottom: nextSame ? 0 : 2,
      marginHorizontal: 10,
      alignItems: isMe ? 'flex-end' : 'flex-start',
    }}>
      <View style={{
        maxWidth: '80%',
        backgroundColor: isMe ? sentBg : receivedBg,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingTop: 7,
        paddingBottom: 6,
        elevation: 1,
      }}>
        <Text style={{ fontSize: 14.5, color: isMe ? sentText : receivedTxt, lineHeight: 20 }}>
          {msg.message}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2 }}>
          <Text style={{ fontSize: 10.5, color: isMe ? timeSent : timeRecv }}>{time}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyChat({ otherName, colors }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 }}>
      <View style={{
        backgroundColor: colors.bgCard, borderRadius: 10,
        paddingHorizontal: 18, paddingVertical: 12,
        borderWidth: 1, borderColor: colors.border,
      }}>
        <Text style={{ fontSize: 12.5, color: colors.textDim, textAlign: 'center', lineHeight: 19 }}>
          🔒 Messages are end-to-end encrypted.{'\n'}Start the conversation with {otherName}.
        </Text>
      </View>
    </View>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ clientId, colors }) {
  const [expanded, setExpanded] = useState(false);
  const { data: stats, isLoading } = useQuery({
    queryKey: ['chatClientStats', clientId],
    queryFn: () => fetchClientStats(clientId),
    enabled: !!clientId,
    staleTime: 60000,
  });

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(e => !e);
  };

  const ITEMS = [
    { icon: 'scale-outline',     color: '#f97316', label: 'Weight',   sublabel: 'Latest',      value: stats?.latestWeight  != null ? `${stats.latestWeight}kg` : '—' },
    { icon: 'footsteps-outline', color: '#22c55e', label: 'Avg Steps',sublabel: '7-day avg',   value: stats?.avgSteps      != null ? (stats.avgSteps >= 1000 ? `${(stats.avgSteps/1000).toFixed(1)}k` : String(stats.avgSteps)) : '—' },
    { icon: 'moon-outline',      color: '#6366f1', label: 'Avg Sleep', sublabel: '7-day avg',  value: stats?.avgSleep      != null ? `${stats.avgSleep}h` : '—' },
    { icon: 'flame-outline',     color: '#ef4444', label: 'Avg Kcal', sublabel: '7-day avg',   value: stats?.avgCalories   != null ? `${stats.avgCalories}` : '—' },
    { icon: 'barbell-outline',   color: colors.accent, label: 'Workouts', sublabel: 'This week', value: String(stats?.workouts ?? 0) },
  ];

  return (
    <View style={{ backgroundColor: colors.bgCard, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      {/* Toggle row */}
      <TouchableOpacity onPress={toggle} activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 8 }}>
        <Ionicons name="stats-chart-outline" size={14} color={colors.accent} />
        <Text style={{ flex: 1, fontSize: 11, fontWeight: '700', color: colors.accent, letterSpacing: 0.5 }}>
          CLIENT STATS · 7 DAYS
        </Text>
        {isLoading && <ActivityIndicator size="small" color={colors.accent} />}
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textDim} />
      </TouchableOpacity>

      {/* Expanded rows */}
      {expanded && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 10, gap: 0 }}>
          {ITEMS.map(({ icon, color, label, sublabel, value }, idx) => (
            <View key={label} style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              paddingVertical: 8,
              borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: colors.border,
            }}>
              <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: color + '18', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={icon} size={15} color={color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{label}</Text>
                <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>{sublabel}</Text>
              </View>
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>{value}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CoachChatScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { isPro } = useSubscription();
  const navigation = useNavigation();
  const { coachId, clientId, clientName, coachName } = useRoute().params ?? {};
  const qc = useQueryClient();
  const flatRef = useRef(null);
  const [text, setText] = useState('');

  const isCoach = user?.id === coachId;
  const otherName = isCoach ? (clientName ?? 'Client') : (coachName ?? 'Coach');
  const accent = colors.accent;

  // Mark messages as read when this chat is opened
  useEffect(() => {
    if (!coachId || !clientId) return;
    const field = isCoach ? 'coach_last_read' : 'client_last_read';
    supabase
      .from('coach_clients')
      .update({ [field]: new Date().toISOString() })
      .eq('coach_id', coachId)
      .eq('client_id', clientId)
      .eq('status', 'active')
      .then(() => {});
  }, [coachId, clientId, isCoach]);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['coachMessages', coachId, clientId],
    queryFn: () => fetchMessages(coachId, clientId),
    enabled: !!(coachId && clientId),
    staleTime: 0, gcTime: 0,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  const { mutate: send, isPending: sending } = useMutation({
    mutationFn: async (msg) => {
      const { error } = await supabase.from('coach_messages').insert({
        coach_id: coachId, client_id: clientId, sender_id: user.id, message: msg,
      });
      if (error) throw error;
      const recipientId = isCoach ? clientId : coachId;
      const senderName = isCoach ? 'Your Coach' : otherName;
      await sendChatPushNotification({ recipientId, senderName, message: msg });
    },
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['coachMessages', coachId, clientId] });
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    },
  });

  // Build items list with date dividers
  const items = [];
  let lastDate = null;
  for (const msg of messages) {
    const d = new Date(msg.created_at).toDateString();
    if (d !== lastDate) {
      items.push({ type: 'date', date: msg.created_at, key: `date-${msg.created_at}` });
      lastDate = d;
    }
    items.push({ type: 'msg', ...msg, key: msg.id });
}

  const canSend = text.trim().length > 0 && !sending;
  const initials = otherName.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: 'transparent' }}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          paddingHorizontal: 10, paddingVertical: 10,
          backgroundColor: colors.bgCard,
          borderBottomWidth: 1, borderBottomColor: colors.border,
        }}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </TouchableOpacity>

          {/* Avatar */}
          <View style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: accent + '33',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: accent }}>{initials}</Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{otherName}</Text>
            <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 0 }}>
              {isCoach ? 'Client' : 'Your Coach'}
            </Text>
          </View>

        </View>

        {/* ── Stats bar (coach only) ──────────────────────────────────── */}
        {isCoach && <StatsBar clientId={clientId} colors={colors} />}

        {/* ── Messages ────────────────────────────────────────────────── */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior="padding"
        >
          {isLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={accent} />
            </View>
          ) : messages.length === 0 ? (
            <EmptyChat otherName={otherName} colors={colors} />
          ) : (
            <FlatList
              ref={flatRef}
              data={items}
              keyExtractor={item => item.key}
              contentContainerStyle={{ paddingVertical: 6, paddingBottom: 6 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item, index }) => {
                if (item.type === 'date') return <DateDivider date={item.date} colors={colors} />;
                const msgItems = items.filter(i => i.type === 'msg');
                const idx = msgItems.findIndex(m => m.key === item.key);
                const prev = msgItems[idx - 1];
                const next = msgItems[idx + 1];
                const prevSame = prev && prev.sender_id === item.sender_id;
                const nextSame = next && next.sender_id === item.sender_id;
                return (
                  <Bubble
                    msg={item}
                    isMe={item.sender_id === user?.id}
                    prevSame={prevSame}
                    nextSame={nextSame}
                    colors={colors}
                  />
                );
              }}
            />
          )}

          {/* ── Input bar ─────────────────────────────────────────────── */}
          <View style={{
            flexDirection: 'row', alignItems: 'flex-end',
            paddingHorizontal: 8, paddingVertical: 6, gap: 8,
            backgroundColor: colors.bgCard,
            borderTopWidth: 1, borderTopColor: colors.border,
          }}>
            {isPro ? (
              <>
                {/* Text input pill */}
                <View style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center',
                  backgroundColor: 'transparent',
                  paddingHorizontal: 4,
                  minHeight: 44,
                }}>
                  <TextInput
                    value={text}
                    onChangeText={setText}
                    placeholder="Message"
                    placeholderTextColor={colors.textDim}
                    multiline
                    style={{
                      flex: 1,
                      fontSize: 15,
                      color: colors.text,
                      maxHeight: 120,
                      paddingVertical: Platform.OS === 'ios' ? 10 : 8,
                      lineHeight: 20,
                    }}
                  />
                </View>

                {/* Send button — only shown when there is text */}
                {canSend && (
                  <TouchableOpacity
                    onPress={() => send(text.trim())}
                    activeOpacity={0.8}
                    style={{
                      width: 46, height: 46, borderRadius: 23,
                      backgroundColor: accent,
                      alignItems: 'center', justifyContent: 'center',
                      shadowColor: accent,
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.4, shadowRadius: 6, elevation: 4,
                    }}
                  >
                    {sending
                      ? <ActivityIndicator size="small" color={colors.bg} />
                      : <Ionicons name="send" size={18} color={colors.bg} style={{ marginLeft: 2 }} />
                    }
                  </TouchableOpacity>
                )}
              </>
            ) : (
              /* Locked for free users */
              <View style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
                backgroundColor: colors.bg, borderRadius: 24,
                borderWidth: 1, borderColor: colors.border,
                paddingHorizontal: 14, paddingVertical: 11,
              }}>
                <Ionicons name="lock-closed" size={16} color={accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>Pro feature</Text>
                  <Text style={{ fontSize: 11, color: colors.textDim }}>Upgrade to send messages</Text>
                </View>
                <TouchableOpacity
                  onPress={() => navigation.navigate('Home', { screen: 'Subscription' })}
                  style={{ backgroundColor: accent, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.bg }}>Upgrade</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
