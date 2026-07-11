import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
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

  const activeIds = rows.filter(r => r.status === 'active' && r.client_id).map(r => r.client_id);
  let profileMap = {};
  if (activeIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, goal, step_goal, sleep_goal_hours, calorie_target')
      .in('id', activeIds);
    (profiles ?? []).forEach(p => { profileMap[p.id] = p; });
  }
  return rows.map(r => ({ ...r, client: profileMap[r.client_id] ?? null }));
}

async function generateInvite(coachId) {
  const { data, error } = await supabase.rpc('generate_coach_invite', { p_coach_id: coachId });
  if (error) throw error;
  return data;
}

async function removeLink(linkId) {
  const { error } = await supabase.from('coach_clients').update({ status: 'removed' }).eq('id', linkId);
  if (error) throw error;
}

// ─── Components ────────────────────────────────────────────────────────────────

function InviteCodeModal({ code, onClose, colors }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center',
      zIndex: 999,
    }}>
      <View style={{
        backgroundColor: colors.bgCard, borderRadius: 24, padding: 28,
        width: '85%', borderWidth: 1, borderColor: colors.border,
        alignItems: 'center', gap: 16,
      }}>
        <View style={{
          width: 56, height: 56, borderRadius: 28,
          backgroundColor: colors.accent + '22', alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="link" size={26} color={colors.accent} />
        </View>

        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' }}>
            Invite Code
          </Text>
          <Text style={{
            fontSize: 34, fontWeight: weight.bold, color: colors.accent,
            letterSpacing: 8, fontVariant: ['tabular-nums'],
          }}>
            {code}
          </Text>
          <Text style={{ fontSize: typography.xs, color: colors.textDim, textAlign: 'center', lineHeight: 18 }}>
            Share this with your client.{'\n'}It expires once used.
          </Text>
        </View>

        <TouchableOpacity
          onPress={handleCopy}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: copied ? '#34d399' + '22' : colors.accent + '22',
            borderWidth: 1, borderColor: copied ? '#34d399' : colors.accent,
            paddingHorizontal: 24, paddingVertical: 11, borderRadius: 14, width: '100%',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={18} color={copied ? '#34d399' : colors.accent} />
          <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: copied ? '#34d399' : colors.accent }}>
            {copied ? 'Copied!' : 'Copy Code'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onClose} style={{ paddingVertical: 8 }}>
          <Text style={{ fontSize: typography.sm, color: colors.textDim, fontWeight: weight.medium }}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ClientCard({ link, onViewStats, onRemove, colors }) {
  const client = link.client;
  const name = client?.full_name ?? 'Client';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const hue = name.charCodeAt(0) % 360;

  return (
    <View style={{
      backgroundColor: colors.bgCard, borderRadius: 18,
      borderWidth: 1, borderColor: colors.border,
      marginBottom: 10, overflow: 'hidden',
    }}>
      {/* Top strip */}
      <View style={{ height: 3, backgroundColor: colors.accent + '66' }} />

      <View style={{ padding: 16, gap: 14 }}>
        {/* Identity row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{
            width: 50, height: 50, borderRadius: 25,
            backgroundColor: colors.accent + '28',
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: colors.accent + '44',
          }}>
            <Text style={{ fontSize: typography.lg, fontWeight: weight.bold, color: colors.accent }}>
              {initials}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: typography.base, fontWeight: weight.bold, color: colors.text }}>
              {name}
            </Text>
            {client?.goal && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                <Ionicons name="flag-outline" size={11} color={colors.textDim} />
                <Text style={{ fontSize: 11, color: colors.textDim }}>{client.goal}</Text>
              </View>
            )}
          </View>
          <View style={{
            backgroundColor: '#34d399' + '22', borderRadius: 8,
            paddingHorizontal: 8, paddingVertical: 3,
            flexDirection: 'row', alignItems: 'center', gap: 4,
          }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#34d399' }} />
            <Text style={{ fontSize: 10, color: '#34d399', fontWeight: weight.bold }}>Active</Text>
          </View>
        </View>

        {/* Action buttons */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            onPress={onViewStats}
            style={{
              flex: 1, backgroundColor: colors.accent, borderRadius: 12,
              paddingVertical: 10, flexDirection: 'row', alignItems: 'center',
              justifyContent: 'center', gap: 6,
            }}
          >
            <Ionicons name="bar-chart-outline" size={15} color={colors.bg} />
            <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.bg }}>
              View Stats
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onRemove}
            style={{
              paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
              backgroundColor: colors.danger + '15',
              borderWidth: 1, borderColor: colors.danger + '40',
              flexDirection: 'row', alignItems: 'center', gap: 5,
            }}
          >
            <Ionicons name="person-remove-outline" size={15} color={colors.danger} />
            <Text style={{ fontSize: typography.sm, color: colors.danger, fontWeight: weight.medium }}>Remove</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function PendingRow({ link, onRemove, colors }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.bgCard, borderRadius: 12,
      borderWidth: 1, borderColor: colors.border + '88',
      borderLeftWidth: 3, borderLeftColor: colors.warning ?? '#fbbf24',
      padding: 12, marginBottom: 8, gap: 10,
    }}>
      <Ionicons name="time-outline" size={18} color={colors.warning ?? '#fbbf24'} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 11, color: colors.textDim, marginBottom: 2 }}>Awaiting client</Text>
        <Text style={{ fontWeight: weight.bold, color: colors.text, letterSpacing: 2, fontSize: typography.sm }}>
          {link.invite_code}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onRemove}
        style={{
          paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
          backgroundColor: colors.danger + '15', borderWidth: 1, borderColor: colors.danger + '44',
        }}
      >
        <Text style={{ fontSize: 11, color: colors.danger, fontWeight: weight.semibold }}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function CoachScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const [inviteCode, setInviteCode] = useState(null);

  const { data: clientLinks = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['coachClients', user?.id],
    queryFn: () => fetchCoachClients(user.id),
    enabled: !!user?.id,
    staleTime: 0, gcTime: 0,
  });

  const pending = clientLinks.filter(l => l.status === 'pending');
  const active  = clientLinks.filter(l => l.status === 'active');

  const generateMut = useMutation({
    mutationFn: () => generateInvite(user.id),
    onSuccess: (code) => {
      setInviteCode(code);
      qc.invalidateQueries({ queryKey: ['coachClients', user?.id] });
    },
    onError: e => Alert.alert('Error', e.message),
  });

  const removeMut = useMutation({
    mutationFn: removeLink,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coachClients', user?.id] }),
    onError: e => Alert.alert('Error', e.message),
  });

  const handleRemove = (link) => {
    const label = link.status === 'active' ? (link.client?.full_name ?? 'this client') : 'this invite';
    Alert.alert('Confirm', `Remove ${label}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMut.mutate(link.id) },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 18, paddingTop: 6, paddingBottom: 12, gap: 12,
      }}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: typography.xl, fontWeight: weight.bold, color: colors.text }}>Coach Mode</Text>
          <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>
            {active.length} active client{active.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <Ionicons name="people" size={22} color={colors.accent} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 50 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} colors={[colors.accent]} />}
      >
        {/* ── Generate Invite ──────────────────────────────────────── */}
        <View style={{
          backgroundColor: colors.bgCard, borderRadius: 20,
          borderWidth: 1, borderColor: colors.border, padding: 18, marginBottom: 20,
        }}>
          <Text style={{ fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
            Invite a Client
          </Text>
          <Text style={{ fontSize: typography.sm, color: colors.textDim, lineHeight: 20, marginBottom: 14 }}>
            Generate a unique code and share it with your client. They enter it in Settings → Coach Mode → Join a Coach.
          </Text>
          <TouchableOpacity
            onPress={() => generateMut.mutate()}
            disabled={generateMut.isPending}
            style={{
              backgroundColor: colors.accent, borderRadius: 14,
              paddingVertical: 13, flexDirection: 'row',
              alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: generateMut.isPending ? 0.7 : 1,
            }}
          >
            {generateMut.isPending
              ? <ActivityIndicator size="small" color={colors.bg} />
              : <Ionicons name="add-circle-outline" size={18} color={colors.bg} />
            }
            <Text style={{ fontSize: typography.base, fontWeight: weight.bold, color: colors.bg }}>
              Generate New Invite Code
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Pending Invites ──────────────────────────────────────── */}
        {pending.length > 0 && (
          <>
            <Text style={{ fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
              Pending Invites ({pending.length})
            </Text>
            {pending.map(link => (
              <PendingRow key={link.id} link={link} onRemove={() => handleRemove(link)} colors={colors} />
            ))}
            <View style={{ height: 10 }} />
          </>
        )}

        {/* ── Active Clients ───────────────────────────────────────── */}
        <Text style={{ fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
          Active Clients ({active.length})
        </Text>

        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 20 }} />
        ) : active.length === 0 ? (
          <View style={{
            alignItems: 'center', paddingVertical: 40, gap: 12,
            backgroundColor: colors.bgCard, borderRadius: 18,
            borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
          }}>
            <Ionicons name="people-outline" size={40} color={colors.textDim} />
            <Text style={{ fontSize: typography.sm, color: colors.textDim, textAlign: 'center', lineHeight: 20 }}>
              No active clients yet.{'\n'}Generate an invite code above to get started.
            </Text>
          </View>
        ) : (
          active.map(link => (
            <ClientCard
              key={link.id}
              link={link}
              onViewStats={() => navigation.navigate('ClientDetail', {
                clientId: link.client?.id,
                clientName: link.client?.full_name ?? 'Client',
              })}
              onRemove={() => handleRemove(link)}
              colors={colors}
            />
          ))
        )}
      </ScrollView>

      {/* Invite code overlay */}
      {inviteCode && (
        <InviteCodeModal code={inviteCode} onClose={() => setInviteCode(null)} colors={colors} />
      )}
    </SafeAreaView>
  );
}
