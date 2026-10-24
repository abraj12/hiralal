import fs from 'fs';
import path from 'path';

describe('Bill Submission Four-Field Scope Preservation', () => {
  const rootDir = path.resolve(__dirname, '../../..');
  const uploadBillScreenPath = path.join(rootDir, 'mobile', 'src', 'screens', 'UploadBillScreen.tsx');
  const billRoutesPath = path.join(rootDir, 'backend', 'src', 'routes', 'bill.routes.ts');
  const mobileApiPath = path.join(rootDir, 'mobile', 'src', 'services', 'api.ts');

  it('verifies mobile UploadBillScreen has strictly four required inputs and no Remarks or vendor fields', () => {
    const content = fs.readFileSync(uploadBillScreenPath, 'utf8');

    // 1. Remarks input must NOT be present
    expect(content).not.toContain('Remarks (Optional)');
    expect(content).not.toMatch(/setRemarks/);
    expect(content).not.toMatch(/remarks:\s*remarks/);

    // 2. Vendor / Merchant / Shop / GST inputs must NOT be present
    expect(content).not.toContain('vendorGstin');
    expect(content).not.toContain('merchantName');
    expect(content).not.toMatch(/Vendor GSTIN/i);
    expect(content).not.toMatch(/Shop Name/i);
    expect(content).not.toMatch(/Merchant Name/i);
    expect(content).not.toMatch(/GST Rate/i);

    // 3. Exactly the 4 required inputs must be present
    expect(content).toContain('Invoice Number *');
    expect(content).toContain('Invoice Date *');
    expect(content).toContain('Bill Amount (₹) *');
    expect(content).toContain('Attach Real Invoice Receipt (PDF / Image) *');
  });

  it('verifies mobile API client does not send vendorGstin or merchantName in uploadBill', () => {
    const content = fs.readFileSync(mobileApiPath, 'utf8');
    const uploadBillSection = content.substring(content.indexOf('static async uploadBill'), content.indexOf('static async getBills'));

    expect(uploadBillSection).not.toContain('vendorGstin');
    expect(uploadBillSection).not.toContain('merchantName');
  });

  it('verifies backend bill.routes.ts does not bind vendorGstin or merchantName from user request', () => {
    const content = fs.readFileSync(billRoutesPath, 'utf8');

    // In the POST / handler, submitBill must not extract vendorGstin/merchantName from req.body
    const submitHandler = content.substring(content.indexOf("router.post("), content.indexOf("router.get('/'"));
    expect(submitHandler).not.toContain('vendorGstin: req.body.vendorGstin');
    expect(submitHandler).not.toContain('merchantName: req.body.merchantName');
  });
});
