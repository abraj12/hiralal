import fs from 'fs';
import path from 'path';

describe('Finding 20: Documentation Consistency Verification', () => {
  const rootDir = path.resolve(__dirname, '../../..');
  const securityDocPath = path.join(rootDir, 'docs', 'SECURITY.md');
  const deploymentDocPath = path.join(rootDir, 'docs', 'DEPLOYMENT.md');
  const apiDocPath = path.join(rootDir, 'docs', 'API_DOCUMENTATION.md');

  it('verifies docs/SECURITY.md reflects actual security architecture', () => {
    const content = fs.readFileSync(securityDocPath, 'utf8');

    // 1. Blind indexing must cite BLIND_INDEX_SECRET, not FIELD_ENCRYPTION_KEY
    expect(content).toContain('BLIND_INDEX_SECRET');
    expect(content).not.toMatch(/blind indexing with an isolated server pepper \(`FIELD_ENCRYPTION_KEY`\)/);

    // 2. WhatsApp as primary OTP delivery with SMS fallback
    expect(content).toMatch(/WhatsApp Business API/);

    // 3. Worker CAS lease duration updated to 180-second with attempt fencing
    expect(content).toMatch(/180-second atomic Compare-And-Swap \(CAS\) leases/);
    expect(content).toMatch(/attempt fencing/);

    // 4. No typo domain
    expect(content).not.toContain('hsspl.aglions.in');
  });

  it('verifies docs/DEPLOYMENT.md reflects container memory allocations and safety flags', () => {
    const content = fs.readFileSync(deploymentDocPath, 'utf8');

    // 1. PostgreSQL memory matches docker-compose.yml 1,536 MB
    expect(content).toMatch(/PostgreSQL 16: Capped at 1,536 MB/);
    expect(content).toMatch(/shared_buffers=384MB/);

    // 2. Dedicated migration runner container documented
    expect(content).toContain('docker compose --profile tools run --rm migrate');

    // 3. restore-db.sh safety flag documented
    expect(content).toContain('--allow-production-overwrite');

    // 4. No typo domain
    expect(content).not.toContain('hsspl.aglions.in');
  });

  it('verifies docs/API_DOCUMENTATION.md adheres to production admin prefix constraints', () => {
    const content = fs.readFileSync(apiDocPath, 'utf8');

    // 1. No short BADM prefix in examples
    expect(content).not.toContain('"prefix": "BADM"');
    expect(content).not.toContain('"identifier": "BADM9876543210"');

    // 2. Production admin prefix minimum length and entropy noted
    expect(content).toMatch(/at least 16 characters in length with Shannon entropy >= 3\.0/);

    // 3. No typo domain
    expect(content).not.toContain('hsspl.aglions.in');
  });
});
