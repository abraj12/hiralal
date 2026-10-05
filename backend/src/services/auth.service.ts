import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { prisma } from '../db';
import { Profession } from '@prisma/client';

export class AuthService {
  /**
   * Hashes OTP combined with mobile to prevent rainbow table attacks.
   */
  private static hashOtp(mobile: string, otpCode: string): string {
    return crypto
      .createHash('sha256')
      .update(`${mobile}:${otpCode}:${config.jwt.secret}`)
      .digest('hex');
  }

  /**
   * Sends real cryptographic OTP to mobile number with rate limiting and cooldown.
   */
  static async sendOtp(
    mobile: string,
    purpose: 'REGISTRATION' | 'FORGOT_PASSWORD' | 'LOGIN'
  ): Promise<{ message: string; cooldownSeconds: number }> {
    const cleanMobile = mobile.replace(/\D/g, '').slice(-10);
    if (cleanMobile.length !== 10) {
      throw new Error('Please enter a valid 10-digit Indian mobile number.');
    }

    const now = new Date();

    // Check cooldown (60 seconds)
    const latestOtp = await prisma.otpRequest.findFirst({
      where: { mobile: cleanMobile },
      orderBy: { createdAt: 'desc' },
    });

    if (latestOtp && latestOtp.cooldownUntil && latestOtp.cooldownUntil > now) {
      const waitSeconds = Math.ceil((latestOtp.cooldownUntil.getTime() - now.getTime()) / 1000);
      throw new Error(`Please wait ${waitSeconds} seconds before requesting a new OTP.`);
    }

    // Rate limit: max 5 requests per 10 minutes
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const recentCount = await prisma.otpRequest.count({
      where: {
        mobile: cleanMobile,
        createdAt: { gte: tenMinutesAgo },
      },
    });

    if (recentCount >= 5) {
      throw new Error('Too many OTP requests. Please wait 10 minutes before requesting again.');
    }

    // Generate cryptographically random 6-digit numeric code
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const otpHash = this.hashOtp(cleanMobile, otpCode);
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 min expiry
    const cooldownUntil = new Date(now.getTime() + 60 * 1000); // 60s cooldown

    await prisma.otpRequest.create({
      data: {
        mobile: cleanMobile,
        otpHash,
        purpose,
        expiresAt,
        cooldownUntil,
      },
    });

    // Dispatch via configured SMS gateway
    if (config.sms.apiKey && config.sms.provider === 'FAST2SMS') {
      try {
        await fetch('https://www.fast2sms.com/dev/bulkV2', {
          method: 'POST',
          headers: {
            authorization: config.sms.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            route: 'otp',
            variables_values: otpCode,
            numbers: cleanMobile,
          }),
        });
      } catch (smsErr) {
        console.error('Failed to dispatch SMS via Fast2SMS gateway:', smsErr);
      }
    } else {
      // In local development / test without external SMS credits, print to secure terminal log
      if (config.nodeEnv !== 'production') {
        console.log(`[SMS-DISPATCH-SECURE] Verification code for ${cleanMobile}: ${otpCode}`);
      }
    }

    return {
      message: `OTP sent successfully to +91 ${cleanMobile}`,
      cooldownSeconds: 60,
    };
  }

  /**
   * Verifies submitted OTP against salted hash.
   */
  static async verifyOtp(
    mobile: string,
    otpCode: string,
    purpose: 'REGISTRATION' | 'FORGOT_PASSWORD' | 'LOGIN'
  ): Promise<boolean> {
    const cleanMobile = mobile.replace(/\D/g, '').slice(-10);
    const now = new Date();

    const otpRecord = await prisma.otpRequest.findFirst({
      where: {
        mobile: cleanMobile,
        purpose,
        isUsed: false,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new Error('No valid OTP found or OTP has expired. Please request a new one.');
    }

    if (otpRecord.attemptsCount >= 3) {
      await prisma.otpRequest.update({
        where: { id: otpRecord.id },
        data: { isUsed: true },
      });
      throw new Error('Maximum verification attempts exceeded. Please request a new OTP.');
    }

    const expectedHash = this.hashOtp(cleanMobile, otpCode);
    const isValid = crypto.timingSafeEqual(Buffer.from(otpRecord.otpHash), Buffer.from(expectedHash));

    if (!isValid) {
      await prisma.otpRequest.update({
        where: { id: otpRecord.id },
        data: { attemptsCount: { increment: 1 } },
      });
      throw new Error('Invalid OTP. Please check the code and try again.');
    }

    // Mark OTP as used
    await prisma.otpRequest.update({
      where: { id: otpRecord.id },
      data: { isUsed: true },
    });

    return true;
  }

  /**
   * Registers a new user with strictly PLUMBER or TILE_INSTALLER profession.
   */
  static async registerUser(data: {
    mobile: string;
    fullName: string;
    password: string;
    profession: 'PLUMBER' | 'TILE_INSTALLER';
    otpCode: string;
  }): Promise<{ user: any; token: string; refreshToken: string }> {
    const cleanMobile = data.mobile.replace(/\D/g, '').slice(-10);

    // Verify OTP first
    await this.verifyOtp(cleanMobile, data.otpCode, 'REGISTRATION');

    // Validate Profession strictly
    if (data.profession !== 'PLUMBER' && data.profession !== 'TILE_INSTALLER') {
      throw new Error('Profession must strictly be PLUMBER or TILE_INSTALLER.');
    }

    // Check if mobile already exists
    const existing = await prisma.user.findUnique({
      where: { mobile: cleanMobile },
    });

    if (existing) {
      throw new Error('An account with this mobile number already exists. Please log in.');
    }

    if (!data.password || data.password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    // Transactionally create user and their wallet
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          mobile: cleanMobile,
          fullName: data.fullName.trim(),
          passwordHash,
          profession: data.profession as Profession,
          role: 'USER',
          status: 'ACTIVE',
          isVerified: true,
        },
      });

      await tx.wallet.create({
        data: {
          userId: newUser.id,
          availableBalance: 0.0,
          processingAmount: 0.0,
          totalRedeemed: 0.0,
        },
      });

      return newUser;
    });

    const token = this.generateToken(user);
    const refreshToken = this.generateRefreshToken(user);

    return {
      user: {
        id: user.id,
        mobile: user.mobile,
        fullName: user.fullName,
        profession: user.profession,
        role: user.role,
        isVerified: user.isVerified,
      },
      token,
      refreshToken,
    };
  }

  /**
   * Authenticates user via mobile & password.
   */
  static async login(
    mobile: string,
    password: string
  ): Promise<{ user: any; wallet: any; token: string; refreshToken: string }> {
    const cleanMobile = mobile.replace(/\D/g, '').slice(-10);

    const user = await prisma.user.findUnique({
      where: { mobile: cleanMobile },
      include: { wallet: true },
    });

    if (!user) {
      throw new Error('Invalid mobile number or password.');
    }

    if (user.status === 'SUSPENDED') {
      throw new Error('Your account has been suspended. Please contact Hiralal & Sons administration.');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new Error('Invalid mobile number or password.');
    }

    // Ensure wallet exists
    let wallet = user.wallet;
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: {
          userId: user.id,
          availableBalance: 0.0,
          processingAmount: 0.0,
          totalRedeemed: 0.0,
        },
      });
    }

    const token = this.generateToken(user);
    const refreshToken = this.generateRefreshToken(user);

    return {
      user: {
        id: user.id,
        mobile: user.mobile,
        fullName: user.fullName,
        profession: user.profession,
        role: user.role,
        isVerified: user.isVerified,
      },
      wallet: {
        availableBalance: Number(wallet.availableBalance),
        processingAmount: Number(wallet.processingAmount),
        totalRedeemed: Number(wallet.totalRedeemed),
      },
      token,
      refreshToken,
    };
  }

  /**
   * Refreshes expired JWT session.
   */
  static async refreshSession(refreshToken: string): Promise<{ token: string }> {
    try {
      const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as any;
      const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

      if (!user || user.status === 'SUSPENDED') {
        throw new Error('User account not found or suspended.');
      }

      const newToken = this.generateToken(user);
      return { token: newToken };
    } catch {
      throw new Error('Invalid or expired refresh token. Please log in again.');
    }
  }

  private static generateToken(user: any): string {
    return jwt.sign(
      {
        userId: user.id,
        mobile: user.mobile,
        role: user.role,
        profession: user.profession,
      },
      config.jwt.secret,
      { expiresIn: '7d' }
    );
  }

  private static generateRefreshToken(user: any): string {
    return jwt.sign(
      {
        userId: user.id,
      },
      config.jwt.refreshSecret,
      { expiresIn: '30d' }
    );
  }
}
