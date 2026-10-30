const test = require('node:test');
const assert = require('node:assert/strict');
const { addSecureFlag } = require('./withSecureWindow');

const KOTLIN_ACTIVITY = `package com.admin.login

import android.os.Bundle
import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }
}
`;

const JAVA_ACTIVITY = `package com.admin.login;

public class MainActivity extends ReactActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(null);
  }
}
`;

test('HIR-I-03 - adds FLAG_SECURE immediately after super.onCreate in Kotlin', () => {
  const out = addSecureFlag(KOTLIN_ACTIVITY, true);
  assert.match(out, /super\.onCreate\(null\)\n\s+window\.setFlags\(android\.view\.WindowManager\.LayoutParams\.FLAG_SECURE/);
});

test('HIR-I-03 - adds FLAG_SECURE immediately after super.onCreate in Java', () => {
  const out = addSecureFlag(JAVA_ACTIVITY, false);
  assert.match(out, /super\.onCreate\(null\);\n\s+getWindow\(\)\.setFlags\(android\.view\.WindowManager\.LayoutParams\.FLAG_SECURE/);
});

test('HIR-I-03 - is idempotent', () => {
  const once = addSecureFlag(KOTLIN_ACTIVITY, true);
  assert.strictEqual(addSecureFlag(once, true), once);
});

test('HIR-I-03 - fails loudly when MainActivity has no onCreate hook', () => {
  assert.throws(() => addSecureFlag('class MainActivity : ReactActivity() {}', true), /FLAG_SECURE/);
});
