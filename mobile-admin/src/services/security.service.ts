import { NativeModules, Platform } from 'react-native';
// @ts-ignore
import {
  evaluateDeveloperModeStatus,
  executeOpenDeveloperSettings,
} from '../../plugins/developerSecurity';

const { SecurityModule, Security } = NativeModules;
const NativeSecurity = SecurityModule || Security;

/**
 * Checks whether Android Developer Options or USB Debugging (ADB) is enabled on this device.
 *
 * Security Invariants:
 * 1. Development Bypass (__DEV__): Always returns false when __DEV__ is true, allowing developers
 *    to work with Metro, Expo Go, USB debugging, and Android Studio seamlessly.
 * 2. Platform Isolation: Returns false on non-Android platforms (iOS / Web).
 * 3. Fail-Safe: Catches native bridge exceptions and logs warnings without crashing.
 *
 * @returns Promise<boolean> true if developer options or USB debugging is active; false otherwise.
 */
export async function checkDeveloperMode(): Promise<boolean> {
  return evaluateDeveloperModeStatus({
    isDev: typeof __DEV__ !== 'undefined' ? __DEV__ : false,
    platform: Platform.OS,
    nativeModule: NativeSecurity,
  });
}

/**
 * Direct settings deep link: opens the phone's Android Developer Options Settings page
 * via ACTION_APPLICATION_DEVELOPMENT_SETTINGS intent (with fallback to general Settings).
 */
export async function openDeveloperSettings(): Promise<void> {
  return executeOpenDeveloperSettings({
    platform: Platform.OS,
    nativeModule: NativeSecurity,
  });
}
