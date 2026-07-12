import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import { supabase } from '../lib/supabase';
import { sendChatPushNotification } from '../lib/notifications';
import { typography, weight } from '../theme/typography';

// ─── Data ─────────────────────────────────────────────────────────────────────

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

// ─── Wallpaper background ─────────────────────────────────────────────────────

function WallpaperBg({ dark }) {
  const bg = dark ? '#0B141A' : '#E8E4DC';
  return (
    <View style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: bg,
    }} />
  );
}

// ─── Date divider ─────────────────────────────────────────────────────────────

function DateDivider({ date, dark }) {
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
        backgroundColor: dark ? '#182229' : '#D1F4CC',
        borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4,
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08, shadowRadius: 2, elevation: 1,
      }}>
        <Text style={{ fontSize: 11, color: dark ? '#8696A0' : '#54656F', fontWeight: '600', letterSpacing: 0.3 }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

// ─── Bubble ───────────────────────────────────────────────────────────────────

function Bubble({ msg, isMe, prevSame, nextSame, accent, dark }) {
  const time = new Date(msg.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const receivedBg  = dark ? '#202C33' : '#FFFFFF';
  const receivedText = dark ? '#E9EDEF' : '#111B21';
  const sentText    = '#FFFFFF';
  const timeColor   = dark ? (isMe ? '#9BB0B8' : '#8696A0') : (isMe ? 'rgba(255,255,255,0.72)' : '#667781');

  // tail: only on the first bubble of a group
  const showTail = !prevSame;

  const tailSent = (
    <View style={{ position: 'absolute', bottom: 0, right: -7 }}>
      <View style={{
        width: 0, height: 0,
        borderLeftWidth: 8, borderLeftColor: 'transparent',
        borderBottomWidth: 10, borderBottomColor: isMe ? accent : receivedBg,
      }} />
    </View>
  );

  const tailReceived = (
    <View style={{ position: 'absolute', bottom: 0, left: -7 }}>
      <View style={{
        width: 0, height: 0,
        borderRightWidth: 8, borderRightColor: 'transparent',
        borderBottomWidth: 10, borderBottomColor: receivedBg,
      }} />
    </View>
  );

  return (
    <View style={{
      marginTop: prevSame ? 2 : 8,
      marginBottom: nextSame ? 0 : 2,
      marginHorizontal: 10,
      alignItems: isMe ? 'flex-end' : 'flex-start',
    }}>
      <View style={{
        maxWidth: '80%',
        backgroundColor: isMe ? accent : receivedBg,
        borderRadius: 8,
        borderBottomRightRadius: isMe && showTail ? 2 : 8,
        borderBottomLeftRadius: !isMe && showTail ? 2 : 8,
        paddingTop: 6,
        paddingLeft: 9,
        paddingRight: 9,
        paddingBottom: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: dark ? 0.25 : 0.08,
        shadowRadius: 1,
        elevation: 1,
        position: 'relative',
      }}>
        {/* Message text + inline time spacer */}
        <Text style={{
          fontSize: 14.5,
          color: isMe ? sentText : receivedText,
          lineHeight: 20,
          flexShrink: 1,
        }}>
          {msg.message}
          {/* invisible spacer so text doesn't overlap the time */}
          <Text style={{ fontSize: 14.5, color: 'transparent' }}>{'  ' + time + '  '}</Text>
        </Text>

        {/* Time + tick — absolute bottom-right */}
        <View style={{
          position: 'absolute', bottom: 4, right: 8,
          flexDirection: 'row', alignItems: 'center', gap: 2,
        }}>
          <Text style={{ fontSize: 10.5, color: timeColor }}>{time}</Text>
          {isMe && (
            <Ionicons name="checkmark-done" size={14} color={dark ? '#53BDEB' : 'rgba(255,255,255,0.85)'} />
          )}
        </View>

        {/* Bubble tail */}
        {showTail && (isMe ? tailSent : tailReceived)}
      </View>
    </View>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyChat({ otherName, dark }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 }}>
      <View style={{
        backgroundColor: dark ? '#182229' : '#D1F4CC',
        borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10,
      }}>
        <Text style={{ fontSize: 12.5, color: dark ? '#8696A0' : '#54656F', textAlign: 'center' }}>
          🔒 Messages are end-to-end encrypted.{'\n'}Start the conversation with {otherName}.
        </Text>
      </View>
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
  // detect dark mode from bg color
  const dark = colors.bg === '#080810' || colors.bg?.startsWith('#0');

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

  const headerBg  = dark ? '#202C33' : '#008069';
  const headerText = '#FFFFFF';
  const inputBarBg = dark ? '#1F2C34' : '#F0F2F5';
  const inputBg    = dark ? '#2A3942' : '#FFFFFF';
  const inputText  = dark ? '#E9EDEF' : '#111B21';
  const inputPlaceholder = dark ? '#8696A0' : '#667781';

  return (
    <View style={{ flex: 1 }}>
      <WallpaperBg dark={dark} />

      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          paddingHorizontal: 10, paddingVertical: 10,
          backgroundColor: headerBg,
        }}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={22} color={headerText} />
          </TouchableOpacity>

          {/* Avatar */}
          <View style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: accent + '44',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>{initials}</Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: headerText }}>{otherName}</Text>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', marginTop: 0 }}>
              {isCoach ? 'Client' : 'Your Coach'}
            </Text>
          </View>

          {/* Right icons — video/call removed per request */}
          <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="ellipsis-vertical" size={20} color={headerText} />
          </TouchableOpacity>
        </View>

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
            <EmptyChat otherName={otherName} dark={dark} />
          ) : (
            <FlatList
              ref={flatRef}
              data={items}
              keyExtractor={item => item.key}
              contentContainerStyle={{ paddingVertical: 6, paddingBottom: 6 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item, index }) => {
                if (item.type === 'date') return <DateDivider date={item.date} dark={dark} />;
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
                    accent={accent}
                    dark={dark}
                  />
                );
              }}
            />
          )}

          {/* ── Input bar ─────────────────────────────────────────────── */}
          <View style={{
            flexDirection: 'row', alignItems: 'flex-end',
            paddingHorizontal: 8, paddingVertical: 6, gap: 8,
            backgroundColor: inputBarBg,
          }}>
            {isPro ? (
              <>
                {/* Text input pill */}
                <View style={{
                  flex: 1, flexDirection: 'row', alignItems: 'flex-end',
                  backgroundColor: inputBg, borderRadius: 24,
                  paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 10 : 4,
                  minHeight: 44,
                }}>
                  <TouchableOpacity style={{ paddingBottom: Platform.OS === 'ios' ? 0 : 4, marginRight: 8 }}>
                    <Ionicons name="happy-outline" size={22} color={inputPlaceholder} />
                  </TouchableOpacity>
                  <TextInput
                    value={text}
                    onChangeText={setText}
                    placeholder="Message"
                    placeholderTextColor={inputPlaceholder}
                    multiline
                    style={{
                      flex: 1,
                      fontSize: 15,
                      color: inputText,
                      maxHeight: 120,
                      paddingTop: 0,
                      paddingBottom: 0,
                      lineHeight: 20,
                    }}
                  />
                </View>

                {/* Send / Mic button */}
                <TouchableOpacity
                  onPress={() => canSend && send(text.trim())}
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
                    ? <ActivityIndicator size="small" color={dark ? colors.bg : '#fff'} />
                    : canSend
                      ? <Ionicons name="send" size={18} color={dark ? colors.bg : '#fff'} style={{ marginLeft: 2 }} />
                      : <Ionicons name="mic" size={20} color={dark ? colors.bg : '#fff'} />
                  }
                </TouchableOpacity>
              </>
            ) : (
              /* Locked for free users */
              <View style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
                backgroundColor: inputBg, borderRadius: 24,
                paddingHorizontal: 14, paddingVertical: 11,
              }}>
                <Ionicons name="lock-closed" size={16} color={accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: inputText }}>Pro feature</Text>
                  <Text style={{ fontSize: 11, color: inputPlaceholder }}>Upgrade to send messages</Text>
                </View>
                <TouchableOpacity
                  onPress={() => navigation.navigate('Home', { screen: 'Subscription' })}
                  style={{ backgroundColor: accent, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: dark ? colors.bg : '#fff' }}>Upgrade</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
