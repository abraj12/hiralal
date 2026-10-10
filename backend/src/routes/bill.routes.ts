import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import { BillService } from '../services/bill.service';
import { StorageService } from '../services/storage.service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { BillStatus } from '@prisma/client';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB file limit
    files: 1, // Only 1 file per upload
    fields: 10, // Max 10 text fields
    fieldSize: 64 * 1024, // 64KB per field
    parts: 15, // Max 15 parts total
  },
});

/**
 * Upload Bill Invoice
 */
router.post('/', authenticate, upload.single('invoiceFile'), async (req: AuthenticatedRequest, res: Response) => {
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

    const parsedDate = new Date(invoiceDate.trim());
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invoice date is invalid. Please supply a valid date (YYYY-MM-DD).',
      });
    }

    // Invoice date should not be more than 1 day in the future or older than 5 years
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const fiveYearsAgo = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000);
    if (parsedDate > tomorrow) {
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

    if (parsedAmount > 50000000) { // ₹5,00,00,000 ceiling
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
        if (fileBuffer.length === 0 || fileBuffer.length > 10 * 1024 * 1024) {
          return res.status(400).json({
            success: false,
            message: 'Invoice file size must be between 1 byte and 10MB.',
          });
        }
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: 'Invalid base64 file encoding.',
        });
      }
      fileName = req.body.fileName || 'invoice.jpg';
      mimeType = req.body.mimeType || 'image/jpeg';
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
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
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
 * Secure signed URL document retrieval
 */
router.get('/file', async (req: Request, res: Response) => {
  try {
    const key = req.query.key as string;
    const expires = parseInt(req.query.expires as string, 10);
    const sig = req.query.sig as string;

    if (!key || isNaN(expires) || !sig) {
      return res.status(400).json({ success: false, message: 'Invalid signed URL parameters.' });
    }

    const isValid = StorageService.verifySignedUrl(key, expires, sig);
    if (!isValid) {
      return res.status(403).json({ success: false, message: 'Signed URL has expired or signature is invalid.' });
    }

    const localPath = StorageService.getLocalFilePath(key);
    if (fs.existsSync(localPath)) {
      return res.sendFile(localPath);
    }

    const provider = StorageService.getProvider();
    if (await provider.exists(key)) {
      const stream = await provider.getStream(key);
      return stream.pipe(res);
    }

    res.status(404).json({ success: false, message: 'Document file not found in storage.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
