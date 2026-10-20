import { Router, Request, Response } from 'express';
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: safeInitialMaxUploadMb * 1024 * 1024,
    files: 1, // Only 1 file per upload
    fieldNameSize: 100, // Max 100 characters for field names
    fieldSize: 64 * 1024, // 64KB per field
    parts: 15, // Max 15 parts total
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
  requirePreStreamIntegrityHeaders('BILL_UPLOAD'),
  upload.single('invoiceFile'),
  requireActionIntegrity('BILL_UPLOAD'),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { invoiceNumber, invoiceDate, billAmount, remarks } = req.body;

    if (!invoiceNumber || typeof invoiceNumber !== 'string' || !invoiceNumber.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A valid invoice number is required.',
      });
    }

    const cleanInvoiceNumber = invoiceNumber.trim();
    if (cleanInvoiceNumber.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Invoice number cannot exceed 100 characters.',
      });
    }

    if (!invoiceDate || typeof invoiceDate !== 'string' || !invoiceDate.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A valid invoice date is required.',
      });
    }

    let parsedDate: Date;
    try {
      parsedDate = parseIndiaBusinessDate(invoiceDate.trim());
    } catch (err: any) {
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
      return res.status(400).json({
        success: false,
        message: 'Invoice date cannot be in the future.',
      });
    }
    if (parsedDate < fiveYearsAgo) {
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
      return res.status(400).json({
        success: false,
        message: 'Valid bill amount greater than zero with at most two decimal places is required.',
      });
    }

    const parsedAmount = Number(amountText);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Bill amount must be a finite positive number greater than zero.',
      });
    }

    const rawMaxBillAmount = parseFloat(process.env.BILL_MAX_AMOUNT || '50000000');
    const maxBillAmount = Number.isFinite(rawMaxBillAmount) && rawMaxBillAmount > 0 ? rawMaxBillAmount : 50000000;
    if (parsedAmount > maxBillAmount) {
      return res.status(400).json({
        success: false,
        message: 'Bill amount exceeds maximum permitted single invoice limit.',
      });
    }

    if (remarks && (typeof remarks !== 'string' || remarks.length > 500)) {
      return res.status(400).json({
        success: false,
        message: 'Remarks cannot exceed 500 characters.',
      });
    }

    const rawMaxUploadMb = parseInt(process.env.BILL_MAX_UPLOAD_SIZE_MB || '10', 10);
    const maxUploadMb = Number.isFinite(rawMaxUploadMb) && rawMaxUploadMb > 0 ? rawMaxUploadMb : 10;
    const maxUploadBytes = maxUploadMb * 1024 * 1024;

    let fileBuffer: Buffer;
    let fileName: string;
    let mimeType: string;

    if (req.file) {
      fileBuffer = req.file.buffer;
      fileName = req.file.originalname;
      mimeType = req.file.mimetype;
    } else if (req.body.fileBase64 && typeof req.body.fileBase64 === 'string') {
      try {
        fileBuffer = Buffer.from(req.body.fileBase64, 'base64');
        if (fileBuffer.length === 0 || fileBuffer.length > maxUploadBytes) {
          return res.status(400).json({
            success: false,
            message: `Invoice file size must be between 1 byte and ${maxUploadMb}MB.`,
          });
        }
      } catch (e) {
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

    const bill = await BillService.submitBill({
      userId: user.id,
      invoiceNumber: cleanInvoiceNumber,
      invoiceDate: invoiceDate.trim(),
      billAmount: parsedAmount,
      fileBuffer,
      fileName,
      mimeType,
      remarks: remarks?.trim() || undefined,
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
        calculatedReward: null,
        message: 'Awaiting administrator verification.',
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * Get User's bills
 */
router.get('/', authenticate, requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const statusQuery = req.query.status as string;
    const status = statusQuery && statusQuery !== 'ALL' ? (statusQuery as BillStatus) : undefined;
    const bills = await BillService.getUserBills(user.id, status);
    res.json({ success: true, bills });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
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

    // Authorization: verify the file key belongs to the authenticated user or requester is BILL_ADMIN.
    // Key format: bills/{userId}/{billId}/{filename}
    const keyParts = key.split('/');
    const isOwner = keyParts[0] === 'bills' && keyParts[1] === user.id;
    const isBillAdmin = user.role === 'BILL_ADMIN';

    if (keyParts[0] !== 'bills' || (!isOwner && !isBillAdmin)) {
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
      return stream.pipe(res);
    }

    res.status(404).json({ success: false, message: 'Document file not found in storage.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
