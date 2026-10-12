import { NativeModules, Platform } from 'react-native';
import { MobileApiClient } from './api';

export type ProtectedAction = 'BILL_UPLOAD' | 'PAYOUT_REDEEM' | 'KYC_SUBMIT' | 'ACCOUNT_DELETION';

export interface ActionAttestation {
  integrityToken: string;
  integrityNonce: string;
}

/**
 * Mobile Play Integrity Service Adapter
 *
 * Implements Google Play Integrity device attestation for Android clients.
 * Interacts with the native PlayIntegrity module to request genuine on-device integrity tokens.
 *
 * Multiplatform Security Policy:
 * - Android (Production): Requires Google Play Services and Play Integrity native module.
 * - Android (Development): In Expo Go or emulator without Google Play, throws clear requirement message.
 * - Non-Android (iOS/Web): Craftsman protected financial actions are restricted to Android devices.
 *   Non-Android platforms fail with explicit unsupported policy error.
 */
export class MobileIntegrityService {
  /**
   * Request a genuine device integrity token from Google Play Services via the native module.
   */
  static async requestDeviceIntegrityToken(nonce: string): Promise<string> {
    if (Platform.OS !== 'android') {
      throw new Error(
        `Play Integrity device attestation is only supported on Android devices. Current platform "${Platform.OS}" is unsupported.`
      );
    }

    const { PlayIntegrity } = NativeModules;
    if (!PlayIntegrity || typeof PlayIntegrity.requestIntegrityToken !== 'function') {
      throw new Error(
        'Play Integrity native module is not linked in this build environment. ' +
        'A custom Android development build (npx expo run:android) or release APK with Google Play Services is required.'
      );
    }

    try {
      const token: string = await PlayIntegrity.requestIntegrityToken(nonce);
      if (!token || typeof token !== 'string') {
        throw new Error('Google Play Services returned an empty integrity token.');
      }
      return token;
    } catch (err: any) {
      throw new Error(`Failed to request Play Integrity token from device: ${err.message || err}`);
    }
  }

  /**
   * Performs complete action attestation flow:
   * 1. Validates the 64-character hexadecimal SHA-256 request hash
   * 2. Requests authenticated, action-bound single-use nonce from the backend
   * 3. Requests genuine device token from Google Play Integrity API on device
   * 4. Returns { integrityToken, integrityNonce } to be passed to the protected action API
   */
  static async performActionAttestation(
    action: ProtectedAction,
    requestHash: string
  ): Promise<ActionAttestation> {
    if (!requestHash || typeof requestHash !== 'string' || !/^[a-f0-9]{64}$/i.test(requestHash)) {
      throw new Error('A valid 64-character hexadecimal SHA-256 requestHash is required for action attestation.');
    }

    // 1. Obtain action-bound server nonce
    const nonceRes = await MobileApiClient.getIntegrityNonce({
      action,
      requestHash: requestHash.toLowerCase(),
    });
    if (!nonceRes?.success || !nonceRes?.nonce) {
      throw new Error(nonceRes?.message || 'Failed to acquire integrity nonce from server.');
    }
    const nonce = nonceRes.nonce;

    // 2. Obtain genuine device token from native Play Integrity
    const integrityToken = await this.requestDeviceIntegrityToken(nonce);

    return {
      integrityToken,
      integrityNonce: nonce,
    };
  }
}
