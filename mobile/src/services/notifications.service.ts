import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { MobileApiClient } from './api';

const PUSH_TOKEN_STORAGE_KEY = 'hiralal_device_push_token';

// Configure foreground notification handling
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface PushPermissionStatus {
  granted: boolean;
  status: 'granted' | 'denied' | 'undetermined';
}

export interface NativePushTokenResult {
  token: string | null;
  platform: 'ANDROID' | 'IOS' | 'WEB';
  permissionGranted: boolean;
  errorCode?: string;
}

export class NotificationsService {
  private static cachedToken: string | null = null;
  private static notificationListener: Notifications.Subscription | null = null;
  private static responseListener: Notifications.Subscription | null = null;

  /**
   * Initializes notification channels and listeners.
   */
  static async initialize(): Promise<void> {
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Hiralal & Sons Rewards Notifications',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#1E60D5',
        });
      }

      // Attach notification received listener
      if (!this.notificationListener) {
        this.notificationListener = Notifications.addNotificationReceivedListener((notification) => {
          console.log('[PUSH-NOTIFICATION-RECEIVED]', notification.request.content.title);
        });
      }

      // Attach notification interaction (tap) listener
      if (!this.responseListener) {
        this.responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
          console.log('[PUSH-NOTIFICATION-INTERACTED]', response.notification.request.content.data);
        });
      }
    } catch (err: any) {
      console.warn('[NOTIFICATIONS-SERVICE] Channel or listener initialization warning:', err?.message || err);
    }
  }

  /**
   * Cleans up event listeners upon component/service unmount.
   */
  static cleanup(): void {
    if (this.notificationListener) {
      this.notificationListener.remove();
      this.notificationListener = null;
    }
    if (this.responseListener) {
      this.responseListener.remove();
      this.responseListener = null;
    }
  }

  /**
   * Checks current operating-system notification permission state without prompting.
   */
  static async checkPermissions(): Promise<boolean> {
    try {
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && 'Notification' in window) {
          return Notification.permission === 'granted';
        }
        return false;
      }
      const settings = await Notifications.getPermissionsAsync();
      return Boolean(settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
    } catch {
      return false;
    }
  }

  /**
   * Explains value and requests operating-system notification permissions.
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

      const existingSettings = await Notifications.getPermissionsAsync();
      if (existingSettings.granted || existingSettings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
        return { granted: true, status: 'granted' };
      }

      const requested = await Notifications.requestPermissionsAsync();
      const granted = Boolean(requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);

      return {
        granted,
        status: granted ? 'granted' : 'denied',
      };
    } catch (err: any) {
      console.warn('[NOTIFICATIONS-SERVICE] Permission request warning:', err?.message || err);
      return { granted: false, status: 'denied' };
    }
  }

  /**
   * Acquires genuine native push token via Expo Notifications API.
   * NEVER fabricates fake/synthetic tokens. Returns explicit unavailable status on failure.
   */
  static async getNativePushToken(): Promise<NativePushTokenResult> {
    const platform = Platform.OS === 'android' ? 'ANDROID' : Platform.OS === 'ios' ? 'IOS' : 'WEB';

    // The backend notification service strictly utilizes Firebase Cloud Messaging (FCM HTTP v1).
    // Native FCM device tokens are acquired on Android. iOS APNs is not interchanged with FCM.
    if (Platform.OS !== 'android') {
      return {
        token: null,
        platform,
        permissionGranted: false,
        errorCode: 'PLATFORM_NOT_SUPPORTED_FOR_FCM',
      };
    }

    const hasPermission = await this.checkPermissions();
    if (!hasPermission) {
      return {
        token: null,
        platform,
        permissionGranted: false,
        errorCode: 'PERMISSION_NOT_GRANTED',
      };
    }

    try {
      // Initialize notification channel before token acquisition
      await this.initialize();

      // Retrieve genuine native device token (FCM token on Android)
      const tokenResult = await Notifications.getDevicePushTokenAsync();
      if (tokenResult?.data && typeof tokenResult.data === 'string' && tokenResult.data.trim().length > 10) {
        const genuineToken = tokenResult.data.trim();
        this.cachedToken = genuineToken;
        await this.persistToken(genuineToken);

        return {
          token: genuineToken,
          platform,
          permissionGranted: true,
        };
      }

      return {
        token: null,
        platform,
        permissionGranted: true,
        errorCode: 'EMPTY_DEVICE_TOKEN_RETURNED',
      };
    } catch (err: any) {
      console.warn('[NOTIFICATIONS-SERVICE] Genuine native token acquisition failed:', err?.message || err);
      return {
        token: null,
        platform,
        permissionGranted: true,
        errorCode: 'NATIVE_TOKEN_ACQUISITION_FAILED',
      };
    }
  }

  /**
   * Persists token safely in encrypted storage
   */
  private static async persistToken(token: string): Promise<void> {
    try {
      if (Platform.OS !== 'web') {
        await SecureStore.setItemAsync(PUSH_TOKEN_STORAGE_KEY, token);
      }
    } catch {
      // Non-fatal
    }
  }

  /**
   * Registers genuine device push token with the backend upon authentication.
   * If permission is denied or token acquisition fails, gracefully aborts without registering.
   */
  static async registerDeviceToken(): Promise<boolean> {
    try {
      const permStatus = await this.requestPermissions();
      if (!permStatus.granted) {
        console.log('[NOTIFICATIONS-SERVICE] Notification permission denied; skipping token registration.');
        return false;
      }

      const result = await this.getNativePushToken();
      if (!result.token) {
        console.log(`[NOTIFICATIONS-SERVICE] Genuine push token unavailable (${result.errorCode}); skipping registration.`);
        return false;
      }

      await MobileApiClient.registerDevicePushToken(result.token, result.platform);
      console.log(`[NOTIFICATIONS-SERVICE] Registered genuine native device token (${result.platform})`);
      return true;
    } catch (err: any) {
      console.warn('[NOTIFICATIONS-SERVICE] Device token registration warning:', err?.message || err);
      return false;
    }
  }

  /**
   * Deactivates registered device token on the backend upon logout or account deletion.
   */
  static async deactivateDeviceToken(): Promise<boolean> {
    try {
      let storedToken = this.cachedToken;
      if (!storedToken && Platform.OS !== 'web') {
        storedToken = await SecureStore.getItemAsync(PUSH_TOKEN_STORAGE_KEY).catch(() => null);
      }

      if (storedToken) {
        await MobileApiClient.deactivateDevicePushToken(storedToken).catch((e: any) => {
          console.warn('[NOTIFICATIONS-SERVICE] Backend deactivation returned warning:', e?.message || e);
        });
      }

      this.cachedToken = null;
      if (Platform.OS !== 'web') {
        await SecureStore.deleteItemAsync(PUSH_TOKEN_STORAGE_KEY).catch(() => {});
      }

      return true;
    } catch (err: any) {
      console.warn('[NOTIFICATIONS-SERVICE] Device token deactivation error:', err?.message || err);
      return false;
    }
  }
}
