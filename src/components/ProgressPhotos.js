import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  FlatList, Alert, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';

export default function ProgressPhotos({ userId }) {
  const { colors } = useTheme();
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchPhotos = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('progress_photos')
        .select('*')
        .eq('user_id', userId)
        .order('taken_at', { ascending: false });
      if (error) throw error;

      const withUrls = await Promise.all(
        (data || []).map(async (row) => {
          const { data: urlData } = await supabase.storage
            .from('progress-photos')
            .createSignedUrl(row.storage_path, 3600);
          return { ...row, signedUrl: urlData?.signedUrl ?? null };
        })
      );
      setPhotos(withUrls);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Fetch on mount
  React.useEffect(() => {
    if (userId) fetchPhotos();
  }, [userId, fetchPhotos]);

  const handleAdd = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'Images',
      quality: 0.7,
    });
    if (result.canceled) return;

    const uri = result.assets[0].uri;
    const path = `${userId}/${Date.now()}.jpg`;
    setUploading(true);
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const { error: uploadError } = await supabase.storage
        .from('progress-photos')
        .upload(path, blob, { contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase
        .from('progress_photos')
        .insert({ user_id: userId, storage_path: path });
      if (insertError) throw insertError;

      await fetchPhotos();
    } catch (e) {
      Alert.alert('Upload failed', e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (photo) => {
    Alert.alert('Delete photo?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await supabase.storage.from('progress-photos').remove([photo.storage_path]);
            await supabase.from('progress_photos').delete().eq('id', photo.id);
            setPhotos(prev => prev.filter(p => p.id !== photo.id));
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>📸 Progress Photos</Text>
        <TouchableOpacity onPress={handleAdd} disabled={uploading} style={styles.addBtn}>
          {uploading
            ? <ActivityIndicator size="small" color={colors.bg} />
            : <Text style={styles.addBtnText}>+</Text>
          }
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} />
      ) : photos.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No progress photos yet{'\n'}Tap + to add your first</Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={item => item.id}
          numColumns={3}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <View style={styles.photoWrap}>
              {item.signedUrl ? (
                <Image source={{ uri: item.signedUrl }} style={styles.photo} />
              ) : (
                <View style={[styles.photo, styles.photoPlaceholder]} />
              )}
              <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item)}>
                <Text style={styles.deleteBtnText}>🗑️</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: {
    backgroundColor: colors.bgCard,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: typography.base,
    fontWeight: weight.bold,
    color: colors.text,
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    fontSize: typography.xl,
    fontWeight: weight.bold,
    color: colors.bg,
    lineHeight: 28,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: typography.sm,
    textAlign: 'center',
    lineHeight: 22,
  },
  photoWrap: {
    flex: 1,
    margin: 2,
    aspectRatio: 1,
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  photoPlaceholder: {
    backgroundColor: colors.bgElevated,
  },
  deleteBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 10,
    padding: 2,
  },
  deleteBtnText: {
    fontSize: 12,
  },
});
