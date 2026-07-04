import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
  Linking, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// expo-updates only works in standalone EAS builds, not Expo Go.
// We load it dynamically so the app doesn't crash in dev.
let Updates = null;
try {
  Updates = require('expo-updates');
} catch (_) {}

import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SNOOZE_KEY = 'fitzo:updateBannerSnoozed';
const SNOOZE_HOURS = 24;

const STORE_URL = Platform.select({
  ios: 'itms-apps://apps.apple.com/app/id123456789', // replace with real App Store ID
  android: 'market://details?id=com.fitness.fitzo',
  default: 'https://fitzo.app',
});

export default function UpdateBanner() {
  const [visible, setVisible] = useState(false);
  const [isOTA, setIsOTA] = useState(false); // true = OTA update, false = store update
  const slideAnim = useRef(new Animated.Value(80)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    checkForUpdate();
  }, []);

  async function checkForUpdate() {
    try {
      // expo-updates unavailable (Expo Go) or not in a standalone build — skip silently
      if (!Updates || !Updates.isEnabled) return;

      // Check if banner was recently snoozed
      const snoozedAt = await AsyncStorage.getItem(SNOOZE_KEY);
      if (snoozedAt) {
        const hours = (Date.now() - Number(snoozedAt)) / 3_600_000;
        if (hours < SNOOZE_HOURS) return;
      }

      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        setIsOTA(true);
        show();
      }
    } catch (_) {
      // silently ignore — never block the app
    }
  }

  function show() {
    setVisible(true);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 8,
    }).start();
  }

  function hide() {
    Animated.timing(slideAnim, {
      toValue: 80,
      duration: 220,
      useNativeDriver: true,
    }).start(() => setVisible(false));
  }

  async function handleUpdate() {
    if (isOTA && Updates) {
      try {
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
      } catch (_) {
        Linking.openURL(STORE_URL);
      }
    } else {
      Linking.openURL(STORE_URL);
    }
  }

  async function handleDismiss() {
    await AsyncStorage.setItem(SNOOZE_KEY, String(Date.now()));
    hide();
  }

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        s.wrapper,
        { bottom: insets.bottom + 8, transform: [{ translateY: slideAnim }] },
      ]}
      pointerEvents="box-none"
    >
      <View style={s.banner}>
        <View style={s.iconWrap}>
          <Ionicons name="arrow-up-circle" size={28} color="#d4ff00" />
        </View>

        <View style={s.textBlock}>
          <Text style={s.title}>Update Available</Text>
          <Text style={s.sub}>
            {isOTA ? 'A new version is ready to apply.' : 'Get the latest version from the store.'}
          </Text>
        </View>

        <TouchableOpacity style={s.updateBtn} onPress={handleUpdate} activeOpacity={0.8}>
          <Text style={s.updateBtnText}>Update</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.closeBtn} onPress={handleDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={16} color="rgba(255,255,255,0.45)" />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111118',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d4ff0030',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#d4ff0015',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.2,
  },
  sub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 1,
  },
  updateBtn: {
    backgroundColor: '#d4ff00',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  updateBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#000',
    letterSpacing: 0.3,
  },
  closeBtn: {
    padding: 2,
  },
});
