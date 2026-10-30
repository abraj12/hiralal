const {
  withAndroidManifest,
  withDangerousMod,
  createRunOncePlugin,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * HIR-H-02: SPKI SHA-256 pins of the root CAs that Cloudflare's edge may chain
 * hsspl.algions.in certificates to (Let's Encrypt, Google Trust Services incl. the
 * GlobalSign cross-sign used on older devices, and SSL.com).
 *
 * Every value MUST be reproducible from pinnedRootCertificates.pem; the unit test
 * recomputes each hash from that bundle. Never type a pin by hand.
 * Rotation: add the new CA's root to the bundle and this list, ship an app update,
 * and only then remove an old pin.
 */
const CERTIFICATE_PINS = [
  { name: 'ISRG Root X1', sha256: 'C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=' },
  { name: 'ISRG Root X2', sha256: 'diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=' },
  { name: 'GTS Root R1', sha256: 'hxqRlPTu1bMS/0DITB1SSu0vd4u/8l8TjPgfaAp63Gc=' },
  { name: 'GTS Root R2', sha256: 'Vfd95BwDeSQo+NUYxVEEIlvkOlWY2SalKK1lPhzOx78=' },
  { name: 'GTS Root R3', sha256: 'QXnt2YHvdHR3tJYmQIr0Paosp6t/nggsEGD4QJZ3Q0g=' },
  { name: 'GTS Root R4', sha256: 'mEflZT5enoR1FuXLgYYGqnVEoZvmf9c2bVBpiOjYQ0c=' },
  { name: 'GlobalSign Root CA', sha256: 'K87oWBWM9UZfyddvDfoxL+8lpNyoUB2ptGtn0fv6G2Q=' },
  { name: 'SSL.com Root Certification Authority RSA', sha256: '0cRTd+vc1hjNFlHcLgLCHXUeWqn80bNDH/bs9qMTSPo=' },
  { name: 'SSL.com Root Certification Authority ECC', sha256: 'oyD01TTXvpfBro3QSZc1vIlcMjrdLTiL/M9mLCPX+Zo=' },
  { name: 'SSL.com TLS RSA Root CA 2022', sha256: 'K89VOmb1cJAN3TK6bf4ezAbJGC1mLcG2Dh97dnwr3VQ=' },
  { name: 'SSL.com TLS ECC Root CA 2022', sha256: 'G/ANXI8TwJTdF+AFBM8IiIUPEv0Gf6H5LA/b9guG4yE=' },
];

const PIN_SET_EXPIRATION = '2027-12-31';

const NETWORK_SECURITY_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- MOBILE-01: Disallow cleartext HTTP and enforce TLS 1.3 / 1.2 across all network traffic -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>

    <!-- Production domain security configuration with certificate pinning (generated from CERTIFICATE_PINS) -->
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="true">hsspl.algions.in</domain>
        <pin-set expiration="${PIN_SET_EXPIRATION}">
${CERTIFICATE_PINS.map((pin) => `            <!-- ${pin.name} -->\n            <pin digest="SHA-256">${pin.sha256}</pin>`).join('\n')}
        </pin-set>
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </domain-config>
</network-security-config>
`;

function withNetworkSecurityConfigXml(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const xmlDir = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml'
      );
      if (!fs.existsSync(xmlDir)) {
        fs.mkdirSync(xmlDir, { recursive: true });
      }
      const xmlPath = path.join(xmlDir, 'network_security_config.xml');
      fs.writeFileSync(xmlPath, NETWORK_SECURITY_CONFIG_XML.trim() + '\n', 'utf8');
      return modConfig;
    },
  ]);
}

function withNetworkSecurityConfigManifest(config) {
  return withAndroidManifest(config, async (modConfig) => {
    const mainApplication = modConfig.modResults.manifest.application?.[0];
    if (mainApplication) {
      mainApplication.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    }
    return modConfig;
  });
}

function withNetworkSecurityConfig(config) {
  config = withNetworkSecurityConfigXml(config);
  config = withNetworkSecurityConfigManifest(config);
  return config;
}

const plugin = createRunOncePlugin(
  withNetworkSecurityConfig,
  'withNetworkSecurityConfig',
  '1.0.0'
);

plugin.withNetworkSecurityConfigXml = withNetworkSecurityConfigXml;
plugin.withNetworkSecurityConfigManifest = withNetworkSecurityConfigManifest;
plugin.NETWORK_SECURITY_CONFIG_XML = NETWORK_SECURITY_CONFIG_XML;
plugin.CERTIFICATE_PINS = CERTIFICATE_PINS;
plugin.PIN_SET_EXPIRATION = PIN_SET_EXPIRATION;

module.exports = plugin;
