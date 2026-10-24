import express, { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { BillService } from '../services/bill.service';
import { StorageService } from '../services/storage.service';
import { authenticate, requireUser, AuthenticatedRequest } from '../middleware/auth.middleware';
import { BillStatus } from '@prisma/client';
import { parseIndiaBusinessDate } from '../utils/timezone.utils';
import { requireActionIntegrity, requirePreStreamIntegrityHeaders } from '../middleware/integrity.middleware';
import { billUploadLimiter } from '../middleware/rateLimit.middleware';

const router = Router();
const initialMaxUploadMb = parseInt(process.env.BILL_MAX_UPLOAD_SIZE_MB || '10', 10);
const safeInitialMaxUploadMb = Number.isFinite(initialMaxUploadMb) && initialMaxUploadMb > 0 ? initialMaxUploadMb : 10;

const uploadDir = path.join(process.cwd(), 'uploads', 'tmp');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function cleanupUploadedFile(req: Request): void {
  const file = (req as any).file;
  if (file?.path && typeof file.path === 'string') {
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (_) {}
  }
  const files = (req as any).files;
  if (Array.isArray(files)) {
    for (const f of files) {
      if (f?.path && typeof f.path === 'string') {
        try {
          if (fs.existsSync(f.path)) {
            fs.unlinkSync(f.path);
          }
        } catch (_) {}
      }
    }
  }
}

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: diskStorage,
  limits: {
    fileSize: safeInitialMaxUploadMb * 1024 * 1024,
    files: 1, // Only 1 file per upload
    fieldNameSize: 100, // Max 100 characters for field names
    fieldSize: 64 * 1024, // 64KB per field
    parts: 15, // Max 15 parts total
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid document type. Only JPEG, PNG, WEBP, and PDF documents are allowed.'));
    }
  },
});

/**
 * Upload Bill Invoice
 */
router.post(
  '/',
  authenticate,
  requireUser,
  billUploadLimiter,
  express.json({ limit: process.env.JSON_BODY_LIMIT || '500kb' }),
  requirePreStreamIntegrityHeaders('BILL_UPLOAD'),
  upload.single('invoiceFile'),
  requireActionIntegrity('BILL_UPLOAD'),
  async (req: AuthenticatedRequest, res: Response) => {
  let fileBuffer: Buffer | null = null;
  try {
    const user = req.user!;
    const { invoiceNumber, invoiceDate, billAmount, remarks } = req.body;

    if (!invoiceNumber || typeof invoiceNumber !== 'string' || !invoiceNumber.trim()) {
      cleanupUploadedFile(req);
      return res.status(400).json({
        success: false,
        message: 'A valid invoice number is required.',
      });
    }

    const cleanInvoiceNumber = invoiceNumber.trim();
    if (cleanInvoiceNumber.length > 100) {
      cleanupUploadedFile(req);
      return res.status(400).json({
        success: false,
        message: 'Invoice number cannot exceed 100 characters.',
      });
    }

    if (!invoiceDate || typeof invoiceDate !== 'string' || !invoiceDate.trim()) {
      cleanupUploadedFile(req);
      return res.status(400).json({
        success: false,
        message: 'A valid invoice date is required.',
      });
    }

    let parsedDate: Date;
    try {
      parsedDate = parseIndiaBusinessDate(invoiceDate.trim());
    } catch (err: any) {
      cleanupUploadedFile(req);
      return res.status(400).json({
        success: false,
        message: err.message || 'Invoice date is invalid. Please supply a valid date (YYYY-MM-DD).',
      });
    }

    // Invoice date should not be more than 1 day in the future (India calendar) or older than 5 years
    const todayIndia = parseIndiaBusinessDate();
    const tomorrowIndia = new Date(todayIndia.getTime() + 24 * 60 * 60 * 1000);
    const fiveYearsAgo = new Date(todayIndia.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);
    if (parsedDate > tomorrowIndia) {
      cleanupUploadedFile(req);
      return res.status(400).json({
        success: false,
        message: 'Invoice date cannot be in the future.',
      });
    }
    if (parsedDate < fiveYearsAgo) {
      cleanupUploadedFile(req);
      return res.status(400).json({
        success: false,
        message: 'Invoice date is too old to be eligible for rewards.',
      });
    }

    const amountText =
      typeof billAmount === 'number'
        ? String(billAmount)
        : typeof billAmount === 'string'
          ? billAmount.trim()
          : '';

    if (!amountText || !/^\d+(?:\.\d{1,2})?$/.test(amountText)) {
      cleanupUploadedFile(req);
      return res.status(400).json({
        success: false,
        message: 'Valid bill amount greater than zero with at most two decimal places is required.',
      });
    }

    const parsedAmount = Number(amountText);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 1.00) {
      cleanupUploadedFile(req);
      return res.status(400).json({
        success: false,
        message: 'Minimum invoice amount is ₹1.00.',
      });
    }

    const rawMaxBillAmount = parseFloat(process.env.BILL_MAX_AMOUNT || '50000000');
    const maxBillAmount = Number.isFinite(rawMaxBillAmount) && rawMaxBillAmount > 0 ? rawMaxBillAmount : 50000000;
    if (parsedAmount > maxBillAmount) {
      cleanupUploadedFile(req);
      return res.status(400).json({
        success: false,
        message: 'Bill amount exceeds maximum permitted single invoice limit.',
      });
    }

    if (remarks && (typeof remarks !== 'string' || remarks.length > 500)) {
      cleanupUploadedFile(req);
      return res.status(400).json({
        success: false,
        message: 'Remarks cannot exceed 500 characters.',
      });
    }

    const rawMaxUploadMb = parseInt(process.env.BILL_MAX_UPLOAD_SIZE_MB || '10', 10);
    const maxUploadMb = Number.isFinite(rawMaxUploadMb) && rawMaxUploadMb > 0 ? rawMaxUploadMb : 10;
    const maxUploadBytes = maxUploadMb * 1024 * 1024;

    let fileName: string;
    let mimeType: string;

    if (req.file) {
      const tempPath = (req.file as any).path;
      if (tempPath && typeof tempPath === 'string') {
        try {
          fileBuffer = await fs.promises.readFile(tempPath);
        } finally {
          // PERF-RES-01: Immediately unlink temporary disk upload upon read completion or failure
          try {
            if (fs.existsSync(tempPath)) {
              await fs.promises.unlink(tempPath);
            }
          } catch (_) {}
        }
      } else if (req.file.buffer) {
        fileBuffer = req.file.buffer;
        // Release multer memory buffer reference immediately
        (req.file as any).buffer = null;
      } else {
        return res.status(400).json({
          success: false,
          message: 'A real invoice file document (PDF, JPG, PNG) must be attached to submit a bill.',
        });
      }
      fileName = req.file.originalname;
      mimeType = req.file.mimetype;
    } else if (req.body.fileBase64 && typeof req.body.fileBase64 === 'string') {
      try {
        fileBuffer = Buffer.from(req.body.fileBase64, 'base64');
        // PERF-RES-01: Immediately release base64 string from req.body to reclaim V8 heap memory (~13MB)
        req.body.fileBase64 = undefined;
        if (fileBuffer.length === 0 || fileBuffer.length > maxUploadBytes) {
          return res.status(400).json({
            success: false,
            message: `Invoice file size must be between 1 byte and ${maxUploadMb}MB.`,
          });
        }
      } catch (e) {
        req.body.fileBase64 = undefined;
        return res.status(400).json({
          success: false,
          message: 'Invalid base64 file encoding.',
        });
      }
      fileName = req.body.fileName || 'invoice.jpg';
      // Do NOT trust the client-supplied mimeType; the server will derive it from magic bytes
      // during StorageService.validateAndHashFile() inside BillService.submitBill() (F-10).
      mimeType = req.body.mimeType || 'application/octet-stream';
    } else {
      return res.status(400).json({
        success: false,
        message: 'A real invoice file document (PDF, JPG, PNG) must be attached to submit a bill.',
      });
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invoice document is empty.',
      });
    }

    const bill = await BillService.submitBill({
      userId: user.id,
      invoiceNumber: cleanInvoiceNumber,
      invoiceDate: invoiceDate.trim(),
      billAmount: parsedAmount,
      fileBuffer,
      fileName,
      mimeType,
      remarks: remarks?.trim() || undefined,
      parentBillId: req.body.parentBillId ? String(req.body.parentBillId).trim() : undefined,
      vendorGstin: req.body.vendorGstin ? String(req.body.vendorGstin).trim() : undefined,
      merchantName: req.body.merchantName ? String(req.body.merchantName).trim() : undefined,
    });

    res.status(201).json({
      success: true,
      message: 'Bill uploaded successfully and submitted for administrator verification.',
      bill: {
        id: bill.id,
        invoiceNumber: bill.invoiceNumber,
        invoiceDate: bill.invoiceDate,
        billAmount: Number(bill.billAmount),
        status: bill.status,
        revisionNumber: bill.revisionNumber,
        parentBillId: bill.parentBillId,
        requiresSecondaryApproval: bill.requiresSecondaryApproval,
        calculatedReward: null,
        message: bill.requiresSecondaryApproval
          ? 'Awaiting Operations Administrator secondary verification.'
          : 'Awaiting administrator verification.',
      },
    });
  } catch (err: any) {
    cleanupUploadedFile(req);
    const sanitizedMsg = (err?.message || '').includes('Unique constraint failed')
      ? 'This invoice record already exists.'
      : (err?.message || '').includes('Foreign key constraint failed')
      ? 'Invalid reference provided.'
      : err?.message || 'Invoice submission failed.';
    res.status(400).json({ success: false, message: sanitizedMsg });
  } finally {
    // PERF-RES-01: Guaranteed cleanup on all execution exits (success, validation error, unhandled rejection)
    cleanupUploadedFile(req);
    if (fileBuffer) {
      try {
        fileBuffer.fill(0);
      } catch (_) {}
      fileBuffer = null;
    }
    if (req.file) {
      if ((req.file as any).buffer) {
        try {
          (req.file as any).buffer.fill(0);
        } catch (_) {}
        (req.file as any).buffer = null;
      }
    }
    if (req.body && req.body.fileBase64) {
      req.body.fileBase64 = undefined;
    }
  }
});

/**
 * Get User's bills
 */
router.get('/', authenticate, requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const statusQuery = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;
    const ALLOWED_BILL_STATUSES: BillStatus[] = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DUPLICATE', 'CANCELLED'];
    const status = statusQuery && statusQuery !== 'ALL' && ALLOWED_BILL_STATUSES.includes(statusQuery as BillStatus)
      ? (statusQuery as BillStatus)
      : undefined;
    const bills = await BillService.getUserBills(user.id, status);
    res.json({ success: true, bills });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve bills. Please try again later.' });
  }
});

/**
 * Secure signed URL document retrieval.
 * Requires authentication and validates that the file key belongs to the requesting user or BILL_ADMIN.
 */
router.get('/file', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const key = req.query.key as string;
    const expires = parseInt(req.query.expires as string, 10);
    const sig = req.query.sig as string;

    if (!key || isNaN(expires) || !sig) {
      return res.status(400).json({ success: false, message: 'Invalid signed URL parameters.' });
    }

    // Authorization: verify the file key belongs to the authenticated user or requester is an administrator (BILL_ADMIN or OPERATIONS_ADMIN).
    // Key format: bills/{userId}/{billId}/{filename}
    const keyParts = key.split('/');
    const isOwner = keyParts[0] === 'bills' && keyParts[1] === user.id;
    const isAdmin = user.role === 'BILL_ADMIN' || user.role === 'OPERATIONS_ADMIN';

    if (keyParts[0] !== 'bills' || (!isOwner && !isAdmin)) {
      return res.status(403).json({ success: false, message: 'Access denied: document does not belong to your account.' });
    }

    const isValid = StorageService.verifySignedUrl(key, expires, sig);
    if (!isValid) {
      return res.status(403).json({ success: false, message: 'Signed URL has expired or signature is invalid.' });
    }

    // Set private, no-cache headers to prevent intermediate caching of sensitive documents
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    // SEC-CRIT-01: Isolate previewed bill documents in restricted sandbox to prevent Stored XSS
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox; frame-ancestors 'self';");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    // Extension inspection for safe content-type and inline disposition
    const ext = path.extname(key).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    };
    if (mimeMap[ext]) {
      res.setHeader('Content-Type', mimeMap[ext]);
      res.setHeader('Content-Disposition', `inline; filename="invoice${ext}"`);
    }

    const localPath = StorageService.getLocalFilePath(key);
    if (fs.existsSync(localPath)) {
      return res.sendFile(localPath);
    }

    const provider = StorageService.getProvider();
    if (await provider.exists(key)) {
      const stream = await provider.getStream(key);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: 'Failed to stream document file.' });
        }
      });
      // PERF-RES-01: Abort stream promptly on client disconnect to prevent buffer leak
      req.on('close', () => {
        if (!stream.destroyed) {
          stream.destroy();
        }
      });
      return stream.pipe(res);
    }

    res.status(404).json({ success: false, message: 'Document file not found in storage.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve bills. Please try again later.' });
  }
});

export default router;
