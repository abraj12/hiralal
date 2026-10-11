import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../db';
import { User, UserRole } from '@prisma/client';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      list[name] = decodeURIComponent(val);
    }
  });
  return list;
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

  // Enforce CSRF / Origin validation for cookie-based authentication on mutating requests
  if (isCookieAuth && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = (req.headers.origin as string) || '';
    const referer = (req.headers.referer as string) || '';
    const csrfHeader = (req.headers['x-csrf-token'] as string) || (req.headers['x-requested-with'] as string);

    const isOriginAllowed = origin && config.cors.allowedOrigins.some((allowed) => origin.startsWith(allowed));
    const isRefererAllowed = referer && config.cors.allowedOrigins.some((allowed) => referer.startsWith(allowed));
    const isLocalDev =
      !config.isProduction &&
      (origin.includes('localhost') || origin.includes('127.0.0.1') || referer.includes('localhost') || referer.includes('127.0.0.1'));

    if (!isOriginAllowed && !isRefererAllowed && !isLocalDev && !csrfHeader) {
      res.status(403).json({
        success: false,
        code: 'CSRF_VALIDATION_FAILED',
        message: 'CSRF / Origin validation failed for cookie-authenticated request.',
      });
      return;
    }
  }
  try {
    let decoded: any;
    try {
      decoded = jwt.verify(token, config.jwt.accessSecret) as any;
    } catch (primaryErr) {
      if (config.admin.accessSecret && config.admin.accessSecret !== config.jwt.accessSecret) {
        try {
          decoded = jwt.verify(token, config.admin.accessSecret) as any;
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

    if (user.status !== 'ACTIVE') {
      res.status(403).json({ success: false, message: 'Account is suspended. Please contact Hiralal & Sons administration.' });
      return;
    }

    // Single active session validation
    if (decoded.sessionId && user.activeSessionId && decoded.sessionId !== user.activeSessionId) {
      res.status(401).json({ success: false, message: 'Session expired or invalidated by a newer login.' });
      return;
    }

    // If token has a sessionId, verify that the session has not been explicitly revoked in AuthSession
    if (decoded.sessionId) {
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
