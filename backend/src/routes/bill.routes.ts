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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

/**
 * Upload Bill Invoice
 */
router.post('/', authenticate, upload.single('invoiceFile'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { invoiceNumber, invoiceDate, billAmount, remarks } = req.body;

    if (!invoiceNumber || !invoiceDate || !billAmount) {
      return res.status(400).json({
        success: false,
        message: 'Invoice number, invoice date, and bill amount are required.',
      });
    }

    const parsedAmount = parseFloat(billAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid bill amount greater than zero is required.' });
    }

    let fileBuffer: Buffer;
    let fileName: string;
    let mimeType: string;

    if (req.file) {
      fileBuffer = req.file.buffer;
      fileName = req.file.originalname;
      mimeType = req.file.mimetype;
    } else if (req.body.fileBase64) {
      fileBuffer = Buffer.from(req.body.fileBase64, 'base64');
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
      invoiceNumber,
      invoiceDate,
      billAmount: parsedAmount,
      fileBuffer,
      fileName,
      mimeType,
      remarks,
    });

    res.status(201).json({
      success: true,
      message: 'Bill uploaded successfully and submitted for administrator verification.',
      bill: {
        ...bill,
        billAmount: Number(bill.billAmount),
        calculatedReward: Number(bill.calculatedReward),
        rewardPercentage: Number(bill.rewardPercentage),
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

    res.status(404).json({ success: false, message: 'Document file not found in storage.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
