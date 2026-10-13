import { Request, Response, NextFunction } from 'express';
import { PlayIntegrityService, IntegrityAction } from '../services/integrity/playIntegrity.service';
import { AuthenticatedRequest } from './auth.middleware';
import { computeIntegrityRequestHash } from '../utils/integrityRequestHash';

/**
 * Express middleware to enforce Google Play Integrity device attestation on protected actions.
 *
 * Requirements:
 * - Extracts `x-integrity-token` and `x-integrity-nonce` from headers (or body).
 * - When action enforcement is active (permanently mandatory in production and staging):
 *   - Rejects if token or nonce is missing (403 Forbidden, INTEGRITY_REQUIRED).
 *   - Computes canonical SHA-256 request hash from the server-received payload.
 *   - Atomically consumes the single-use nonce and verifies it is bound to the current user, session, action, and request hash.
 *   - Verifies the Google Play Integrity token against security rules.
 *   - Rejects if token is invalid, device is untrusted, or nonce was replayed/mismatched (403 Forbidden, INTEGRITY_FAILED).
 */
export function requireActionIntegrity(action: IntegrityAction) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const isEnforcing = PlayIntegrityService.isEnforcingActions();

    const integrityToken =
      (req.headers['x-integrity-token'] as string) ||
      (req.body?.integrityToken as string) ||
      '';

    const integrityNonce =
      (req.headers['x-integrity-nonce'] as string) ||
      (req.body?.integrityNonce as string) ||
      '';

    // In production or when enforcement is enabled: attestation is strictly required
    if (isEnforcing) {
      if (!integrityToken || !integrityNonce) {
        res.status(403).json({
          success: false,
          code: 'INTEGRITY_REQUIRED',
          message: 'Device integrity attestation is required for this action.',
        });
        return;
      }
    } else {
      // In development/test with enforcement disabled: if client didn't supply token/nonce, proceed
      if (!integrityToken && !integrityNonce) {
        next();
        return;
      }
    }

    // Compute canonical request hash from actual server-received request payload
    let requestHash: string;
    try {
      requestHash = computeIntegrityRequestHash(action, req);
    } catch (err: any) {
      res.status(403).json({
        success: false,
        code: 'INTEGRITY_FAILED',
        message: `Failed to compute request payload hash: ${err.message}`,
      });
      return;
    }

    // When token & nonce are supplied (or required): verify binding and attestation
    const user = (req as AuthenticatedRequest).user;
    const expectedContext = {
      userId: user?.id,
      sessionId: user?.activeSessionId ?? undefined,
      action,
      requestHash,
    };

    try {
      const verdict = await PlayIntegrityService.verifyActionToken({
        nonce: integrityNonce,
        integrityToken,
        expectedContext,
      });

      if (!verdict.success) {
        res.status(403).json({
          success: false,
          code: 'INTEGRITY_FAILED',
          message: verdict.error || 'Device integrity verification failed.',
          verdict,
        });
        return;
      }

      // Attach verified verdict to request for downstream audit logging
      (req as any).integrityVerdict = verdict;
      next();
    } catch (err: any) {
      res.status(403).json({
        success: false,
        code: 'INTEGRITY_ERROR',
        message: `Device integrity check error: ${err.message}`,
      });
    }
  };
}

/**
 * Express middleware to enforce Google Play Integrity device attestation on pre-authentication actions
 * (e.g. registration, password reset) where the caller is not yet authenticated with a user session.
 */
export function requirePreAuthActionIntegrity(action: IntegrityAction) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const isEnforcing = PlayIntegrityService.isEnforcingActions();

    const integrityToken =
      (req.headers['x-integrity-token'] as string) ||
      (req.body?.integrityToken as string) ||
      '';

    const integrityNonce =
      (req.headers['x-integrity-nonce'] as string) ||
      (req.body?.integrityNonce as string) ||
      '';

    // In production or when enforcement is enabled: attestation is strictly required
    if (isEnforcing) {
      if (!integrityToken || !integrityNonce) {
        res.status(403).json({
          success: false,
          code: 'INTEGRITY_REQUIRED',
          message: 'Device integrity attestation is required for this action.',
        });
        return;
      }
    } else {
      // In development/test with enforcement disabled: if client didn't supply token/nonce, proceed
      if (!integrityToken && !integrityNonce) {
        next();
        return;
      }
    }

    // Compute canonical request hash from actual server-received request payload
    let requestHash: string;
    try {
      requestHash = computeIntegrityRequestHash(action, req);
    } catch (err: any) {
      res.status(403).json({
        success: false,
        code: 'INTEGRITY_FAILED',
        message: `Failed to compute request payload hash: ${err.message}`,
      });
      return;
    }

    // Context binding for pre-auth action (no user or session bound)
    const expectedContext = {
      action,
      requestHash,
    };

    try {
      const verdict = await PlayIntegrityService.verifyActionToken({
        nonce: integrityNonce,
        integrityToken,
        expectedContext,
      });

      if (!verdict.success) {
        res.status(403).json({
          success: false,
          code: 'INTEGRITY_FAILED',
          message: verdict.error || 'Device integrity verification failed.',
          verdict,
        });
        return;
      }

      // Attach verified verdict to request for downstream audit logging
      (req as any).integrityVerdict = verdict;
      next();
    } catch (err: any) {
      res.status(403).json({
        success: false,
        code: 'INTEGRITY_ERROR',
        message: `Device integrity check error: ${err.message}`,
      });
    }
  };
}
