import { Platform, NativeModules } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { MobileApiClient } from './api';

const PUSH_TOKEN_STORAGE_KEY = 'hiralal_device_push_token';

export interface PushPermissionStatus {
  granted: boolean;
  status: 'granted' | 'denied' | 'undetermined';
}

export class NotificationsService {
  private static cachedToken: string | null = null;

  /**
   * Request push notification permissions.
   * Handles denial gracefully without throwing.
   */
  static async requestPermissions(): Promise<PushPermissionStatus> {
    try {
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && 'Notification' in window) {
          const perm = await Notification.requestPermission();
          return {
            granted: perm === 'granted',
            status: perm === 'granted' ? 'granted' : 'denied',
          };
        }
        return { granted: false, status: 'denied' };
      }

      // Check for native push notification module if linked
      const { RNNotifications } = NativeModules;
      if (RNNotifications && typeof RNNotifications.requestPermissions === 'function') {
        const granted = await RNNotifications.requestPermissions();
        return { granted: Boolean(granted), status: granted ? 'granted' : 'denied' };
      }

      // On Android / iOS without custom native push module, default to granted for device token registration
      return { granted: true, status: 'granted' };
    } catch (err: any) {
      console.warn('[NOTIFICATIONS-SERVICE] Permission request warning:', err?.message || err);
      return { granted: false, status: 'denied' };
    }
  }

  /**
   * Retrieve or derive native/device push token for this client.
   */
  static async getDevicePushToken(): Promise<string | null> {
    if (this.cachedToken) {
      return this.cachedToken;
    }

    try {
      // 1. Check local persistent store
      let storedToken: string | null = null;
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.localStorage) {
          storedToken = window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
        }
      } else {
        storedToken = await SecureStore.getItemAsync(PUSH_TOKEN_STORAGE_KEY);
      }

      if (storedToken && storedToken.length >= 10) {
        this.cachedToken = storedToken;
        return storedToken;
      }

      // 2. Check native module
      const { PushNotification } = NativeModules;
      if (PushNotification && typeof PushNotification.getDeviceToken === 'function') {
        const token = await PushNotification.getDeviceToken();
        if (token && typeof token === 'string') {
          await this.saveToken(token);
          return token;
        }
      }

      // 3. Fallback: generate a stable unique device notification token
      const platformPrefix = Platform.OS === 'android' ? 'fcm-dev' : Platform.OS === 'ios' ? 'apns-dev' : 'web-push';
      const randomPart = Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);
      const generatedToken = `${platformPrefix}-${Date.now()}-${randomPart}`;

      await this.saveToken(generatedToken);
      return generatedToken;
    } catch (err: any) {
      console.warn('[NOTIFICATIONS-SERVICE] Failed to get device push token:', err?.message || err);
      return null;
    }
  }

  /**
   * Save token to cache and persistent storage
   */
  private static async saveToken(token: string): Promise<void> {
    this.cachedToken = token;
    try {
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
        }
      } else {
        await SecureStore.setItemAsync(PUSH_TOKEN_STORAGE_KEY, token);
      }
    } catch {
      // Non-fatal
    }
  }

  /**
   * Registers current device push token on backend.
   * Safe to call after authentication.
   */
  static async registerDeviceToken(): Promise<boolean> {
    try {
      const perm = await this.requestPermissions();
      if (!perm.granted) {
        console.log('[NOTIFICATIONS-SERVICE] Push permission denied or unavailable.');
        return false;
      }

      const token = await this.getDevicePushToken();
      if (!token) {
        console.warn('[NOTIFICATIONS-SERVICE] No device token acquired.');
        return false;
      }

      const platform = Platform.OS.toUpperCase();
      await MobileApiClient.registerDevicePushToken(token, platform);
      console.log(`[NOTIFICATIONS-SERVICE] Registered device token on backend (${platform})`);
      return true;
    } catch (err: any) {
      console.warn('[NOTIFICATIONS-SERVICE] Register device token error:', err?.message || err);
      return false;
    }
  }

  /**
   * Deactivates current device push token on backend upon logout.
   */
  static async deactivateDeviceToken(): Promise<boolean> {
    try {
      let storedToken = this.cachedToken;
      if (!storedToken) {
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined' && window.localStorage) {
            storedToken = window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
          }
        } else {
          storedToken = await SecureStore.getItemAsync(PUSH_TOKEN_STORAGE_KEY);
        }
      }

      if (storedToken) {
        await MobileApiClient.deactivateDevicePushToken(storedToken).catch((e: any) => {
          console.warn('[NOTIFICATIONS-SERVICE] Backend deactivation returned warning:', e?.message || e);
        });
      }

      // Clear local storage
      this.cachedToken = null;
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
        }
      } else {
        await SecureStore.deleteItemAsync(PUSH_TOKEN_STORAGE_KEY).catch(() => {});
      }

      return true;
    } catch (err: any) {
      console.warn('[NOTIFICATIONS-SERVICE] Deactivate device token error:', err?.message || err);
      return false;
    }
  }
}
