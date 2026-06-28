import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
import ScreenHeader from '../components/ScreenHeader';

export async function fetchFriendsData(userId) {
  const [acceptedRes, incomingRes, outgoingRes] = await Promise.all([
    supabase
      .from('friendships')
      .select('id, requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id,full_name), addressee:profiles!friendships_addressee_id_fkey(id,full_name)')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
    supabase
      .from('friendships')
      .select('id, requester:profiles!friendships_requester_id_fkey(id,full_name)')
      .eq('status', 'pending')
      .eq('addressee_id', userId),
    supabase
      .from('friendships')
      .select('id, addressee:profiles!friendships_addressee_id_fkey(id,full_name)')
      .eq('status', 'pending')
      .eq('requester_id', userId),
  ]);
  if (acceptedRes.error) throw acceptedRes.error;
  if (incomingRes.error) throw incomingRes.error;
  if (outgoingRes.error) throw outgoingRes.error;

  const friends = (acceptedRes.data ?? []).map(row => {
    const other = row.requester_id === userId ? row.addressee : row.requester;
    return { friendshipId: row.id, id: other?.id, full_name: other?.full_name };
  });

  return {
    friends,
    incoming: (incomingRes.data ?? []).map(row => ({ friendshipId: row.id, id: row.requester?.id, full_name: row.requester?.full_name })),
    outgoing: (outgoingRes.data ?? []).map(row => ({ friendshipId: row.id, id: row.addressee?.id, full_name: row.addressee?.full_name })),
  };
}

async function searchProfiles(term) {
  const { data, error } = await supabase.rpc('search_profiles', { search_term: term });
  if (error) throw error;
  return data ?? [];
}

async function sendRequest(requesterId, addresseeId) {
  const { error } = await supabase.from('friendships').insert({ requester_id: requesterId, addressee_id: addresseeId });
  if (error) throw error;
}

async function respondToRequest(friendshipId, status) {
  const { error } = await supabase.from('friendships').update({ status, responded_at: new Date().toISOString() }).eq('id', friendshipId);
  if (error) throw error;
}

async function removeFriendship(friendshipId) {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  if (error) throw error;
}

export default function FriendsScreen({ navigation }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: () => fetchFriendsData(user.id),
    enabled: !!user?.id,
  });

  const { data: results, isFetching: searching } = useQuery({
    queryKey: ['friendSearch', search],
    queryFn: () => searchProfiles(search),
    enabled: search.trim().length >= 2,
  });

  const invalidate = () => qc.invalidateQueries(['friends', user.id]);

  const sendMut = useMutation({
    mutationFn: (addresseeId) => sendRequest(user.id, addresseeId),
    onSuccess: invalidate,
  });
  const respondMut = useMutation({
    mutationFn: ({ id, status }) => respondToRequest(id, status),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id) => removeFriendship(id),
    onSuccess: invalidate,
  });

  const existingIds = useMemo(() => {
    const ids = new Set();
    (data?.friends ?? []).forEach(f => ids.add(f.id));
    (data?.incoming ?? []).forEach(f => ids.add(f.id));
    (data?.outgoing ?? []).forEach(f => ids.add(f.id));
    return ids;
  }, [data]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title={t('friends.title')} colors={colors} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={colors.textDim} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('friends.searchPlaceholder')}
            placeholderTextColor={colors.textDim}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
          {searching && <ActivityIndicator size="small" color={colors.accent} />}
        </View>

        {search.trim().length >= 2 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('friends.results')}</Text>
            {(results ?? []).length === 0 && !searching ? (
              <Text style={styles.emptyText}>{t('friends.noResults')}</Text>
            ) : (
              (results ?? []).map(p => (
                <View key={p.id} style={styles.row}>
                  <Avatar name={p.full_name} colors={colors} />
                  <Text style={styles.rowName}>{p.full_name || t('friends.unnamed')}</Text>
                  {existingIds.has(p.id) ? (
                    <Text style={styles.pendingLabel}>{t('friends.pending')}</Text>
                  ) : (
                    <TouchableOpacity style={styles.actionBtn} onPress={() => sendMut.mutate(p.id)} disabled={sendMut.isPending}>
                      <Text style={styles.actionBtnText}>{t('friends.add')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )}
          </View>
        )}

        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
        ) : (
          <>
            {(data?.incoming ?? []).length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('friends.requests')}</Text>
                {data.incoming.map(req => (
                  <View key={req.friendshipId} style={styles.row}>
                    <Avatar name={req.full_name} colors={colors} />
                    <Text style={styles.rowName}>{req.full_name || t('friends.unnamed')}</Text>
                    <TouchableOpacity style={styles.iconBtnGood} onPress={() => respondMut.mutate({ id: req.friendshipId, status: 'accepted' })}>
                      <Ionicons name="checkmark" size={16} color={colors.good} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.iconBtnBad} onPress={() => respondMut.mutate({ id: req.friendshipId, status: 'declined' })}>
                      <Ionicons name="close" size={16} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('friends.yourFriends', { count: data?.friends?.length ?? 0 })}</Text>
              {(data?.friends ?? []).length === 0 ? (
                <Text style={styles.emptyText}>{t('friends.noFriendsYet')}</Text>
              ) : (
                data.friends.map(f => (
                  <TouchableOpacity
                    key={f.friendshipId}
                    style={styles.row}
                    onPress={() => navigation.navigate('PublicProfile', { userId: f.id, name: f.full_name })}
                  >
                    <Avatar name={f.full_name} colors={colors} />
                    <Text style={styles.rowName}>{f.full_name || t('friends.unnamed')}</Text>
                    <TouchableOpacity style={styles.iconBtnBad} onPress={() => removeMut.mutate(f.friendshipId)}>
                      <Ionicons name="person-remove-outline" size={16} color={colors.danger} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))
              )}
            </View>

            {(data?.outgoing ?? []).length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('friends.sentRequests')}</Text>
                {data.outgoing.map(req => (
                  <View key={req.friendshipId} style={styles.row}>
                    <Avatar name={req.full_name} colors={colors} />
                    <Text style={styles.rowName}>{req.full_name || t('friends.unnamed')}</Text>
                    <Text style={styles.pendingLabel}>{t('friends.pending')}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Avatar({ name, colors }) {
  const initial = (name?.[0] ?? '?').toUpperCase();
  return (
    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.bg, fontWeight: weight.bold, fontSize: typography.sm }}>{initial}</Text>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bgCard,
    borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, marginVertical: 12,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: typography.sm },

  section: { marginBottom: 18 },
  sectionTitle: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 0.8, marginBottom: 10, textTransform: 'uppercase' },
  emptyText: { fontSize: typography.sm, color: colors.textDim, paddingVertical: 8 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bgCard,
    borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: 8,
  },
  rowName: { flex: 1, fontSize: typography.base, color: colors.text, fontWeight: weight.medium },

  actionBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  actionBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.xs },
  pendingLabel: { color: colors.textDim, fontSize: typography.xs, fontWeight: weight.semibold },

  iconBtnGood: { backgroundColor: colors.good + '18', borderRadius: 10, padding: 7 },
  iconBtnBad: { backgroundColor: colors.danger + '18', borderRadius: 10, padding: 7 },
});
