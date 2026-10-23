const {
  withMainApplication,
  createRunOncePlugin,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

function insertImportAfterPackageDeclaration(contents, qualifiedName, isKotlin) {
  const importLine = `import ${qualifiedName}${isKotlin ? '' : ';'}`;

  if (contents.split(/\r?\n/).some((line) => line.trim() === importLine)) {
    return contents;
  }

  const packageMatch = contents.match(
    /^[ \t]*package[ \t]+[A-Za-z0-9_.]+;?[ \t]*\r?\n/m
  );

  if (!packageMatch || packageMatch.index === undefined) {
    throw new Error(
      'Cannot register SecurityPackage: MainApplication has no recognizable package declaration.'
    );
  }

  const insertAt = packageMatch.index + packageMatch[0].length;

  return (
    contents.slice(0, insertAt) +
    `${importLine}\n` +
    contents.slice(insertAt)
  );
}

function registerSecurityPackage(contents, isKotlin) {
  if (contents.includes('SecurityPackage()') || contents.includes('new SecurityPackage()')) {
    return contents;
  }

  if (isKotlin) {
    if (contents.includes('PackageList(this).packages.apply {')) {
      return contents.replace(
        'PackageList(this).packages.apply {',
        'PackageList(this).packages.apply {\n              add(SecurityPackage())'
      );
    }
    if (contents.includes('PackageList(this).packages')) {
      return contents.replace(
        'PackageList(this).packages',
        'PackageList(this).packages.apply {\n              add(SecurityPackage())\n            }'
      );
    }
    throw new Error(
      'Cannot register SecurityPackage: MainApplication.kt does not match any recognized Kotlin package registration pattern.'
    );
  } else {
    if (contents.includes('List<ReactPackage> packages = new PackageList(this).getPackages();')) {
      return contents.replace(
        'List<ReactPackage> packages = new PackageList(this).getPackages();',
        'List<ReactPackage> packages = new PackageList(this).getPackages();\n      packages.add(new SecurityPackage());'
      );
    }
    if (contents.includes('new PackageList(this).getPackages();')) {
      return contents.replace(
        'new PackageList(this).getPackages();',
        'new PackageList(this).getPackages();\n      packages.add(new SecurityPackage());'
      );
    }
    if (contents.includes('new PackageList(this).getPackages()')) {
      return contents.replace(
        'new PackageList(this).getPackages()',
        'new PackageList(this).getPackages();\n      packages.add(new SecurityPackage())'
      );
    }
    throw new Error(
      'Cannot register SecurityPackage: MainApplication.java does not match any recognized Java package registration pattern.'
    );
  }
}

function withDeveloperModeSecurityNativeFiles(config) {
  return withMainApplication(config, (mainAppConfig) => {
    const projectRoot = mainAppConfig.modRequest.projectRoot;
    const androidPackage = config.android?.package || 'com.hiralal.rewards';
    const packagePath = androidPackage.replace(/\./g, '/');
    const targetDir = path.join(
      projectRoot,
      'android/app/src/main/java',
      packagePath,
      'security'
    );

    fs.mkdirSync(targetDir, { recursive: true });

    // 1. SecurityModule.java
    const moduleJava = `package ${androidPackage}.security;

import android.content.Intent;
import android.provider.Settings;
import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class SecurityModule extends ReactContextBaseJavaModule {
    private final ReactApplicationContext reactContext;

    public SecurityModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return "SecurityModule";
    }

    @ReactMethod
    public void isDeveloperModeEnabled(Promise promise) {
        try {
            boolean devOptions = Settings.Global.getInt(
                reactContext.getContentResolver(),
                Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0
            ) != 0;
            boolean adbEnabled = Settings.Global.getInt(
                reactContext.getContentResolver(),
                Settings.Global.ADB_ENABLED, 0
            ) != 0;
            promise.resolve(devOptions || adbEnabled);
        } catch (Exception e) {
            promise.reject("ERR_CHECK_DEV_MODE_FAILED", e.getMessage() != null ? e.getMessage() : "Failed to query developer options status", e);
        }
    }

    @ReactMethod
    public void openDeveloperSettings(Promise promise) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (intent.resolveActivity(reactContext.getPackageManager()) != null) {
                reactContext.startActivity(intent);
                promise.resolve(true);
            } else {
                Intent fallback = new Intent(Settings.ACTION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                reactContext.startActivity(fallback);
                promise.resolve(true);
            }
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                reactContext.startActivity(fallback);
                promise.resolve(true);
            } catch (Exception ex) {
                promise.reject("ERR_OPEN_SETTINGS_FAILED", ex.getMessage() != null ? ex.getMessage() : "Failed to open settings", ex);
            }
        }
    }
}
`;
    fs.writeFileSync(path.join(targetDir, 'SecurityModule.java'), moduleJava, 'utf8');

    // 2. SecurityPackage.java
    const packageJava = `package ${androidPackage}.security;

import androidx.annotation.NonNull;
import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class SecurityPackage implements ReactPackage {
    @NonNull
    @Override
    public List<NativeModule> createNativeModules(@NonNull ReactApplicationContext reactContext) {
        List<NativeModule> modules = new ArrayList<>();
        modules.add(new SecurityModule(reactContext));
        return modules;
    }

    @NonNull
    @Override
    public List<ViewManager> createViewManagers(@NonNull ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
}
`;
    fs.writeFileSync(path.join(targetDir, 'SecurityPackage.java'), packageJava, 'utf8');

    // 3. Register package in MainApplication.kt or MainApplication.java
    let contents = mainAppConfig.modResults.contents;
    const isKotlin =
      mainAppConfig.modResults.language === 'kt' ||
      mainAppConfig.modRequest?.mainApplicationPath?.endsWith('.kt') ||
      contents.includes('class MainApplication :') ||
      contents.includes('fun getPackages');

    // Safe import insertion after package declaration
    contents = insertImportAfterPackageDeclaration(
      contents,
      `${androidPackage}.security.SecurityPackage`,
      isKotlin
    );

    // Register package in package list
    contents = registerSecurityPackage(contents, isKotlin);

    mainAppConfig.modResults.contents = contents;
    return mainAppConfig;
  });
}

function withDeveloperModeSecurity(config) {
  return withDeveloperModeSecurityNativeFiles(config);
}

const plugin = createRunOncePlugin(withDeveloperModeSecurity, 'withDeveloperModeSecurity', '1.0.0');
plugin.insertImportAfterPackageDeclaration = insertImportAfterPackageDeclaration;
plugin.registerSecurityPackage = registerSecurityPackage;
plugin.withDeveloperModeSecurityNativeFiles = withDeveloperModeSecurityNativeFiles;

module.exports = plugin;
