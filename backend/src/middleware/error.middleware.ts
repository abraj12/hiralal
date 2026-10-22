import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

/**
 * Centralized Application Error Middleware
 * Safely sanitizes error payloads, redacts sensitive stack traces in production,
 * and attaches unique correlation request IDs for observability.
 */
export function errorHandler(
  err: any,
  req: Request & { requestId?: string },
  res: Response,
  _next: NextFunction
) {
  const correlationId = req.requestId || 'req-unknown';
  console.error(`[UNHANDLED ERROR] [${correlationId}] ${req.method} ${req.originalUrl}:`, err);

  const isMulterError = err.name === 'MulterError';
  const status = isMulterError ? 400 : (err.status || err.statusCode || 500);

  let message = err.message || 'Internal Server Error';
  if (isMulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'Uploaded file exceeds the maximum allowed size limit of 10MB.';
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      message = 'Too many files uploaded. Only 1 invoice document per bill submission is allowed.';
    } else {
      message = `File upload rejected: ${err.message}`;
    }
  } else if (config.isProduction && status >= 500) {
    message = `Internal server error. Reference ID: ${correlationId}`;
  }

  const code =
    err.code ||
    (status === 400
      ? 'BAD_REQUEST'
      : status === 401
      ? 'UNAUTHORIZED'
      : status === 403
      ? 'FORBIDDEN'
      : status === 404
      ? 'NOT_FOUND'
      : status === 409
      ? 'CONFLICT'
      : status === 429
      ? 'TOO_MANY_REQUESTS'
      : 'INTERNAL_SERVER_ERROR');

  res.status(status).json({
    success: false,
    code,
    message,
    requestId: correlationId,
  });
}
