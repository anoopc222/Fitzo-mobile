import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermissions() {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function cancelNotificationsByTag(tag) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter(n => n.content?.data?.tag === tag)
      .map(n => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
}

export async function scheduleDailyReminder(tag, hour, minute, title, body) {
  await cancelNotificationsByTag(tag);
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { tag } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute },
  });
}

// Cancels any pending same-day notification for `tag`, then re-schedules one
// for later today only if `loggedToday` is false — so it's a no-op once the
// user logs that metric, and self-corrects each time the screen re-renders.
export async function syncConditionalReminder(tag, loggedToday, hour, minute, title, body) {
  await cancelNotificationsByTag(tag);
  if (loggedToday) return;
  const todayStr = new Date().toISOString().slice(0, 10);
  await scheduleDateReminder(tag, todayStr, hour, minute, title, body);
}

export async function scheduleWeeklySummary() {
  await Notifications.cancelScheduledNotificationAsync('weeklySummary').catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: 'weeklySummary',
    content: {
      title: '📊 Your Weekly Fitzo Summary',
      body: 'Check how your week went — weight, steps, workouts & sleep!',
      sound: true,
    },
    trigger: {
      weekday: 1, // Sunday (1=Sunday in Expo)
      hour: 19,
      minute: 0,
      repeats: true,
    },
  });
}

// ─── Push token registration ──────────────────────────────────────────────────

export async function registerPushToken(userId) {
  if (!Device.isDevice) return; // simulators don't get real tokens
  try {
    const granted = await requestNotificationPermissions();
    if (!granted) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('chat', {
        name: 'Coach / Client Messages',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: '2f23cd2b-840c-441c-a590-34b3af3d30fb',
    });

    if (token && userId) {
      await supabase.from('profiles').update({ expo_push_token: token }).eq('id', userId);
    }
  } catch (_) {
    // never throw — push token is best-effort
  }
}

// ─── Send chat push notification ─────────────────────────────────────────────

export async function sendChatPushNotification({ recipientId, senderName, message }) {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('expo_push_token')
      .eq('id', recipientId)
      .single();

    const token = data?.expo_push_token;
    if (!token) return;

    await fetch('https://exp.host/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: token,
        title: `💬 ${senderName}`,
        body: message.length > 80 ? message.slice(0, 77) + '…' : message,
        sound: 'default',
        channelId: 'chat',
        data: { tag: 'coachChat' },
      }),
    });
  } catch (_) {
    // never throw
  }
}

export async function scheduleDateReminder(tag, date, hour, minute, title, body) {
  const fireDate = new Date(`${date}T00:00:00`);
  fireDate.setHours(hour, minute, 0, 0);
  if (fireDate <= new Date()) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { tag } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireDate },
  });
}
