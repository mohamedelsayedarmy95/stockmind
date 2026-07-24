import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useSettingsStore } from '@/store/settings.store';

/**
 * On-device (local) notifications for offline reminders. These are scheduled by
 * the OS alarm manager, so they fire even in Airplane Mode — no Firebase Cloud
 * Messaging or network involved. Used for item reminders (maintenance dates,
 * restock alerts) in offline mode.
 */

const CHANNEL_ID = 'reminders';

export async function ensureNotificationSetup(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  let granted = settings.granted;
  if (!granted) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.granted;
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  return granted;
}

/** Schedules a local reminder; returns the OS notification id (store it). */
export async function scheduleReminder(
  title: string,
  body: string,
  fireAt: Date,
): Promise<string | null> {
  if (!useSettingsStore.getState().notificationsEnabled) return null;
  const granted = await ensureNotificationSetup();
  if (!granted) return null;

  return Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default' },
    // expo-notifications 0.28 date-trigger form: { date, channelId }.
    trigger: { date: fireAt, channelId: CHANNEL_ID },
  });
}

export async function cancelReminder(notificationId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}
