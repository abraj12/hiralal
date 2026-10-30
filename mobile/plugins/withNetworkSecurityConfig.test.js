const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  withNetworkSecurityConfigManifest,
  NETWORK_SECURITY_CONFIG_XML,
  CERTIFICATE_PINS,
} = require('./withNetworkSecurityConfig');

function spkiSha256(pem) {
  const der = new crypto.X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('base64');
}

const referencePems = fs
  .readFileSync(path.join(__dirname, 'pinnedRootCertificates.pem'), 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
const referenceHashes = referencePems.map(spkiSha256);

test('withNetworkSecurityConfig - manifest modifier sets networkSecurityConfig attribute', async () => {
  const config = withNetworkSecurityConfigManifest({ name: 'test', slug: 'test' });
  const manifest = {
    manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] },
  };

  const result = await config.mods.android.manifest({
    ...config,
    modResults: manifest,
    modRequest: { platform: 'android', modName: 'manifest', nextMod: async (c) => c },
  });

  assert.strictEqual(
    result.modResults.manifest.application[0].$['android:networkSecurityConfig'],
    '@xml/network_security_config'
  );
});

test('withNetworkSecurityConfig - XML template disallows cleartext and scopes pins to the API host', () => {
  assert.ok(NETWORK_SECURITY_CONFIG_XML.includes('cleartextTrafficPermitted="false"'));
  assert.ok(NETWORK_SECURITY_CONFIG_XML.includes('<domain includeSubdomains="true">hsspl.algions.in</domain>'));
  assert.ok(NETWORK_SECURITY_CONFIG_XML.includes('<pin-set'));
});

test('HIR-H-02 - every pin is the real SPKI hash of a certificate in pinnedRootCertificates.pem', () => {
  assert.ok(CERTIFICATE_PINS.length >= 2, 'at least one backup pin is required');
  for (const pin of CERTIFICATE_PINS) {
    assert.ok(referenceHashes.includes(pin.sha256), `${pin.name} pin does not match any reference certificate`);
    assert.ok(NETWORK_SECURITY_CONFIG_XML.includes(`<pin digest="SHA-256">${pin.sha256}</pin>`));
  }
});

test('HIR-H-02 - every reference certificate is pinned and no stray pins exist in the XML', () => {
  const pinned = CERTIFICATE_PINS.map((p) => p.sha256);
  for (const hash of referenceHashes) {
    assert.ok(pinned.includes(hash), `reference certificate ${hash} is not pinned`);
  }
  const xmlPins = [...NETWORK_SECURITY_CONFIG_XML.matchAll(/<pin digest="SHA-256">([^<]+)<\/pin>/g)].map((m) => m[1]);
  assert.deepStrictEqual(xmlPins.sort(), [...pinned].sort());
});

test('HIR-H-02 - pin set covers Let\'s Encrypt, Google Trust Services and SSL.com', () => {
  const names = CERTIFICATE_PINS.map((p) => p.name).join(' ');
  assert.match(names, /ISRG Root X1/);
  assert.match(names, /GTS Root R1/);
  assert.match(names, /SSL\.com/);
});
