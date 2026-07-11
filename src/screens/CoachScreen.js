import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Clipboard,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
import ScreenHeader from '../components/ScreenHeader';

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

async function fetchCoachClients(userId) {
  const { data, error } = await supabase
    .from('coach_clients')
    .select('*, client:profiles!coach_clients_client_id_fkey(id, full_name, goal)')
    .eq('coach_id', userId)
    .neq('status', 'removed')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function generateInvite(coachId) {
  const { data, error } = await supabase.rpc('generate_coach_invite', { p_coach_id: coachId });
  if (error) throw error;
  return data; // TEXT invite code
}

async function removeLink(linkId) {
  const { error } = await supabase
    .from('coach_clients')
    .update({ status: 'removed' })
    .eq('id', linkId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ title, colors }) {
  return (
    <Text
      style={{
        fontSize: typography.xs,
        fontWeight: weight.bold,
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginTop: 20,
        marginBottom: 8,
      }}
    >
      {title}
    </Text>
  );
}

function InviteCodeBox({ code, colors }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    Clipboard.setString(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View
      style={{
        backgroundColor: colors.bgElevated,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 16,
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Text
        style={{
          fontFamily: 'monospace',
          fontSize: typography.xl,
          fontWeight: weight.bold,
          color: colors.accent,
          letterSpacing: 4,
        }}
        selectable
      >
        {code}
      </Text>
      <TouchableOpacity
        onPress={handleCopy}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: copied ? colors.good + '22' : colors.accent + '22',
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: copied ? colors.good : colors.accent,
        }}
      >
        <Ionicons
          name={copied ? 'checkmark-circle' : 'copy-outline'}
          size={16}
          color={copied ? colors.good : colors.accent}
        />
        <Text
          style={{
            fontSize: typography.sm,
            fontWeight: weight.semibold,
            color: copied ? colors.good : colors.accent,
          }}
        >
          {copied ? 'Copied!' : 'Copy Code'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function ClientCard({ link, onViewStats, onRemove, colors }) {
  const client = link.client;
  const name = client?.full_name ?? 'Unknown Client';
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <View
      style={{
        backgroundColor: colors.bgCard,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      {/* Avatar */}
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: colors.accent + '33',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: typography.base, fontWeight: weight.bold, color: colors.accent }}>
          {initials}
        </Text>
      </View>

      {/* Info */}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: typography.base, fontWeight: weight.semibold, color: colors.text }}>
          {name}
        </Text>
        {client?.goal ? (
          <Text style={{ fontSize: typography.xs, color: colors.textMuted, marginTop: 2 }}>
            {client.goal}
          </Text>
        ) : null}
      </View>

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TouchableOpacity
          onPress={onViewStats}
          style={{
            backgroundColor: colors.accent,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 8,
          }}
        >
          <Text style={{ fontSize: typography.xs, fontWeight: weight.bold, color: colors.bg }}>
            Stats
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onRemove}
          style={{
            padding: 6,
            borderRadius: 8,
            backgroundColor: colors.danger + '1a',
            borderWidth: 1,
            borderColor: colors.danger + '44',
          }}
        >
          <Ionicons name="person-remove-outline" size={15} color={colors.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PendingRow({ link, onRemove, colors }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.bgCard,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 12,
        marginBottom: 8,
        gap: 10,
      }}
    >
      <Ionicons name="time-outline" size={18} color={colors.warn} />
      <Text
        style={{
          flex: 1,
          fontFamily: 'monospace',
          fontSize: typography.sm,
          color: colors.textMuted,
          letterSpacing: 1,
        }}
      >
        {link.invite_code}
      </Text>
      <TouchableOpacity
        onPress={onRemove}
        style={{
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 7,
          backgroundColor: colors.danger + '1a',
          borderWidth: 1,
          borderColor: colors.danger + '55',
        }}
      >
        <Text style={{ fontSize: typography.xs, color: colors.danger, fontWeight: weight.semibold }}>
          Remove
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function CoachScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [inviteCode, setInviteCode] = useState(null);

  const {
    data: clientLinks = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['coachClients', user?.id],
    queryFn: () => fetchCoachClients(user.id),
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
  });

  const pending = clientLinks.filter((l) => l.status === 'pending');
  const active = clientLinks.filter((l) => l.status === 'active');

  const generateInviteMut = useMutation({
    mutationFn: () => generateInvite(user.id),
    onSuccess: (code) => {
      setInviteCode(code);
      qc.invalidateQueries({ queryKey: ['coachClients', user?.id] });
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const removeLinkMut = useMutation({
    mutationFn: (linkId) => removeLink(linkId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coachClients', user?.id] }),
    onError: (e) => Alert.alert('Error', e.message),
  });

  const handleRemove = (link) => {
    const label = link.status === 'active' ? link.client?.full_name ?? 'this client' : 'this invite';
    Alert.alert(
      'Confirm Remove',
      `Remove ${label}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeLinkMut.mutate(link.id),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="COACH MODE" colors={colors} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {/* ── Generate Invite Code ─────────────────────────────────── */}
        <SectionLabel title="Invite a Client" colors={colors} />
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.generateBtn}
            onPress={() => generateInviteMut.mutate()}
            disabled={generateInviteMut.isPending}
          >
            {generateInviteMut.isPending ? (
              <ActivityIndicator size="small" color={colors.bg} />
            ) : (
              <Ionicons name="add-circle-outline" size={18} color={colors.bg} />
            )}
            <Text style={styles.generateBtnText}>Generate New Invite Code</Text>
          </TouchableOpacity>

          {inviteCode ? (
            <View style={{ padding: 14, paddingTop: 0 }}>
              <InviteCodeBox code={inviteCode} colors={colors} />
              <Text style={styles.inviteHint}>
                Share this code with your client. It expires once used.
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── Pending Invites ──────────────────────────────────────── */}
        <SectionLabel title="Pending Invites" colors={colors} />
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 12 }} />
        ) : pending.length === 0 ? (
          <View style={styles.emptyRow}>
            <Ionicons name="mail-outline" size={20} color={colors.textDim} />
            <Text style={styles.emptyText}>No pending invites</Text>
          </View>
        ) : (
          pending.map((link) => (
            <PendingRow
              key={link.id}
              link={link}
              onRemove={() => handleRemove(link)}
              colors={colors}
            />
          ))
        )}

        {/* ── Active Clients ───────────────────────────────────────── */}
        <SectionLabel title={`Active Clients (${active.length})`} colors={colors} />
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 12 }} />
        ) : active.length === 0 ? (
          <View style={styles.emptyRow}>
            <Ionicons name="people-outline" size={20} color={colors.textDim} />
            <Text style={styles.emptyText}>No active clients yet</Text>
          </View>
        ) : (
          active.map((link) => (
            <ClientCard
              key={link.id}
              link={link}
              onViewStats={() =>
                navigation.navigate('ClientDetail', {
                  clientId: link.client?.id,
                  clientName: link.client?.full_name ?? 'Client',
                })
              }
              onRemove={() => handleRemove(link)}
              colors={colors}
            />
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const createStyles = (colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    content: { paddingHorizontal: 16, paddingBottom: 40 },

    card: {
      backgroundColor: colors.bgCard,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: 4,
    },

    generateBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accent,
      margin: 14,
      paddingVertical: 13,
      borderRadius: 12,
    },
    generateBtnText: {
      fontSize: typography.base,
      fontWeight: weight.bold,
      color: colors.bg,
    },

    inviteHint: {
      fontSize: typography.xs,
      color: colors.textDim,
      textAlign: 'center',
      marginTop: 10,
    },

    emptyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 16,
      paddingHorizontal: 4,
    },
    emptyText: {
      fontSize: typography.sm,
      color: colors.textDim,
    },
  });
