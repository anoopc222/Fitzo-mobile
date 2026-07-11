import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
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

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, size = 36, accent }) {
  const initials = (name ?? '?').split(/[\s_]+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: accent + '28',
      borderWidth: 1.5, borderColor: accent + '50',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ fontSize: size * 0.38, fontWeight: '800', color: accent }}>{initials}</Text>
    </View>
  );
}

// ─── Bubble ───────────────────────────────────────────────────────────────────

function Bubble({ msg, isMe, prevMsg, colors, accent, otherName }) {
  const time = new Date(msg.created_at).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });

  const prevIsMe = prevMsg ? prevMsg.sender_id === msg.sender_id : false;
  const showAvatar = !isMe && !prevIsMe;

  return (
    <View style={{
      marginTop: prevIsMe ? 2 : 10,
      marginHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: isMe ? 'flex-end' : 'flex-start',
      gap: 8,
    }}>
      {/* Other person's avatar */}
      {!isMe && (
        <View style={{ width: 28 }}>
          {showAvatar
            ? <Avatar name={otherName} size={28} accent={accent} />
            : null}
        </View>
      )}

      <View style={{ maxWidth: '72%' }}>
        {/* Sender label on first bubble */}
        {!isMe && showAvatar && (
          <Text style={{ fontSize: 10, color: colors.textDim, marginBottom: 3, marginLeft: 2, fontWeight: '600' }}>
            {otherName}
          </Text>
        )}

        {isMe ? (
          <LinearGradient
            colors={[accent, accent + 'cc']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{
              borderRadius: 20,
              borderBottomRightRadius: 5,
              paddingHorizontal: 14,
              paddingVertical: 10,
              shadowColor: accent,
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.25,
              shadowRadius: 6,
              elevation: 3,
            }}
          >
            <Text style={{ fontSize: typography.sm, lineHeight: 21, color: colors.bg, fontWeight: '500' }}>
              {msg.message}
            </Text>
          </LinearGradient>
        ) : (
          <View style={{
            backgroundColor: colors.bgCard,
            borderRadius: 20,
            borderBottomLeftRadius: 5,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderWidth: 1,
            borderColor: colors.border,
          }}>
            <Text style={{ fontSize: typography.sm, lineHeight: 21, color: colors.text, fontWeight: '400' }}>
              {msg.message}
            </Text>
          </View>
        )}

        <Text style={{
          fontSize: 10,
          color: colors.textDim,
          marginTop: 3,
          marginHorizontal: 4,
          alignSelf: isMe ? 'flex-end' : 'flex-start',
        }}>
          {time}
        </Text>
      </View>
    </View>
  );
}

// ─── Date Divider ─────────────────────────────────────────────────────────────

function DateDivider({ date, colors }) {
  const label = (() => {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  })();
  return (
    <View style={{ alignItems: 'center', marginVertical: 14 }}>
      <View style={{
        backgroundColor: colors.bgCard, borderRadius: 20,
        paddingHorizontal: 14, paddingVertical: 5,
        borderWidth: 1, borderColor: colors.border,
      }}>
        <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '600', letterSpacing: 0.3 }}>{label}</Text>
      </View>
    </View>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyChat({ otherName, colors, accent }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 }}>
      <View style={{
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: accent + '15',
        borderWidth: 1.5, borderColor: accent + '30',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name="chatbubbles-outline" size={34} color={accent} />
      </View>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text }}>Start the conversation</Text>
        <Text style={{ fontSize: typography.sm, color: colors.textDim, textAlign: 'center', lineHeight: 20 }}>
          Send a message to {otherName} — they'll get a notification instantly.
        </Text>
      </View>
    </View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CoachChatScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation();
  const { coachId, clientId, clientName, coachName } = useRoute().params ?? {};
  const qc = useQueryClient();
  const flatRef = useRef(null);
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(40);

  const isCoach = user?.id === coachId;
  const otherName = isCoach ? (clientName ?? 'Client') : (coachName ?? 'Coach');
  const accent = colors.accent;

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
      setInputHeight(40);
      qc.invalidateQueries({ queryKey: ['coachMessages', coachId, clientId] });
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    },
  });

  // Build items with date dividers
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 14, paddingVertical: 10,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.bg,
      }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: colors.bgCard,
            borderWidth: 1, borderColor: colors.border,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text, letterSpacing: 0.2 }}>
            {otherName}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
            <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#22c55e' }} />
            <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '500' }}>
              {isCoach ? 'Client' : 'Your Coach'}
            </Text>
          </View>
        </View>
      </View>

      {/* ── Messages ───────────────────────────────────────────────────── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={accent} />
          </View>
        ) : messages.length === 0 ? (
          <EmptyChat otherName={otherName} colors={colors} accent={accent} />
        ) : (
          <FlatList
            ref={flatRef}
            data={items}
            keyExtractor={item => item.key}
            contentContainerStyle={{ paddingVertical: 8, paddingBottom: 12 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => {
              if (item.type === 'date') return <DateDivider date={item.date} colors={colors} />;
              const msgItems = items.filter(i => i.type === 'msg');
              const msgIdx = msgItems.findIndex(m => m.key === item.key);
              const prevMsg = msgIdx > 0 ? msgItems[msgIdx - 1] : null;
              return (
                <Bubble
                  msg={item}
                  isMe={item.sender_id === user?.id}
                  prevMsg={prevMsg}
                  colors={colors}
                  accent={accent}
                  otherName={otherName}
                />
              );
            }}
          />
        )}

        {/* ── Input bar ───────────────────────────────────────────────── */}
        <View style={{
          flexDirection: 'row', alignItems: 'flex-end', gap: 10,
          paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12,
          borderTopWidth: 1, borderTopColor: colors.border,
          backgroundColor: colors.bg,
        }}>
          <View style={{
            flex: 1,
            backgroundColor: colors.bgCard,
            borderRadius: 24,
            borderWidth: 1.5,
            borderColor: text.trim() ? accent + '60' : colors.border,
            paddingHorizontal: 16,
            paddingVertical: 8,
            minHeight: 44,
            justifyContent: 'center',
          }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type a message..."
              placeholderTextColor={colors.textDim}
              multiline
              onContentSizeChange={e => setInputHeight(Math.min(e.nativeEvent.contentSize.height, 110))}
              style={{
                height: Math.max(inputHeight, 28),
                fontSize: typography.sm,
                color: colors.text,
                lineHeight: 21,
                padding: 0,
              }}
            />
          </View>

          <TouchableOpacity
            onPress={() => canSend && send(text.trim())}
            disabled={!canSend}
            activeOpacity={0.8}
          >
            {canSend ? (
              <LinearGradient
                colors={[accent, accent + 'bb']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{
                  width: 44, height: 44, borderRadius: 22,
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: accent, shadowOffset: { width: 0, height: 3 },
                  shadowOpacity: 0.4, shadowRadius: 8, elevation: 4,
                }}
              >
                {sending
                  ? <ActivityIndicator size="small" color={colors.bg} />
                  : <Ionicons name="send" size={18} color={colors.bg} />
                }
              </LinearGradient>
            ) : (
              <View style={{
                width: 44, height: 44, borderRadius: 22,
                backgroundColor: colors.bgCard,
                borderWidth: 1, borderColor: colors.border,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name="send" size={18} color={colors.textDim} />
              </View>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
