import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../db';
import { User, UserRole } from '@prisma/client';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
    return;
  }

  const token = authHeader.split(' ')[1];
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

export const requireAdmin = requireRole(['ADMIN', 'BILL_ADMIN', 'OPERATIONS_ADMIN']);
export const requireBillAdmin = requireRole(['BILL_ADMIN', 'ADMIN']);
export const requireOperationsAdmin = requireRole(['OPERATIONS_ADMIN', 'ADMIN']);
