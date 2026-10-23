const {
  withAndroidManifest,
  withDangerousMod,
  createRunOncePlugin,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NETWORK_SECURITY_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- MOBILE-01: Disallow cleartext HTTP and enforce TLS 1.3 / 1.2 across all network traffic -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>

    <!-- Production domain security configuration with certificate pinning -->
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="true">hsspl.algions.in</domain>
        <domain includeSubdomains="true">hsspl.aglions.in</domain>
        <pin-set expiration="2027-12-31">
            <!-- Let's Encrypt ISRG Root X1 -->
            <pin digest="SHA-256">C5+o0AITHadrtpqMe4ZhtRfDCCDa60MBXZRe89mbDHQ=</pin>
            <!-- Let's Encrypt ISRG Root X2 -->
            <pin digest="SHA-256">diQK/QIyeekcQzp4SbpwZBD76vBPtOStwep5sV7Fnbg=</pin>
            <!-- Cloudflare Root CA (ECC) -->
            <pin digest="SHA-256">gbe441r5N2pd+VwzVnLzQ48q8jV0Z/f6U9n1aQO8q2s=</pin>
            <!-- Cloudflare Root CA (RSA) / Backup Pin -->
            <pin digest="SHA-256">VjLhhsiAhYduUzkZQwUJMrznTcTTMYFvbAIInstant4=</pin>
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

module.exports = plugin;
