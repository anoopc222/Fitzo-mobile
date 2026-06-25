import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

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

export async function scheduleDateReminder(tag, date, hour, minute, title, body) {
  const fireDate = new Date(`${date}T00:00:00`);
  fireDate.setHours(hour, minute, 0, 0);
  if (fireDate <= new Date()) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { tag } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireDate },
  });
}
