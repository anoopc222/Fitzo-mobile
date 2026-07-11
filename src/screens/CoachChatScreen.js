import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
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

// ─── Bubble ───────────────────────────────────────────────────────────────────

function Bubble({ msg, isMe, colors }) {
  const time = new Date(msg.created_at).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });
  return (
    <View style={{
      alignSelf: isMe ? 'flex-end' : 'flex-start',
      maxWidth: '78%',
      marginVertical: 3,
      marginHorizontal: 12,
    }}>
      <View style={{
        backgroundColor: isMe ? colors.accent : colors.bgCard,
        borderRadius: 18,
        borderBottomRightRadius: isMe ? 4 : 18,
        borderBottomLeftRadius: isMe ? 18 : 4,
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderWidth: isMe ? 0 : 1,
        borderColor: colors.border,
      }}>
        <Text style={{
          fontSize: typography.sm, lineHeight: 20,
          color: isMe ? colors.bg : colors.text,
        }}>
          {msg.message}
        </Text>
      </View>
      <Text style={{
        fontSize: 10, color: colors.textDim, marginTop: 3,
        alignSelf: isMe ? 'flex-end' : 'flex-start',
        marginHorizontal: 4,
      }}>
        {time}
      </Text>
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
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  })();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 10, paddingHorizontal: 16 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      <Text style={{ fontSize: 11, color: colors.textDim, marginHorizontal: 10 }}>{label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
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

  const isCoach = user?.id === coachId;
  const otherName = isCoach ? (clientName ?? 'Client') : (coachName ?? 'Coach');

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['coachMessages', coachId, clientId],
    queryFn: () => fetchMessages(coachId, clientId),
    enabled: !!(coachId && clientId),
    staleTime: 0, gcTime: 0,
    refetchInterval: 5000, // poll every 5s for new messages
  });

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  const { mutate: send, isPending: sending } = useMutation({
    mutationFn: async (msg) => {
      const { error } = await supabase.from('coach_messages').insert({
        coach_id: coachId,
        client_id: clientId,
        sender_id: user.id,
        message: msg,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['coachMessages', coachId, clientId] });
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    },
  });

  // Group messages with date dividers
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: colors.border,
      }}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={{
          width: 36, height: 36, borderRadius: 18,
          backgroundColor: colors.accent + '22', alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="person" size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: typography.base, fontWeight: weight.bold, color: colors.text }}>
            {otherName}
          </Text>
          <Text style={{ fontSize: 11, color: colors.textDim }}>
            {isCoach ? 'Client' : 'Your Coach'}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Messages */}
        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : messages.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <View style={{
              width: 64, height: 64, borderRadius: 32,
              backgroundColor: colors.accent + '18', alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons name="chatbubbles-outline" size={28} color={colors.accent} />
            </View>
            <Text style={{ fontSize: typography.sm, color: colors.textDim }}>No messages yet</Text>
            <Text style={{ fontSize: 12, color: colors.textDim }}>Start the conversation!</Text>
          </View>
        ) : (
          <FlatList
            ref={flatRef}
            data={items}
            keyExtractor={item => item.key}
            contentContainerStyle={{ paddingVertical: 12 }}
            renderItem={({ item }) =>
              item.type === 'date'
                ? <DateDivider date={item.date} colors={colors} />
                : <Bubble msg={item} isMe={item.sender_id === user?.id} colors={colors} />
            }
          />
        )}

        {/* Input bar */}
        <View style={{
          flexDirection: 'row', alignItems: 'flex-end', gap: 10,
          paddingHorizontal: 12, paddingVertical: 10,
          borderTopWidth: 1, borderTopColor: colors.border,
          backgroundColor: colors.bg,
        }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message..."
            placeholderTextColor={colors.textDim}
            multiline
            style={{
              flex: 1,
              backgroundColor: colors.bgCard,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 16,
              paddingVertical: 10,
              fontSize: typography.sm,
              color: colors.text,
              maxHeight: 120,
              lineHeight: 20,
            }}
          />
          <TouchableOpacity
            onPress={() => text.trim() && send(text.trim())}
            disabled={!text.trim() || sending}
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: text.trim() ? colors.accent : colors.border,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            {sending
              ? <ActivityIndicator size="small" color={colors.bg} />
              : <Ionicons name="send" size={18} color={text.trim() ? colors.bg : colors.textDim} />
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
