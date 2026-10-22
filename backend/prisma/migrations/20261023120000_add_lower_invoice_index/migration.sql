-- Step 3.5 (AUDIT-DB-01): Create functional unique index on LOWER(TRIM("invoiceNumber")) for approved bills
CREATE UNIQUE INDEX IF NOT EXISTS "Bill_lower_invoice_number_approved_idx"
ON "Bill" (LOWER(TRIM("invoiceNumber")))
WHERE "status" = 'APPROVED';
