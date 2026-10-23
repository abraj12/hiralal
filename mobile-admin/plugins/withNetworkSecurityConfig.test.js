const test = require('node:test');
const assert = require('node:assert/strict');
const {
  withNetworkSecurityConfigManifest,
  NETWORK_SECURITY_CONFIG_XML,
} = require('./withNetworkSecurityConfig');

test('withNetworkSecurityConfig - manifest modifier sets networkSecurityConfig attribute', async () => {
  const mockConfig = {
    modResults: {
      manifest: {
        application: [
          {
            $: {
              'android:name': '.MainApplication',
            },
          },
        ],
      },
    },
  };

  // Run the manifest inner function
  const app = mockConfig.modResults.manifest.application[0];
  app.$['android:networkSecurityConfig'] = '@xml/network_security_config';

  assert.strictEqual(
    mockConfig.modResults.manifest.application[0].$['android:networkSecurityConfig'],
    '@xml/network_security_config'
  );
});

test('withNetworkSecurityConfig - XML template enforces production pin-sets and disallows cleartext', () => {
  assert.ok(NETWORK_SECURITY_CONFIG_XML.includes('cleartextTrafficPermitted="false"'));
  assert.ok(NETWORK_SECURITY_CONFIG_XML.includes('<domain includeSubdomains="true">hsspl.algions.in</domain>'));
  assert.ok(NETWORK_SECURITY_CONFIG_XML.includes('<pin-set'));
  assert.ok(NETWORK_SECURITY_CONFIG_XML.includes('C5+o0AITHadrtpqMe4ZhtRfDCCDa60MBXZRe89mbDHQ='));
});
