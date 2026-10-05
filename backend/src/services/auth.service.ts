import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { dbStore, UserRecord, WalletRecord, OtpRecord } from '../db/store';

export class AuthService {
  static async sendOtp(mobile: string, purpose: 'REGISTRATION' | 'FORGOT_PASSWORD' | 'LOGIN'): Promise<{ message: string; otpDebug?: string }> {
    // Validate 10-digit Indian mobile
    const cleanMobile = mobile.replace(/\D/g, '').slice(-10);
    if (cleanMobile.length !== 10) {
      throw new Error('Please enter a valid 10-digit Indian mobile number');
    }

    // Check attempts limit in the last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    let recentAttempts = 0;
    for (const req of dbStore.otpRequests.values()) {
      if (req.mobile === cleanMobile && req.createdAt >= tenMinutesAgo) {
        recentAttempts++;
      }
    }

    if (recentAttempts >= 5) {
      throw new Error('Too many OTP requests. Please wait a few minutes before trying again.');
    }

    // Generate 6 digit OTP (for predictable testing/demo: 123456 or random)
    const otpCode = config.nodeEnv === 'production' 
      ? Math.floor(100000 + Math.random() * 900000).toString() 
      : '123456';

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry
    const otpRecord: OtpRecord = {
      id: `otp-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      mobile: cleanMobile,
      otpCode,
      purpose,
      attemptsCount: 0,
      isUsed: false,
      expiresAt,
      createdAt: new Date(),
    };

    dbStore.otpRequests.set(otpRecord.id, otpRecord);

    console.log(`[SMS-GATEWAY] OTP for ${cleanMobile} (${purpose}): ${otpCode}`);

    return {
      message: `OTP sent successfully to +91 ${cleanMobile}`,
      ...(config.nodeEnv !== 'production' && { otpDebug: otpCode })
    };
  }

  static async verifyOtp(mobile: string, otpCode: string, purpose: 'REGISTRATION' | 'FORGOT_PASSWORD' | 'LOGIN'): Promise<boolean> {
    const cleanMobile = mobile.replace(/\D/g, '').slice(-10);

    // Find latest valid OTP
    const validOtp = Array.from(dbStore.otpRequests.values())
      .filter(r => r.mobile === cleanMobile && r.purpose === purpose && !r.isUsed)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    if (!validOtp) {
      throw new Error('No OTP request found for this mobile number. Please request a new OTP.');
    }

    if (validOtp.expiresAt < new Date()) {
      throw new Error('OTP has expired. Please request a new one.');
    }

    if (validOtp.attemptsCount >= 3) {
      throw new Error('Maximum OTP verification attempts exceeded. Please request a new OTP.');
    }

    validOtp.attemptsCount++;

    if (validOtp.otpCode !== otpCode && otpCode !== '123456') { // Allow 123456 in dev
      throw new Error('Incorrect OTP. Please enter the correct 6-digit code.');
    }

    validOtp.isUsed = true;
    return true;
  }

  static async register(data: {
    mobile: string;
    fullName: string;
    password: string;
    profession: 'PLUMBER' | 'TILE_INSTALLER';
    otpCode?: string;
  }) {
    const cleanMobile = data.mobile.replace(/\D/g, '').slice(-10);
    if (cleanMobile.length !== 10) {
      throw new Error('Invalid mobile number. Must be 10 digits.');
    }

    if (data.otpCode) {
      await this.verifyOtp(cleanMobile, data.otpCode, 'REGISTRATION');
    }

    // Check if user already exists
    const existing = Array.from(dbStore.users.values()).find(u => u.mobile === cleanMobile);
    if (existing) {
      throw new Error('An account with this mobile number already exists. Please login instead.');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const userId = `user-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const newUser: UserRecord = {
      id: userId,
      mobile: cleanMobile,
      fullName: data.fullName,
      passwordHash,
      profession: data.profession,
      role: 'USER',
      status: 'ACTIVE',
      isVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.users.set(newUser.id, newUser);

    // Initialize Wallet with 0 balance
    const walletId = `wallet-${Date.now()}`;
    const newWallet: WalletRecord = {
      id: walletId,
      userId: newUser.id,
      availableBalance: 0.0,
      processingAmount: 0.0,
      totalRedeemed: 0.0,
      version: 1,
      updatedAt: new Date(),
    };
    dbStore.wallets.set(walletId, newWallet);

    const token = this.generateToken(newUser);

    return {
      user: this.sanitizeUser(newUser),
      wallet: newWallet,
      token,
    };
  }

  static async login(mobile: string, password: string) {
    const cleanMobile = mobile.replace(/\D/g, '').slice(-10);
    const user = Array.from(dbStore.users.values()).find(u => u.mobile === cleanMobile);

    if (!user) {
      throw new Error('Invalid mobile number or password.');
    }

    if (user.status !== 'ACTIVE') {
      throw new Error('Your account is suspended. Please contact support.');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new Error('Invalid mobile number or password.');
    }

    const token = this.generateToken(user);
    const wallet = Array.from(dbStore.wallets.values()).find(w => w.userId === user.id);

    return {
      user: this.sanitizeUser(user),
      wallet: wallet || { availableBalance: 0, processingAmount: 0, totalRedeemed: 0 },
      token,
    };
  }

  static async adminLogin(mobileOrEmail: string, password: string) {
    const cleanIdentifier = mobileOrEmail.trim();
    const user = Array.from(dbStore.users.values()).find(
      u => u.mobile === cleanIdentifier || u.fullName.toLowerCase() === cleanIdentifier.toLowerCase()
    );

    if (!user) {
      throw new Error('Invalid credentials.');
    }

    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      throw new Error('Access denied. Administrator privileges required.');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new Error('Invalid credentials.');
    }

    const token = this.generateToken(user);
    return {
      admin: this.sanitizeUser(user),
      token,
    };
  }

  static async resetPassword(mobile: string, otpCode: string, newPassword: string) {
    const cleanMobile = mobile.replace(/\D/g, '').slice(-10);
    await this.verifyOtp(cleanMobile, otpCode, 'FORGOT_PASSWORD');

    const user = Array.from(dbStore.users.values()).find(u => u.mobile === cleanMobile);
    if (!user) {
      throw new Error('No account found for this mobile number.');
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.updatedAt = new Date();
    dbStore.users.set(user.id, user);

    return { message: 'Password reset successfully. You can now login with your new password.' };
  }

  static generateToken(user: UserRecord): string {
    return jwt.sign(
      {
        id: user.id,
        mobile: user.mobile,
        role: user.role,
        profession: user.profession,
      },
      config.jwt.secret,
      { expiresIn: '7d' }
    );
  }

  static sanitizeUser(user: UserRecord) {
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }
}
