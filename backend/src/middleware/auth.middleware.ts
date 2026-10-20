import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../db';
import { User, UserRole } from '@prisma/client';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

export function csrfTokensMatch(
  cookieToken: unknown,
  headerToken: unknown
): boolean {
  if (
    typeof cookieToken !== 'string' ||
    typeof headerToken !== 'string' ||
    cookieToken.length === 0 ||
    headerToken.length === 0
  ) {
    return false;
  }

  const cookieBuffer = Buffer.from(cookieToken, 'utf8');
  const headerBuffer = Buffer.from(headerToken, 'utf8');

  if (cookieBuffer.length !== headerBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(cookieBuffer, headerBuffer);
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      try {
        list[name] = decodeURIComponent(val);
      } catch {
        list[name] = val;
      }
    }
  });
  return list;
}

function isExactAllowedOrigin(
  originOrUrl: string | undefined,
  allowedOrigins: string[],
  isProduction: boolean
): boolean {
  if (!originOrUrl) return false;

  try {
    const parsed = new URL(originOrUrl);

    // Compare the canonical origin, not a string prefix.
    const isMatch = allowedOrigins.some((allowed) => {
      try {
        return new URL(allowed).origin === parsed.origin;
      } catch {
        return false;
      }
    });

    if (isMatch) return true;

    if (!isProduction && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  let token: string | undefined;
  let isCookieAuth = false;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else {
    const cookies = (req as any).cookies || parseCookies(req.headers.cookie);
    if (cookies && cookies.admin_access_token) {
      token = cookies.admin_access_token;
      isCookieAuth = true;
    }
  }

  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
    return;
  }

  // Enforce strict CSRF / Origin validation for cookie-based authentication on mutating requests
  if (isCookieAuth && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = (req.headers.origin as string) || '';
    const referer = (req.headers.referer as string) || '';

    const validOrigin =
      isExactAllowedOrigin(origin, config.cors.allowedOrigins, config.isProduction) ||
      (!origin && isExactAllowedOrigin(referer, config.cors.allowedOrigins, config.isProduction));

    if (!validOrigin) {
      res.status(403).json({
        success: false,
        code: 'CSRF_VALIDATION_FAILED',
        message: 'CSRF / Origin validation failed for cookie-authenticated request.',
      });
      return;
    }

    const cookies =
      (req as any).cookies || parseCookies(req.headers.cookie);

    const csrfCookie =
      typeof cookies?.csrf_token === 'string'
        ? cookies.csrf_token
        : '';

    const csrfHeader =
      typeof req.headers['x-csrf-token'] === 'string'
        ? req.headers['x-csrf-token']
        : '';

    if (!csrfTokensMatch(csrfCookie, csrfHeader)) {
      res.status(403).json({
        success: false,
        code: 'CSRF_TOKEN_MISMATCH',
        message:
          'Anti-CSRF validation failed. Refresh the session and retry.',
      });
      return;
    }
  }
  try {
    let decoded: any;
    let verifiedWithAdminSecret = false;
    try {
      decoded = jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] }) as any;
    } catch (primaryErr) {
      if (config.admin.accessSecret && config.admin.accessSecret !== config.jwt.accessSecret) {
        try {
          decoded = jwt.verify(token, config.admin.accessSecret, { algorithms: ['HS256'] }) as any;
          verifiedWithAdminSecret = true;
        } catch {
          res.status(401).json({ success: false, message: 'Invalid or expired token.' });
          return;
        }
      } else {
        res.status(401).json({ success: false, message: 'Invalid or expired token.' });
        return;
      }
    }

    const targetId = decoded.userId || decoded.id;

    if (!targetId) {
      res.status(401).json({ success: false, message: 'Invalid token payload.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: targetId },
    });

    if (!user) {
      res.status(401).json({ success: false, message: 'User not found or session revoked.' });
      return;
    }

    // Cryptographic Key-to-Role Binding (Finding C-01)
    const hasDistinctAdminKey = Boolean(
      config.admin.accessSecret && config.admin.accessSecret !== config.jwt.accessSecret
    );
    const isAdminRole = user.role === 'BILL_ADMIN' || user.role === 'OPERATIONS_ADMIN';
    if (hasDistinctAdminKey) {
      if (isAdminRole && !verifiedWithAdminSecret) {
        res.status(401).json({
          success: false,
          code: 'KEY_ROLE_MISMATCH',
          message: 'Administrative access requires a token signed with the administrative key.',
        });
        return;
      }
      if (!isAdminRole && verifiedWithAdminSecret) {
        res.status(401).json({
          success: false,
          code: 'KEY_ROLE_MISMATCH',
          message: 'User access requires a token signed with the user key.',
        });
        return;
      }
    }

    if (user.status !== 'ACTIVE') {
      res.status(403).json({ success: false, message: 'Account is suspended. Please contact Hiralal & Sons administration.' });
      return;
    }

    // Enforce sessionId presence and single-active-session validation (SEC-MED-02)
    // All operational environments (production, staging, dev) must require sessionId
    const isTest = config.nodeEnv === 'test';
    const isSessionIdRequired = !isTest || req.headers['x-enforce-session'] === 'true';

    if (!decoded.sessionId) {
      if (isSessionIdRequired) {
        res.status(401).json({
          success: false,
          message: 'Invalid token payload. Session identifier is required.',
        });
        return;
      }
    } else {
      // Single active session validation
      if (!user.activeSessionId || decoded.sessionId !== user.activeSessionId) {
        res.status(401).json({ success: false, message: 'Session expired or invalidated by a newer login or logout.' });
        return;
      }

      // Verify that the session has not been explicitly revoked in AuthSession
      const session = await prisma.authSession.findFirst({
        where: {
          userId: user.id,
          sessionId: decoded.sessionId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      if (!session) {
        res.status(401).json({ success: false, message: 'Session has been revoked or expired.' });
        return;
      }
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required.' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to access this resource.',
      });
      return;
    }

    next();
  };
}

export const requireAdmin = requireRole(['BILL_ADMIN', 'OPERATIONS_ADMIN']);
export const requireBillAdmin = requireRole(['BILL_ADMIN']);
export const requireOperationsAdmin = requireRole(['OPERATIONS_ADMIN']);
export const requireUser = requireRole(['USER']);
